// СППВР v5.0 — Medication safety check API
// GET /api/patients/[id]/med-check?drugName=Метформin[&online=true]
// Checks a proposed drug against:
//   1. Patient's known allergies (string match on allergen)
//   2. Active medication list — Drug-Drug Interactions (DDI)
// When online=true (v5.0): DDI проверяется ПОТОКОВЫМ ОНЛАЙН-ПОИСКОМ в базах РФ
// (РЛС/Видаль/ГРЛС/КР Минздрава) через движок ddi-online, иначе — локальная таблица.
// Returns a structured safety report with severity levels.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { requirePatientAccess } from "@/lib/patient-access";
import { logger } from "@/lib/logger";
import { checkDDIOnline } from "@/lib/ddi-online";

export const dynamic = "force-dynamic";

function safeParseArr(raw: string | null | undefined, fallback: unknown[] = []) {
  if (!raw) return fallback;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : fallback; }
  catch { return fallback; }
}

// Normalize a drug name for matching: lowercase, trim, remove common suffixes
function normalize(s: string): string {
  return s.toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/\(.*?\)/g, "")
    .trim();
}

// Check if two drug names match (fuzzy — handles "Метформин" vs "метформин")
function drugMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Substring match (one contains the other) — handles "Метформин" in "Метформин 500"
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// Check if an allergen matches a drug name
function allergenMatch(allergen: string, drugName: string): boolean {
  const na = normalize(allergen);
  const nd = normalize(drugName);
  if (!na || !nd) return false;
  if (na === nd) return true;
  if (na.includes(nd) || nd.includes(na)) return true;
  // Common drug class matching (penicillin class)
  const classes: Record<string, string[]> = {
    "пенициллин": ["амоксициллин", "ампициллин", "бензилпенициллин", "феноксиметилпенициллин", "пенициллин", "аугментин", "амоксиклав"],
    "цефалоспорин": ["цефазолин", "цефтриаксон", "цефуроксим", "цефепим", "цефиксим"],
    "сульфаниламид": ["бисептол", "ко-тримоксазол", "сульфаметоксазол"],
    "аспирин": ["ацетилсалициловая", "тромбо асс", "кардиомагнил", "аспирин"],
    "нпвс": ["ибупрофен", "диклофенак", "напроксен", "кеторолак", "нимесулид", "мелоксикам", "целекоксиб"],
  };
  for (const cls of Object.keys(classes)) {
    const drugs = classes[cls];
    const allergenIsClass = na.includes(cls);
    const drugIsInClass = drugs.some(d => drugMatch(d, nd) || nd.includes(d));
    if (allergenIsClass && drugIsInClass) return true;
  }
  return false;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requirePatientAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const session = access.session!;

  const url = new URL(req.url);
  const drugName = url.searchParams.get("drugName")?.trim() || "";
  const online = url.searchParams.get("online") === "true";

  if (!drugName) {
    return NextResponse.json({ error: "drugName parameter required" }, { status: 400 });
  }

  try {
    const patient = await db.patient.findUnique({
      where: { id },
      select: { allergies: true, chronicDiseases: true },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // 1. Allergy check
    const allergies = safeParseArr(patient.allergies) as Array<{ allergen: string; reaction: string; severity: string }>;
    const allergyMatches = allergies.filter(a => allergenMatch(a.allergen, drugName));

    // 2. DDI check — get patient's active medications
    const activeMeds = await db.medication.findMany({
      where: { patientId: id, status: "active" },
      select: { drugName: true, brandName: true, dosage: true, frequency: true },
    });

    const ddiAlerts: Array<{
      interactingDrug: string;
      severity: string;
      description: string;
      mechanism: string;
      management: string;
      evidenceLevel: string;
      source?: string;
      sourceUrl?: string;
      origin?: string;
      confidence?: string;
    }> = [];

    // v5.0: ПОТОКОВЫЙ ОНЛАЙН-ПОИСК в базах РФ (РЛС/Видаль/ГРЛС/КР Минздрава).
    // Возвращает алерты только для пар с ПРЕДЛАГАЕМЫМ препаратом.
    if (activeMeds.length > 0) {
      const combo = [drugName, ...activeMeds.map((m) => m.drugName)];
      const result = await checkDDIOnline(combo, online);
      const wordHead = (s: string) => (s || "").toLowerCase().split(/[\s+(/-]/)[0] ?? "";
      const proposedHead = wordHead(drugName);

      for (const alert of result.alerts) {
        const a1 = wordHead(alert.drug1);
        const a2 = wordHead(alert.drug2);
        // Включаем только алерты, где участвует предлагаемый препарат
        if (a1 === proposedHead || a2 === proposedHead) {
          const other = a1 === proposedHead ? alert.drug2 : alert.drug1;
          // Пропускаем самопары (препарат с самим собой)
          if (wordHead(other) === proposedHead) continue;
          ddiAlerts.push({
            interactingDrug: other,
            severity: alert.severity,
            description: alert.description,
            mechanism: alert.mechanism,
            management: alert.management,
            evidenceLevel: alert.evidenceLevel,
            source: alert.source,
            sourceUrl: alert.sourceUrls?.[0]?.url,
            origin: alert.origin,
            confidence: alert.confidence,
          });
        }
      }
    }

    // Determine overall safety level
    const hasContraindication = allergyMatches.some(a => a.severity === "severe") ||
      ddiAlerts.some(d => d.severity === "contraindication");
    const hasMajor = allergyMatches.some(a => a.severity === "moderate") ||
      ddiAlerts.some(d => d.severity === "major");

    const safetyLevel = hasContraindication ? "contraindicated"
      : hasMajor ? "major_warning"
      : (allergyMatches.length > 0 || ddiAlerts.length > 0) ? "caution"
      : "safe";

    logger.info("med-check", "Medication safety check", {
      patientId: id, drugName, safetyLevel,
      allergyCount: allergyMatches.length, ddiCount: ddiAlerts.length,
    });

    return NextResponse.json({
      drugName,
      safetyLevel,
      allergyAlerts: allergyMatches,
      ddiAlerts,
      activeMedications: activeMeds.map(m => ({ drugName: m.drugName, dosage: m.dosage, frequency: m.frequency })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("med-check", "Failed safety check", { error: msg, patientId: id });
    return NextResponse.json({ error: "Failed safety check", detail: msg }, { status: 500 });
  }
}
