// СППВР v2.5.0 — Care Plans API
// GET  /api/patients/[id]/careplans
// POST /api/patients/[id]/careplans

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

  const plans = await db.carePlan.findMany({
    where: { patientId: id },
    include: {
      doctor: { select: { id: true, fullName: true } },
      problem: { select: { id: true, title: true, icd10: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    carePlans: plans.map((c) => ({
      ...c,
      startDate: c.startDate.toISOString(),
      endDate: c.endDate?.toISOString() ?? null,
      goals: c.goals ? JSON.parse(c.goals) : [],
      interventions: c.interventions ? JSON.parse(c.interventions) : [],
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
    const plan = await db.carePlan.create({
      data: {
        patientId: id,
        problemId: body.problemId || null,
        title: body.title,
        type: body.type || "treatment",
        status: body.status || "draft",
        goals: JSON.stringify(body.goals || []),
        interventions: JSON.stringify(body.interventions || []),
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        endDate: body.endDate ? new Date(body.endDate) : null,
        doctorId: session.doctorId,
        notes: body.notes || "",
      },
    });

    await appendAudit({
      action: "patient.careplan.create",
      details: { patientId: id, carePlanId: plan.id, title: body.title },
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      carePlan: {
        ...plan,
        startDate: plan.startDate.toISOString(),
        endDate: plan.endDate?.toISOString() ?? null,
        goals: body.goals || [],
        interventions: body.interventions || [],
      },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to create care plan", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to create care plan", detail: msg }, { status: 500 });
  }
}
