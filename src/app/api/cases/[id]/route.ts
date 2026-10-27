// СППВР v2.0 — Case by ID API
// GET    /api/cases/[id] — Get case details with documents, analysis, reports
// PATCH  /api/cases/[id] — Update case
// DELETE /api/cases/[id] — Delete case
//
// SECURITY (v2.1.4): PATCH and DELETE now enforce case ownership via
// `requireCaseAccess`. Any logged-in doctor could previously modify or
// delete ANY case (IDOR). Audit attribution now uses session.doctorId.
// GET is wrapped in try/catch so Prisma errors do not leak SQL fragments.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseStructured } from "@/lib/utils";
import { requireCaseAccess } from "@/lib/case-access";
import { appendAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Verify the requesting session can see this case.
    const access = await requireCaseAccess(id, req);
    if (!access.ok) return access.response;

    const found = await db.case.findUnique({
      where: { id },
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
        documents: { orderBy: { createdAt: "asc" } },
        analysis: true,
        reports: {
          orderBy: { createdAt: "desc" },
          include: {
            signatures: {
              include: {
                doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
              },
              orderBy: { signedAt: "desc" },
            },
          },
        },
        consents: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!found) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const analysis = found.analysis
      ? {
          ...found.analysis,
          entities: safeParse(found.analysis.entities, []),
          mutations: safeParse(found.analysis.mutations, []),
          recommendations: safeParse(found.analysis.recommendations, []),
          sections: safeParse(found.analysis.sections, []),
          confidence: safeParse(found.analysis.confidence, {}),
          citations: safeParse(found.analysis.citations, []),
          imageFindings: safeParse(found.analysis.imageFindings, []),
          controlWeights: safeParse(found.analysis.controlWeights, {}),
          doctorComments: safeParse(found.analysis.doctorComments, []),
          therapyRecommendations: safeParse(found.analysis.therapyRecommendations, []),
          ddiAlerts: safeParse(found.analysis.ddiAlerts, []),
          icd10Suggestions: safeParse(found.analysis.icd10Suggestions, []),
          pathwayMatches: safeParse(found.analysis.pathwayMatches, []),
          // v5.0: структурированные клинические данные
          structured: parseStructured(found.analysis.structured),
        }
      : null;

    return NextResponse.json({
      case: {
        ...found,
        icd10Codes: safeParse(found.icd10Codes, []),
        analysis,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "cases/[id] GET error", { id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const access = await requireCaseAccess(id, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const body = await req.json();
    const allowed = ["birthYear", "sex", "diagnosisHint", "notes", "status", "patientToken", "icd10Codes"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) {
        if (k === "icd10Codes" && typeof body[k] !== "string") {
          data[k] = JSON.stringify(body[k]);
        } else {
          data[k] = body[k];
        }
      }
    }

    const updated = await db.case.update({
      where: { id },
      data,
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true } },
      },
    });

    await appendAudit({
      caseId: id,
      doctorId: session.doctorId,
      action: "update_case",
      details: JSON.stringify({ fields: Object.keys(data) }),
    }).catch(() => {});

    return NextResponse.json({ case: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "cases/[id] PATCH error", { id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const access = await requireCaseAccess(id, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const existing = await db.case.findUnique({
      where: { id },
      select: { caseCode: true, doctorId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    await db.case.delete({ where: { id } });

    await appendAudit({
      caseId: id,
      doctorId: session.doctorId,
      action: "delete_case",
      details: JSON.stringify({ caseCode: existing.caseCode }),
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "cases/[id] DELETE error", { id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
