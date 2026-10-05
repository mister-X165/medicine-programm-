// СППВР v2.5.0 — Vital signs API
// GET  /api/patients/[id]/vitals — list vitals
// POST /api/patients/[id]/vitals — add new vital sign record

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

  const vitals = await db.vitalSign.findMany({
    where: { patientId: id },
    orderBy: { recordedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    vitals: vitals.map((v) => ({ ...v, recordedAt: v.recordedAt.toISOString() })),
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
    // BMI calculation if both height and weight present
    let bmi = Number(body.bmi) || 0;
    const h = Number(body.height) || 0;
    const w = Number(body.weight) || 0;
    if (h > 0 && w > 0) bmi = +(w / Math.pow(h / 100, 2)).toFixed(1);

    const vital = await db.vitalSign.create({
      data: {
        patientId: id,
        visitId: body.visitId || null,
        recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
        systolicBP: Number(body.systolicBP) || 0,
        diastolicBP: Number(body.diastolicBP) || 0,
        heartRate: Number(body.heartRate) || 0,
        respiratoryRate: Number(body.respiratoryRate) || 0,
        temperature: Number(body.temperature) || 0,
        oxygenSaturation: Number(body.oxygenSaturation) || 0,
        height: h,
        weight: w,
        bmi,
        waistCircumference: Number(body.waistCircumference) || 0,
        glucose: Number(body.glucose) || 0,
        painScore: Number(body.painScore) || 0,
        consciousness: body.consciousness || "",
        notes: body.notes || "",
        recordedById: session.doctorId,
      },
    });

    // Update patient's last height/weight for convenience
    if (h > 0 || w > 0) {
      await db.patient.update({
        where: { id },
        data: { ...(h > 0 ? { height: h } : {}), ...(w > 0 ? { weight: w } : {}) },
      });
    }

    await appendAudit({
      action: "patient.vital.add",
      details: { patientId: id, vitalId: vital.id },
      doctorId: session.doctorId,
    });

    return NextResponse.json({ vital: { ...vital, recordedAt: vital.recordedAt.toISOString() } }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to add vital", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to add vital sign", detail: msg }, { status: 500 });
  }
}
