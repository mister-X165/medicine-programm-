// СППВР v2.5.0 — Medications API
// GET  /api/patients/[id]/medications — list medications
// POST /api/patients/[id]/medications — add new medication

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

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";

  const meds = await db.medication.findMany({
    where: { patientId: id, ...(status !== "all" ? { status } : {}) },
    include: { prescriber: { select: { id: true, fullName: true } } },
    orderBy: { startDate: "desc" },
    take: 200,
  });

  return NextResponse.json({
    medications: meds.map((m) => ({
      ...m, startDate: m.startDate.toISOString(), endDate: m.endDate?.toISOString() ?? null,
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
    const med = await db.medication.create({
      data: {
        patientId: id,
        visitId: body.visitId || null,
        drugName: body.drugName,
        brandName: body.brandName || "",
        form: body.form || "tablet",
        dosage: body.dosage || "",
        route: body.route || "oral",
        frequency: body.frequency || "",
        duration: body.duration || "",
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        endDate: body.endDate ? new Date(body.endDate) : null,
        status: body.status || "active",
        indication: body.indication || "",
        prescriberId: session.doctorId,
        notes: body.notes || "",
      },
    });

    await appendAudit({
      action: "patient.medication.add",
      details: { patientId: id, medicationId: med.id, drugName: body.drugName },
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      medication: { ...med, startDate: med.startDate.toISOString(), endDate: med.endDate?.toISOString() ?? null },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to add medication", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to add medication", detail: msg }, { status: 500 });
  }
}
