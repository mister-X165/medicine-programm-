// СППВР v2.5.0 — Immunizations API
// GET  /api/patients/[id]/immunizations
// POST /api/patients/[id]/immunizations

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

  const imm = await db.immunization.findMany({
    where: { patientId: id },
    orderBy: { administeredAt: "desc" },
  });

  return NextResponse.json({
    immunizations: imm.map((i) => ({
      ...i,
      administeredAt: i.administeredAt.toISOString(),
      nextDoseDate: i.nextDoseDate?.toISOString() ?? null,
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
    const imm = await db.immunization.create({
      data: {
        patientId: id,
        visitId: body.visitId || null,
        vaccineName: body.vaccineName,
        vaccineCode: body.vaccineCode || "",
        targetDisease: body.targetDisease || "",
        doseNumber: Number(body.doseNumber) || 1,
        series: body.series || "",
        manufacturer: body.manufacturer || "",
        lotNumber: body.lotNumber || "",
        route: body.route || "im",
        site: body.site || "",
        administeredAt: body.administeredAt ? new Date(body.administeredAt) : new Date(),
        administeredById: session.doctorId,
        nextDoseDate: body.nextDoseDate ? new Date(body.nextDoseDate) : null,
        reaction: body.reaction || "",
        notes: body.notes || "",
      },
    });

    await appendAudit({
      action: "patient.immunization.add",
      details: { patientId: id, immunizationId: imm.id, vaccine: body.vaccineName },
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      immunization: {
        ...imm,
        administeredAt: imm.administeredAt.toISOString(),
        nextDoseDate: imm.nextDoseDate?.toISOString() ?? null,
      },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to add immunization", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to add immunization", detail: msg }, { status: 500 });
  }
}
