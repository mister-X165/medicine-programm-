// СППВР v2.5.9 — Patient Health Score API
// GET /api/patients/[id]/health-score — Calculates a composite health score
// (0-100, higher = healthier) based on multiple clinical factors:
//   - Vital signs (BP, HR, SpO2, BMI)
//   - Lab abnormalities (critical/high/low flags)
//   - Active problems (severity-weighted)
//   - Medication burden (polypharmacy)
//   - Allergy count
//   - Age factor
// Returns the score, contributing factors, and recommendations.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { requirePatientAccess } from "@/lib/patient-access";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function safeParseArr(raw: string | null | undefined, fallback: unknown[] = []) {
  if (!raw) return fallback;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : fallback; }
  catch { return fallback; }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requirePatientAccess(req, id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const session = access.session!;

  try {
    const patient = await db.patient.findUnique({
      where: { id },
      select: {
        id: true, birthYear: true, sex: true, height: true, weight: true,
        allergies: true, chronicDiseases: true, smokingStatus: true, alcoholUse: true,
      },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Fetch latest vitals, labs, problems, medications
    const [latestVitals, labResults, problems, activeMeds] = await Promise.all([
      db.vitalSign.findFirst({
        where: { patientId: id },
        orderBy: { recordedAt: "desc" },
      }),
      db.labResult.findMany({
        where: { patientId: id },
        orderBy: { collectedAt: "desc" },
        take: 20,
        select: { flag: true, testName: true, value: true, unit: true, collectedAt: true },
      }),
      db.problem.findMany({
        where: { patientId: id },
        select: { severity: true, status: true, title: true, icd10: true },
      }),
      db.medication.findMany({
        where: { patientId: id, status: "active" },
        select: { drugName: true },
      }),
    ]);

    const factors: Array<{
      category: string;
      label: string;
      impact: "positive" | "neutral" | "negative" | "critical";
      detail: string;
      points: number;
    }> = [];

    let score = 100; // Start at 100, deduct for issues

    // 1. Age factor (older = slight deduction)
    let age: number | null = null;
    if (patient.birthYear && patient.birthYear > 1850) {
      age = new Date().getFullYear() - patient.birthYear;
    }
    if (age != null && age > 0) {
      if (age > 75) {
        score -= 10;
        factors.push({ category: "demographics", label: "Возраст", impact: "negative", detail: `${age} лет (старший возраст)`, points: -10 });
      } else if (age > 60) {
        score -= 5;
        factors.push({ category: "demographics", label: "Возраст", impact: "neutral", detail: `${age} лет`, points: -5 });
      } else {
        factors.push({ category: "demographics", label: "Возраст", impact: "positive", detail: `${age} лет`, points: 0 });
      }
    }

    // 2. BMI factor
    if (patient.height > 0 && patient.weight > 0) {
      const bmi = patient.weight / Math.pow(patient.height / 100, 2);
      if (bmi >= 30) {
        score -= 8;
        factors.push({ category: "anthropometry", label: "ИМТ", impact: "negative", detail: `ИМТ ${bmi.toFixed(1)} — ожирение`, points: -8 });
      } else if (bmi >= 25) {
        score -= 4;
        factors.push({ category: "anthropometry", label: "ИМТ", impact: "neutral", detail: `ИМТ ${bmi.toFixed(1)} — избыточный вес`, points: -4 });
      } else if (bmi < 18.5) {
        score -= 4;
        factors.push({ category: "anthropometry", label: "ИМТ", impact: "neutral", detail: `ИМТ ${bmi.toFixed(1)} — дефицит массы`, points: -4 });
      } else {
        factors.push({ category: "anthropometry", label: "ИМТ", impact: "positive", detail: `ИМТ ${bmi.toFixed(1)} — норма`, points: 0 });
      }
    }

    // 3. Blood pressure (latest reading)
    if (latestVitals && latestVitals.systolicBP > 0) {
      const sys = latestVitals.systolicBP;
      const dia = latestVitals.diastolicBP;
      if (sys >= 180 || dia >= 110) {
        score -= 15;
        factors.push({ category: "vitals", label: "Артериальное давление", impact: "critical", detail: `АД ${sys}/${dia} — гипертонический криз`, points: -15 });
      } else if (sys >= 140 || dia >= 90) {
        score -= 8;
        factors.push({ category: "vitals", label: "Артериальное давление", impact: "negative", detail: `АД ${sys}/${dia} — артериальная гипертензия`, points: -8 });
      } else if (sys >= 130 || dia >= 85) {
        score -= 3;
        factors.push({ category: "vitals", label: "Артериальное давление", impact: "neutral", detail: `АД ${sys}/${dia} — повышенное нормальное`, points: -3 });
      } else {
        factors.push({ category: "vitals", label: "Артериальное давление", impact: "positive", detail: `АД ${sys}/${dia} — норма`, points: 0 });
      }
    }

    // 4. SpO2
    if (latestVitals && latestVitals.oxygenSaturation > 0) {
      const spo2 = latestVitals.oxygenSaturation;
      if (spo2 < 90) {
        score -= 12;
        factors.push({ category: "vitals", label: "SpO₂", impact: "critical", detail: `SpO₂ ${spo2}% — гипоксемия`, points: -12 });
      } else if (spo2 < 95) {
        score -= 5;
        factors.push({ category: "vitals", label: "SpO₂", impact: "negative", detail: `SpO₂ ${spo2}% — снижено`, points: -5 });
      } else {
        factors.push({ category: "vitals", label: "SpO₂", impact: "positive", detail: `SpO₂ ${spo2}% — норма`, points: 0 });
      }
    }

    // 5. Lab abnormalities
    const criticalLabs = labResults.filter(l => l.flag === "critical");
    const highLabs = labResults.filter(l => l.flag === "high" || l.flag === "low");
    if (criticalLabs.length > 0) {
      score -= 15;
      factors.push({ category: "labs", label: "Критические анализы", impact: "critical", detail: `${criticalLabs.length} критических результатов`, points: -15 });
    } else if (highLabs.length > 0) {
      const deduction = Math.min(highLabs.length * 2, 10);
      score -= deduction;
      factors.push({ category: "labs", label: "Отклонения анализов", impact: "negative", detail: `${highLabs.length} отклонений от нормы`, points: -deduction });
    } else if (labResults.length > 0) {
      factors.push({ category: "labs", label: "Анализы", impact: "positive", detail: `${labResults.length} результатов — все в норме`, points: 0 });
    }

    // 6. Active problems (severity-weighted)
    const activeProblems = problems.filter(p => p.status === "active" || p.status === "chronic" || p.status === "uncontrolled");
    const severeProblems = activeProblems.filter(p => p.severity === "severe" || p.severity === "critical");
    const moderateProblems = activeProblems.filter(p => p.severity === "moderate");
    if (severeProblems.length > 0) {
      const deduction = Math.min(severeProblems.length * 8, 20);
      score -= deduction;
      factors.push({ category: "problems", label: "Тяжёлые проблемы", impact: "critical", detail: `${severeProblems.length} тяжёлых/критических проблем`, points: -deduction });
    } else if (moderateProblems.length > 0) {
      const deduction = Math.min(moderateProblems.length * 3, 10);
      score -= deduction;
      factors.push({ category: "problems", label: "Проблемы средней тяжести", impact: "negative", detail: `${moderateProblems.length} проблем средней тяжести`, points: -deduction });
    } else if (activeProblems.length > 0) {
      factors.push({ category: "problems", label: "Проблемы", impact: "neutral", detail: `${activeProblems.length} лёгких проблем`, points: 0 });
    }

    // 7. Polypharmacy (>=5 active meds)
    if (activeMeds.length >= 10) {
      score -= 12;
      factors.push({ category: "medications", label: "Полифармация", impact: "critical", detail: `${activeMeds.length} активных препаратов (чрезмерная полифармация)`, points: -12 });
    } else if (activeMeds.length >= 5) {
      score -= 6;
      factors.push({ category: "medications", label: "Полифармация", impact: "negative", detail: `${activeMeds.length} активных препаратов (полифармация)`, points: -6 });
    } else if (activeMeds.length > 0) {
      factors.push({ category: "medications", label: "Препараты", impact: "neutral", detail: `${activeMeds.length} активных препаратов`, points: 0 });
    } else {
      factors.push({ category: "medications", label: "Препараты", impact: "positive", detail: "Без активных препаратов", points: 0 });
    }

    // 8. Allergies
    const allergies = safeParseArr(patient.allergies) as unknown[];
    if (allergies.length > 0) {
      score -= Math.min(allergies.length * 2, 6);
      factors.push({ category: "allergies", label: "Аллергии", impact: "negative", detail: `${allergies.length} аллергий`, points: -Math.min(allergies.length * 2, 6) });
    }

    // 9. Smoking
    if (patient.smokingStatus === "current") {
      score -= 8;
      factors.push({ category: "lifestyle", label: "Курение", impact: "negative", detail: "Курит", points: -8 });
    } else if (patient.smokingStatus === "former") {
      score -= 2;
      factors.push({ category: "lifestyle", label: "Курение", impact: "neutral", detail: "Бросил курить", points: -2 });
    } else if (patient.smokingStatus === "never") {
      factors.push({ category: "lifestyle", label: "Курение", impact: "positive", detail: "Не курит", points: 0 });
    }

    // 10. Alcohol
    if (patient.alcoholUse === "heavy") {
      score -= 6;
      factors.push({ category: "lifestyle", label: "Алкоголь", impact: "negative", detail: "Частое употребление", points: -6 });
    } else if (patient.alcoholUse === "moderate") {
      score -= 2;
      factors.push({ category: "lifestyle", label: "Алкоголь", impact: "neutral", detail: "Умеренное употребление", points: -2 });
    }

    // Clamp score 0-100
    score = Math.max(0, Math.min(100, score));

    // Determine risk level
    const riskLevel = score >= 80 ? "low" : score >= 60 ? "moderate" : score >= 40 ? "high" : "critical";
    const riskLabel = { low: "Низкий риск", moderate: "Умеренный риск", high: "Высокий риск", critical: "Критический риск" }[riskLevel];
    const riskColor = { low: "emerald", moderate: "amber", high: "orange", critical: "rose" }[riskLevel];

    // Sort factors: critical first, then negative, neutral, positive
    const impactOrder = { critical: 0, negative: 1, neutral: 2, positive: 3 };
    factors.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);

    logger.info("health-score", "Calculated health score", {
      patientId: id, score, riskLevel, factorCount: factors.length,
    });

    return NextResponse.json({
      score,
      riskLevel,
      riskLabel,
      riskColor,
      factors,
      age,
      totalDeduction: 100 - score,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("health-score", "Failed to calculate health score", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to calculate health score", detail: msg }, { status: 500 });
  }
}
