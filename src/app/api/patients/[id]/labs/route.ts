// СППВР v2.5.0 — Lab Results API
// GET  /api/patients/[id]/labs — list lab results
// POST /api/patients/[id]/labs — add lab result

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
  const category = url.searchParams.get("category");

  const labs = await db.labResult.findMany({
    where: { patientId: id, ...(category ? { category } : {}) },
    orderBy: { collectedAt: "desc" },
    take: 300,
  });

  return NextResponse.json({
    labResults: labs.map((l) => ({
      ...l, collectedAt: l.collectedAt.toISOString(), resultedAt: l.resultedAt?.toISOString() ?? null,
    })),
  });
}

function determineFlag(value: string, num: number | null, low: number | null, high: number | null): string {
  if (num != null && low != null && high != null) {
    if (num < low * 0.5 || num > high * 2) return "critical";
    if (num < low) return "low";
    if (num > high) return "high";
    return "normal";
  }
  const lc = value.toLowerCase();
  if (lc.includes("критич") || lc.includes("critical")) return "critical";
  if (lc.includes("повыш") || lc.includes("high")) return "high";
  if (lc.includes("сниж") || lc.includes("low")) return "low";
  if (lc.includes("abnorm") || lc.includes("отклон")) return "abnormal";
  return "normal";
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
    const numericValue = body.numericValue != null ? Number(body.numericValue) : null;
    const refLow = body.refRangeLow != null ? Number(body.refRangeLow) : null;
    const refHigh = body.refRangeHigh != null ? Number(body.refRangeHigh) : null;
    const flag = body.flag || determineFlag(String(body.value || ""), numericValue, refLow, refHigh);

    const lab = await db.labResult.create({
      data: {
        patientId: id,
        visitId: body.visitId || null,
        testName: body.testName,
        testCode: body.testCode || "",
        category: body.category || "general",
        value: String(body.value),
        numericValue,
        unit: body.unit || "",
        refRangeLow: refLow,
        refRangeHigh: refHigh,
        flag,
        method: body.method || "",
        specimen: body.specimen || "",
        collectedAt: body.collectedAt ? new Date(body.collectedAt) : new Date(),
        resultedAt: body.resultedAt ? new Date(body.resultedAt) : null,
        labName: body.labName || "",
        notes: body.notes || "",
      },
    });

    await appendAudit({
      action: "patient.lab.add",
      details: { patientId: id, labId: lab.id, testName: body.testName },
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      labResult: { ...lab, collectedAt: lab.collectedAt.toISOString(), resultedAt: lab.resultedAt?.toISOString() ?? null },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to add lab result", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to add lab result", detail: msg }, { status: 500 });
  }
}
