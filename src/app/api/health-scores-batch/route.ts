// СППВР v2.5.10 — Batch Health Scores API
// GET /api/health-scores-batch — Calculates health scores for ALL patients
// in a single request. Used by the patient list to show mini score badges.
// Returns a map of patientId → { score, riskLevel, riskLabel }.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function safeParseArr(raw: string | null | undefined, fallback: unknown[] = []) {
  if (!raw) return fallback;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : fallback; }
  catch { return fallback; }
}

function calcScore(params: {
  age: number | null;
  bmi: number | null;
  latestSys: number;
  latestDia: number;
  latestSpo2: number;
  criticalLabs: number;
  abnormalLabs: number;
  severeProblems: number;
  moderateProblems: number;
  activeMeds: number;
  allergyCount: number;
  smoking: string;
  alcohol: string;
}): { score: number; riskLevel: "low" | "moderate" | "high" | "critical"; riskLabel: string } {
  let score = 100;

  if (params.age != null) {
    if (params.age > 75) score -= 10;
    else if (params.age > 60) score -= 5;
  }

  if (params.bmi != null) {
    if (params.bmi >= 30) score -= 8;
    else if (params.bmi >= 25) score -= 4;
    else if (params.bmi < 18.5) score -= 4;
  }

  if (params.latestSys > 0) {
    if (params.latestSys >= 180 || params.latestDia >= 110) score -= 15;
    else if (params.latestSys >= 140 || params.latestDia >= 90) score -= 8;
    else if (params.latestSys >= 130 || params.latestDia >= 85) score -= 3;
  }

  if (params.latestSpo2 > 0) {
    if (params.latestSpo2 < 90) score -= 12;
    else if (params.latestSpo2 < 95) score -= 5;
  }

  if (params.criticalLabs > 0) score -= 15;
  else if (params.abnormalLabs > 0) score -= Math.min(params.abnormalLabs * 2, 10);

  if (params.severeProblems > 0) score -= Math.min(params.severeProblems * 8, 20);
  else if (params.moderateProblems > 0) score -= Math.min(params.moderateProblems * 3, 10);

  if (params.activeMeds >= 10) score -= 12;
  else if (params.activeMeds >= 5) score -= 6;

  if (params.allergyCount > 0) score -= Math.min(params.allergyCount * 2, 6);

  if (params.smoking === "current") score -= 8;
  else if (params.smoking === "former") score -= 2;

  if (params.alcohol === "heavy") score -= 6;
  else if (params.alcohol === "moderate") score -= 2;

  score = Math.max(0, Math.min(100, score));
  const riskLevel = score >= 80 ? "low" : score >= 60 ? "moderate" : score >= 40 ? "high" : "critical";
  const riskLabel = { low: "Низкий", moderate: "Умеренный", high: "Высокий", critical: "Критический" }[riskLevel];

  return { score, riskLevel: riskLevel as "low" | "moderate" | "high" | "critical", riskLabel };
}

export async function GET(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    // Scope patients for non-admins
    const patientWhere = session.role !== "admin"
      ? { OR: [{ primaryDoctorId: session.doctorId }, { cases: { some: { doctorId: session.doctorId } } }] }
      : {};

    const patients = await db.patient.findMany({
      where: patientWhere,
      select: {
        id: true, birthYear: true, height: true, weight: true,
        allergies: true, smokingStatus: true, alcoholUse: true,
        vitalSigns: { orderBy: { recordedAt: "desc" }, take: 1, select: { systolicBP: true, diastolicBP: true, oxygenSaturation: true } },
        labResults: { where: { flag: { in: ["critical", "high", "low"] } }, select: { flag: true } },
        problems: { where: { status: { in: ["active", "chronic", "uncontrolled"] } }, select: { severity: true } },
        medications: { where: { status: "active" }, select: { id: true } },
      },
    });

    const scores: Record<string, { score: number; riskLevel: string; riskLabel: string }> = {};

    for (const p of patients) {
      let age: number | null = null;
      if (p.birthYear && p.birthYear > 1850) {
        age = new Date().getFullYear() - p.birthYear;
      }

      const bmi = p.height > 0 && p.weight > 0 ? p.weight / Math.pow(p.height / 100, 2) : null;
      const latestVital = p.vitalSigns[0];
      const criticalLabs = p.labResults.filter(l => l.flag === "critical").length;
      const abnormalLabs = p.labResults.filter(l => l.flag === "high" || l.flag === "low").length;
      const severeProblems = p.problems.filter(p => p.severity === "severe" || p.severity === "critical").length;
      const moderateProblems = p.problems.filter(p => p.severity === "moderate").length;
      const allergies = safeParseArr(p.allergies) as unknown[];

      const result = calcScore({
        age, bmi,
        latestSys: latestVital?.systolicBP ?? 0,
        latestDia: latestVital?.diastolicBP ?? 0,
        latestSpo2: latestVital?.oxygenSaturation ?? 0,
        criticalLabs, abnormalLabs,
        severeProblems, moderateProblems,
        activeMeds: p.medications.length,
        allergyCount: allergies.length,
        smoking: p.smokingStatus,
        alcohol: p.alcoholUse,
      });

      scores[p.id] = result;
    }

    logger.info("health-scores-batch", "Calculated batch scores", { count: patients.length });

    return NextResponse.json({ scores });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("health-scores-batch", "Failed", { error: msg });
    return NextResponse.json({ error: "Failed to calculate scores", detail: msg }, { status: 500 });
  }
}
