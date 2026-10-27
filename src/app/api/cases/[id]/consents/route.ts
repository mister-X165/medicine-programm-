// СППВР v2.0 — Case Consents API
// GET   /api/cases/[id]/consents — Get consents for case
// POST  /api/cases/[id]/consents — Create/upsert consent (grant or revoke via granted flag)
// PATCH /api/cases/[id]/consents — Partial update of an existing consent
//                                 (revoke: granted=false; update notes / validUntil)
//
// All mutations are audited via appendAudit() (WORM hash-chain) and require
// an authenticated session (getSessionFromRequest).

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createConsentSchema, validateOrThrow } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import { requireCaseAccess } from "@/lib/case-access";
import { getSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  // SECURITY (v4.3 audit fix): GET previously only checked authentication,
  // not case ownership — any logged-in doctor could read consent records
  // (PHI under ФЗ-152) for ANY case by cuid. Now enforces requireCaseAccess.
  const access = await requireCaseAccess(caseId, _req);
  if (!access.ok) return access.response;

  const consents = await db.consent.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: {
      doctor: { select: { id: true, fullName: true, doctorCode: true } },
    },
  });

  return NextResponse.json({ consents });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth: only authenticated doctors can grant/revoke consents.
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id: caseId } = await params;

  try {
    const body = await req.json();
    const data = validateOrThrow(createConsentSchema, body);

    // Look up the case to get its owner doctorId and enforce authorization.
    const caseRecord = await db.case.findUnique({
      where: { id: caseId },
      select: { doctorId: true },
    });
    if (!caseRecord) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    // Authorization: case owner OR admin can manage consents.
    if (caseRecord.doctorId !== session.doctorId && session.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: only the case owner or an admin may manage consents" },
        { status: 403 },
      );
    }

    // Actor for the audit log: prefer the session doctor (the doctor who is
    // actually performing the action) over the case owner, since an admin
    // may manage consents on behalf of another doctor.
    const actorDoctorId = session.doctorId;

    // Check if consent of this type already exists for this case
    const existing = await db.consent.findFirst({
      where: { caseId, consentType: data.consentType },
    });

    if (existing) {
      // Update existing consent — upsert semantics via POST.
      const updated = await db.consent.update({
        where: { id: existing.id },
        data: {
          granted: data.granted,
          notes: data.notes ?? existing.notes,
          validUntil: data.validUntil ? new Date(data.validUntil) : existing.validUntil,
          // Re-attribute the consent to the acting doctor on every change so
          // the audit trail reflects who last touched it.
          doctorId: actorDoctorId,
        },
        include: {
          doctor: { select: { id: true, fullName: true, doctorCode: true } },
        },
      });

      logger.info("consents", "Consent updated", {
        caseId,
        consentType: data.consentType,
        granted: data.granted,
      });

      await appendAudit({
        caseId,
        doctorId: actorDoctorId,
        action: "consent_update",
        details: {
          consentType: data.consentType,
          granted: data.granted,
          notes: data.notes ?? existing.notes ?? "",
          validUntil: data.validUntil ?? existing.validUntil ?? null,
          mode: "upsert",
        },
      });

      return NextResponse.json({ consent: updated });
    }

    // Create new consent — doctorId taken from the acting session.
    const consent = await db.consent.create({
      data: {
        caseId,
        doctorId: actorDoctorId,
        consentType: data.consentType,
        granted: data.granted,
        notes: data.notes ?? "",
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
      },
      include: {
        doctor: { select: { id: true, fullName: true, doctorCode: true } },
      },
    });

    logger.info("consents", "Consent created", {
      caseId,
      consentType: data.consentType,
      granted: data.granted,
    });

    await appendAudit({
      caseId,
      doctorId: actorDoctorId,
      action: "consent_update",
      details: {
        consentType: data.consentType,
        granted: data.granted,
        notes: data.notes ?? "",
        validUntil: data.validUntil ?? null,
        mode: "create",
      },
    });

    return NextResponse.json({ consent }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Validation error")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/cases/[id]/consents
// Body: { consentType: ConsentType, granted?: boolean, notes?: string, validUntil?: string|null }
// Used for revoke (granted=false) and partial updates (notes / validUntil).
// The consent record is preserved (NOT deleted) so the audit trail is intact.
// ---------------------------------------------------------------------------
const patchConsentSchema = z.object({
  consentType: z.enum(
    ["data_processing", "ai_analysis", "genetic_analysis", "report_sharing", "data_retention"],
    { message: "Invalid consent type" },
  ),
  granted: z.boolean().optional(),
  notes: z.string().optional(),
  validUntil: z.union([z.string(), z.null()]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id: caseId } = await params;

  try {
    const body = await req.json();
    const parsed = patchConsentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation error" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const caseRecord = await db.case.findUnique({
      where: { id: caseId },
      select: { doctorId: true },
    });
    if (!caseRecord) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    if (caseRecord.doctorId !== session.doctorId && session.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: only the case owner or an admin may manage consents" },
        { status: 403 },
      );
    }

    const existing = await db.consent.findFirst({
      where: { caseId, consentType: data.consentType },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Consent record not found for this type" },
        { status: 404 },
      );
    }

    // Build the update payload — only fields that were actually provided.
    const updateData: Record<string, unknown> = {};
    if (data.granted !== undefined) updateData.granted = data.granted;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.validUntil !== undefined) {
      updateData.validUntil = data.validUntil ? new Date(data.validUntil) : null;
    }
    // Re-attribute the acting doctor on every change.
    updateData.doctorId = session.doctorId;

    const updated = await db.consent.update({
      where: { id: existing.id },
      data: updateData,
      include: {
        doctor: { select: { id: true, fullName: true, doctorCode: true } },
      },
    });

    logger.info("consents", "Consent patched", {
      caseId,
      consentType: data.consentType,
      changes: Object.keys(updateData).filter((k) => k !== "doctorId"),
    });

    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "consent_update",
      details: {
        consentType: data.consentType,
        granted: updated.granted,
        notes: updated.notes,
        validUntil: updated.validUntil,
        mode: "patch",
      },
    });

    return NextResponse.json({ consent: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
