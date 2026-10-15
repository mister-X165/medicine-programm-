// СППВР v2.5.0 — Visits API
// GET  /api/patients/[id]/visits — list visits
// POST /api/patients/[id]/visits — create new visit

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

  const visits = await db.visit.findMany({
    where: { patientId: id },
    include: {
      doctor: { select: { id: true, fullName: true, specialization: true } },
      case: { select: { id: true, caseCode: true, status: true } },
      _count: { select: { vitalSigns: true, medications: true, labResults: true } },
    },
    orderBy: { scheduledAt: "desc" },
  });

  const result = visits.map((v) => ({
    ...v,
    scheduledAt: v.scheduledAt.toISOString(),
    startedAt: v.startedAt?.toISOString() ?? null,
    completedAt: v.completedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ visits: result });
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
    const visit = await db.visit.create({
      data: {
        patientId: id,
        doctorId: session.doctorId,
        caseId: body.caseId || null,
        visitType: body.visitType || "outpatient",
        status: body.status || "scheduled",
        chiefComplaint: body.chiefComplaint || "",
        visitReason: body.visitReason || "",
        soapSubjective: body.soapSubjective || "",
        soapObjective: body.soapObjective || "",
        soapAssessment: body.soapAssessment || "",
        soapPlan: body.soapPlan || "",
        diagnosis: JSON.stringify(body.diagnosis || []),
        prescriptions: JSON.stringify(body.prescriptions || []),
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
        completedAt: body.completedAt ? new Date(body.completedAt) : null,
        durationMin: Number(body.durationMin) || 0,
      },
    });

    await appendAudit({
      action: "patient.visit.create",
      details: { patientId: id, visitId: visit.id, type: visit.visitType },
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      visit: {
        ...visit,
        scheduledAt: visit.scheduledAt.toISOString(),
        startedAt: visit.startedAt?.toISOString() ?? null,
        completedAt: visit.completedAt?.toISOString() ?? null,
      },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to create visit", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to create visit", detail: msg }, { status: 500 });
  }
}
