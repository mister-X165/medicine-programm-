// СППВР v2.5.8 — Patient DDI Overview API
// GET /api/patients/[id]/ddi-overview — Checks ALL active medications against
// each other AND against the patient's allergies. Returns a comprehensive
// drug safety report for the patient's entire medication regimen.
//
// This is different from /med-check (which checks a single proposed drug):
//   - /med-check: "Is it safe to prescribe drug X to this patient?"
//   - /ddi-overview: "What are all the interactions in this patient's current regimen?"

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

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ").replace(/\(.*?\)/g, "").trim();
}

function drugMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function allergenMatch(allergen: string, drugName: string): boolean {
  const na = normalize(allergen);
  const nd = normalize(drugName);
  if (!na || !nd) return false;
  if (na === nd || na.includes(nd) || nd.includes(na)) return true;
  const classes: Record<string, string[]> = {
    "пенициллин": ["амоксициллин", "ампициллин", "бензилпенициллин", "феноксиметилпенициллин", "пенициллин", "аугментин", "амоксиклав"],
    "цефалоспорин": ["цефазолин", "цефтриаксон", "цефуроксим", "цефепим", "цефиксим"],
    "сульфаниламид": ["бисептол", "ко-тримоксазол", "сульфаметоксазол"],
    "аспирин": ["ацетилсалициловая", "тромбо асс", "кардиомагнил", "аспирин"],
    "нпвс": ["ибупрофен", "диклофенак", "напроксен", "кеторолак", "нимесулид", "мелоксикам", "целекоксиб"],
  };
  for (const cls of Object.keys(classes)) {
    const drugs = classes[cls];
    if (na.includes(cls) && drugs.some(d => drugMatch(d, nd) || nd.includes(d))) return true;
  }
  return false;
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
      select: { allergies: true, id: true },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Get active medications
    const activeMeds = await db.medication.findMany({
      where: { patientId: id, status: "active" },
      select: { id: true, drugName: true, brandName: true, dosage: true, frequency: true, route: true, indication: true },
      orderBy: { startDate: "desc" },
    });

    if (activeMeds.length === 0) {
      return NextResponse.json({
        totalMeds: 0,
        interactions: [],
        allergyWarnings: [],
        summary: { total: 0, contraindications: 0, major: 0, moderate: 0, minor: 0, allergyConflicts: 0 },
      });
    }

    // Get all DDI records
    const allDdis = await db.drugInteraction.findMany({
      select: { drug1: true, drug2: true, severity: true, description: true, mechanism: true, management: true, evidenceLevel: true },
    });

    // Parse allergies
    const allergies = safeParseArr(patient.allergies) as Array<{ allergen: string; reaction: string; severity: string }>;

    // Check each active med against allergies
    const allergyWarnings: Array<{
      medication: string;
      allergen: string;
      reaction: string;
      severity: string;
    }> = [];

    for (const med of activeMeds) {
      for (const allergy of allergies) {
        if (allergenMatch(allergy.allergen, med.drugName)) {
          allergyWarnings.push({
            medication: med.drugName,
            allergen: allergy.allergen,
            reaction: allergy.reaction,
            severity: allergy.severity,
          });
        }
      }
    }

    // Check all pairs of active meds for DDI
    const interactions: Array<{
      drug1: string;
      drug2: string;
      severity: string;
      description: string;
      mechanism: string;
      management: string;
      evidenceLevel: string;
    }> = [];

    for (let i = 0; i < activeMeds.length; i++) {
      for (let j = i + 1; j < activeMeds.length; j++) {
        const medA = activeMeds[i];
        const medB = activeMeds[j];
        for (const ddi of allDdis) {
          const aMatches1 = drugMatch(medA.drugName, ddi.drug1);
          const aMatches2 = drugMatch(medA.drugName, ddi.drug2);
          const bMatches1 = drugMatch(medB.drugName, ddi.drug1);
          const bMatches2 = drugMatch(medB.drugName, ddi.drug2);

          if ((aMatches1 && bMatches2) || (aMatches2 && bMatches1)) {
            // Avoid duplicates
            const exists = interactions.some(
              (x) => (drugMatch(x.drug1, medA.drugName) && drugMatch(x.drug2, medB.drugName)) ||
                      (drugMatch(x.drug1, medB.drugName) && drugMatch(x.drug2, medA.drugName))
            );
            if (!exists) {
              interactions.push({
                drug1: medA.drugName,
                drug2: medB.drugName,
                severity: ddi.severity,
                description: ddi.description,
                mechanism: ddi.mechanism,
                management: ddi.management,
                evidenceLevel: ddi.evidenceLevel,
              });
            }
          }
        }
      }
    }

    // Sort interactions by severity
    const sevOrder: Record<string, number> = { contraindication: 0, major: 1, moderate: 2, minor: 3 };
    interactions.sort((a, b) => (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4));

    const summary = {
      total: interactions.length + allergyWarnings.length,
      contraindications: interactions.filter(i => i.severity === "contraindication").length,
      major: interactions.filter(i => i.severity === "major").length,
      moderate: interactions.filter(i => i.severity === "moderate").length,
      minor: interactions.filter(i => i.severity === "minor").length,
      allergyConflicts: allergyWarnings.length,
    };

    logger.info("ddi-overview", "Generated DDI overview", {
      patientId: id,
      activeMeds: activeMeds.length,
      interactions: interactions.length,
      allergyWarnings: allergyWarnings.length,
    });

    return NextResponse.json({
      totalMeds: activeMeds.length,
      activeMedications: activeMeds,
      interactions,
      allergyWarnings,
      summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("ddi-overview", "Failed to generate DDI overview", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed to generate DDI overview", detail: msg }, { status: 500 });
  }
}
