// СППВР v2.0 — Clinical Pathways API
// GET  /api/pathways?category=...&icd10Code=... — List clinical pathways
// POST /api/pathways — Match clinical pathways for a case

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchClinicalPathways } from "@/lib/rag";
import { matchPathwaySchema, validateOrThrow } from "@/lib/validation";
import { safeJsonParse } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import type { ICD10CodeMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

// v2.7.2 (audit fix): нормализация source к строгому union ("ai" | "manual").
function normalizeIcd10Matches(
  raw: Array<{ code: string; description: string; confidence: number; source: string }> | undefined,
): ICD10CodeMatch[] {
  if (!raw) return [];
  return raw
    .filter((c) => c && typeof c.code === "string" && c.code.trim() !== "")
    .map((c) => ({
      code: c.code,
      description: typeof c.description === "string" ? c.description : "",
      confidence: typeof c.confidence === "number" && isFinite(c.confidence) ? c.confidence : 0.5,
      source: c.source === "ai" ? ("ai" as const) : ("manual" as const),
    }));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category")?.trim() || undefined;
    const icd10Code = url.searchParams.get("icd10Code")?.trim() || undefined;

    const where: Record<string, unknown> = { isActive: true };
    if (category) where.category = category;
    if (icd10Code) where.icd10Code = { contains: icd10Code.toUpperCase() };

    const pathways = await db.clinicalPathway.findMany({
      where,
      orderBy: { category: "asc" },
    });

    const result = pathways.map((p) => ({
      id: p.id,
      name: p.name,
      icd10Code: p.icd10Code,
      category: p.category,
      description: p.description,
      steps: safeJsonParse(p.steps, []),
      medications: safeJsonParse(p.medications, []),
      monitoring: safeJsonParse(p.monitoring, []),
      source: p.source,
      version: p.version,
      isActive: p.isActive,
    }));

    return NextResponse.json({ pathways: result, count: result.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: require auth (defense-in-depth).
    await requireAuth(req);
    const body = await req.json();
    const data = validateOrThrow(matchPathwaySchema, body);

    const matches = await matchClinicalPathways(
      data.diagnosis || "",
      normalizeIcd10Matches(data.icd10Codes),
      [],
    );

    logger.info("pathways", "Clinical pathways matched", { count: matches.length });

    return NextResponse.json({ pathways: matches, count: matches.length });
  } catch (e) {
    if (e instanceof Error && e.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (e instanceof Error && e.message.startsWith("Validation error")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
