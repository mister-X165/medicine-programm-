// СППВР v2.0 — Seed Database API
// POST /api/seed — Seed clinical recommendations, ICD-10, DDI, clinical pathways
// GET  /api/seed — Get seed info
//
// SECURITY (v2.1):
//   - Admin-only (enforced by src/middleware.ts matcher).
//   - Removed hardcoded admin password (it's now generated on init, never here).
//   - Chunked inserts — Prisma's `$transaction(items.map(create))` on SQLite
//     explodes the SQL plan cache and triggers "too many SQL variables" /
//     "transaction too large" errors on real-world seed sizes (~100+ rows).
//     We chunk by BATCH_SIZE=50 and use createMany where possible.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clinicalRecommendations, CLINICAL_RECOMMENDATIONS_COUNT } from "@/lib/seed/clinical-recommendations";
import { icd10Codes, ICD10_CODES_COUNT } from "@/lib/seed/icd10-codes";
import { drugInteractions, DRUG_INTERACTIONS_COUNT } from "@/lib/seed/drug-interactions";
import { clinicalPathways, CLINICAL_PATHWAYS_COUNT } from "@/lib/seed/clinical-pathways";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_DOCTOR = {
  fullName: "Demo Doctor",
  specialization: "Oncologist-Geneticist",
  doctorCode: "VR-001",
} as const;

const ADMIN_DOCTOR_CODE = "ADMIN";

const BATCH_SIZE = 50;

/**
 * Chunked insert using createMany. Prisma 6 + SQLite does NOT support
 * `skipDuplicates` (it's a no-op argument that throws "Unknown argument"),
 * so we deduplicate in JS BEFORE inserting and rely on deleteMany({}) above
 * to ensure the table is empty.
 */
async function bulkInsert<T>(
  model: { createMany: (args: { data: T[] }) => Promise<{ count: number }> },
  rows: readonly T[],
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await model.createMany({ data: batch });
    total += result.count;
  }
  return total;
}

/**
 * Deduplicate rows by a key — used to avoid UNIQUE constraint violations
 * when the seed data accidentally contains duplicates.
 */
function dedupeBy<T>(rows: readonly T[], keyFn: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = keyFn(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: re-seeding wipes clinical KB — admin only.
    await requireAdmin(req);
    // ─── 1. Upsert demo doctor (idempotent) ─────────────────────────────
    const doctor = await db.doctor.upsert({
      where: { doctorCode: DEFAULT_DOCTOR.doctorCode },
      update: {
        fullName: DEFAULT_DOCTOR.fullName,
        specialization: DEFAULT_DOCTOR.specialization,
      },
      create: { ...DEFAULT_DOCTOR },
    });

    // ─── 2. Ensure admin exists. Password is NOT touched here — if the
    // admin already has a password, we preserve it. If they don't, we
    // refuse and tell the operator to use /api/auth/init.
    const admin = await db.doctor.findUnique({
      where: { doctorCode: ADMIN_DOCTOR_CODE },
    });
    if (!admin) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Admin profile not found. Run /api/auth/init first to create the admin and capture the one-time password.",
        },
        { status: 409 },
      );
    }

    // ─── 3. Clear & reseed clinical recommendations ────────────────────
    await db.clinicalRecommendation.deleteMany({});

    const recRows = dedupeBy(clinicalRecommendations, (r) => r.title).map((rec) => ({
      title: rec.title,
      category: rec.category,
      gene: rec.gene ?? null,
      mutation: rec.mutation ?? null,
      content: rec.content,
      keywords: rec.keywords,
      source: rec.source,
      evidenceLevel: rec.evidenceLevel,
    }));
    const recCount = await bulkInsert(db.clinicalRecommendation, recRows);

    // ─── 4. Clear & reseed ICD-10 codes ────────────────────────────────
    await db.iCD10Code.deleteMany({});

    const icdRows = dedupeBy(icd10Codes, (c) => c.code).map((code) => ({
      code: code.code,
      description: code.description,
      chapter: code.chapter,
      block: code.block,
      parentCode: code.parentCode,
    }));
    const icdCount = await bulkInsert(db.iCD10Code, icdRows);

    // ─── 5. Clear & reseed drug interactions ───────────────────────────
    await db.drugInteraction.deleteMany({});

    const ddiRows = dedupeBy(drugInteractions, (d) => `${d.drug1}|${d.drug2}`).map((di) => ({
      drug1: di.drug1,
      drug2: di.drug2,
      severity: di.severity,
      description: di.description,
      mechanism: di.mechanism,
      management: di.management,
      evidenceLevel: di.evidenceLevel,
      source: di.source,
    }));
    const ddiCount = await bulkInsert(db.drugInteraction, ddiRows);

    // ─── 6. Clear & reseed clinical pathways ───────────────────────────
    await db.clinicalPathway.deleteMany({});

    const pathwayRows = dedupeBy(clinicalPathways, (p) => p.name).map((cp) => ({
      name: cp.name,
      icd10Code: cp.icd10Code,
      category: cp.category,
      description: cp.description,
      steps: JSON.stringify(cp.steps),
      criteria: JSON.stringify(cp.criteria),
      medications: JSON.stringify(cp.medications),
      monitoring: JSON.stringify(cp.monitoring),
      source: cp.source,
      version: cp.version,
    }));
    const pathwayCount = await bulkInsert(db.clinicalPathway, pathwayRows);

    logger.info("seed", "Database seeded successfully", {
      recCount,
      icdCount,
      ddiCount,
      pathwayCount,
    });

    return NextResponse.json({
      success: true,
      recommendations: recCount,
      icd10Codes: icdCount,
      drugInteractions: ddiCount,
      clinicalPathways: pathwayCount,
      expected: {
        recommendations: CLINICAL_RECOMMENDATIONS_COUNT,
        icd10Codes: ICD10_CODES_COUNT,
        drugInteractions: DRUG_INTERACTIONS_COUNT,
        clinicalPathways: CLINICAL_PATHWAYS_COUNT,
      },
      doctor: {
        id: doctor.id,
        fullName: doctor.fullName,
        doctorCode: doctor.doctorCode,
        role: doctor.role,
      },
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        doctorCode: admin.doctorCode,
        role: admin.role,
        passwordSet: !!admin.passwordHash,
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "Authentication required" || error.message === "Admin access required")) {
      const status = error.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.error("seed", "Seed error", {
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    source: "seed data files",
    clinicalRecommendations: CLINICAL_RECOMMENDATIONS_COUNT,
    icd10Codes: ICD10_CODES_COUNT,
    drugInteractions: DRUG_INTERACTIONS_COUNT,
    clinicalPathways: CLINICAL_PATHWAYS_COUNT,
  });
}
