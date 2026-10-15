// СППВР v2.0 — Case Share API
// GET    /api/cases/[id]/share — List shares for case
// POST   /api/cases/[id]/share — Share case with another doctor
// DELETE /api/cases/[id]/share — Revoke share
//
// SECURITY (v2.1.4): POST/DELETE now enforce case ownership via
// `requireCaseAccess`. Previously any logged-in doctor could share ANY case
// with anyone, and any doctor could revoke any share — including shares they
// did not create. Audit attribution now uses session.doctorId (the acting
// doctor) instead of found.doctorId (the case owner), preventing audit-log
// forgery.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shareCaseSchema, validateOrThrow } from "@/lib/validation";
import { appendAudit } from "@/lib/audit";
import { requireCaseAccess } from "@/lib/case-access";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/cases/[id]/share — list shares
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  try {
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;

    const shares = await db.caseShare.findMany({
      where: { caseId, status: "active" },
      include: {
        fromDoctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
        toDoctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ shares });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "share GET error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/cases/[id]/share — share case
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  try {
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;
    const { session } = access;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    let data;
    try {
      data = validateOrThrow(shareCaseSchema, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Validation error";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const found = await db.case.findUnique({
      where: { id: caseId },
      select: { id: true, doctorId: true, caseCode: true },
    });
    if (!found) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const toDoctor = await db.doctor.findUnique({ where: { id: data.toDoctorId } });
    if (!toDoctor) {
      return NextResponse.json({ error: "Target doctor not found" }, { status: 404 });
    }

    if (found.doctorId === data.toDoctorId) {
      return NextResponse.json({ error: "Cannot share case with yourself" }, { status: 400 });
    }

    const existing = await db.caseShare.findFirst({
      where: { caseId, toDoctorId: data.toDoctorId, status: "active" },
    });
    if (existing) {
      return NextResponse.json({ error: `Case already shared with ${toDoctor.fullName}` }, { status: 409 });
    }

    const share = await db.caseShare.create({
      data: {
        caseId,
        // The acting doctor (session.doctorId) is recorded as the sender.
        // If an admin shares on behalf of the case owner, the admin's id is
        // recorded — this matches the audit attribution below.
        fromDoctorId: session.doctorId,
        toDoctorId: data.toDoctorId,
        accessLevel: data.accessLevel,
        message: data.message || null,
      },
      include: {
        fromDoctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
        toDoctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
      },
    });

    // Create notification for the receiving doctor
    await db.notification.create({
      data: {
        doctorId: data.toDoctorId,
        type: "case_shared",
        title: "Case shared with you",
        message: `Case ${found.caseCode} has been shared with you by ${share.fromDoctor?.fullName ?? session.doctorCode}`,
        caseId,
      },
    }).catch(() => {});

    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "share_case",
      details: JSON.stringify({ toDoctorId: data.toDoctorId, toDoctorName: toDoctor.fullName, accessLevel: data.accessLevel, shareId: share.id }),
    }).catch(() => {});

    return NextResponse.json({ share }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "share POST error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — revoke share (shareId in query). The revoker must be either the
// share's original sender, the case owner, or an admin.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  try {
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const url = new URL(req.url);
    const shareId = url.searchParams.get("shareId");

    if (!shareId) {
      return NextResponse.json({ error: "shareId query parameter required" }, { status: 400 });
    }

    const share = await db.caseShare.findUnique({
      where: { id: shareId },
      select: { id: true, caseId: true, fromDoctorId: true, toDoctorId: true },
    });
    if (!share || share.caseId !== caseId) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    // Only the original sender OR an admin may revoke.
    if (share.fromDoctorId !== session.doctorId && session.role !== "admin") {
      return NextResponse.json(
        { error: "Only the doctor who created the share (or an admin) may revoke it" },
        { status: 403 },
      );
    }

    await db.caseShare.update({
      where: { id: shareId },
      data: { status: "revoked" },
    });

    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "revoke_share",
      details: JSON.stringify({ shareId, toDoctorId: share.toDoctorId }),
    }).catch(() => {});

    return NextResponse.json({ success: true, message: "Share revoked" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "share DELETE error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
