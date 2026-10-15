// СППВР v2.5.0 — Problems (problem list) API
// GET  /api/patients/[id]/problems
// POST /api/patients/[id]/problems

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { requirePatientAccess } from "@/lib/patient-access";
import { appendAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requirePatientAccess(req, id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const session = access.session!;

  const problems = await db.problem.findMany({
    where: { patientId: id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    problems: problems.map((p) => ({
      ...p,
      onsetDate: p.onsetDate?.toISOString() ?? null,
      resolvedDate: p.resolvedDate?.toISOString() ?? null,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requirePatientAccess(req, id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const session = access.session!;

  try {
    const body = await req.json();

    // If marking as primary, demote any existing primary
    if (body.isPrimary) {
      await db.problem.updateMany({
        where: { patientId: id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const problem = await db.problem.create({
      data: {
        patientId: id,
        title: body.title,
        icd10: body.icd10 || "",
        category: body.category || "chronic",
        status: body.status || "active",
        severity: body.severity || "mild",
        onsetDate: body.onsetDate ? new Date(body.onsetDate) : null,
        resolvedDate: body.resolvedDate ? new Date(body.resolvedDate) : null,
        description: body.description || "",
        notes: body.notes || "",
        isPrimary: !!body.isPrimary,
      },
    });

    await appendAudit({
      action: "patient.problem.add",
      details: { patientId: id, problemId: problem.id, title: body.title },
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      problem: {
        ...problem,
        onsetDate: problem.onsetDate?.toISOString() ?? null,
        resolvedDate: problem.resolvedDate?.toISOString() ?? null,
      },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to add problem", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to add problem", detail: msg }, { status: 500 });
  }
}
