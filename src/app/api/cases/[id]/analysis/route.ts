// СППВР v2.0 — Get analysis result for case
// GET /api/cases/[id]/analysis

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeJsonParse, parseStructured } from "@/lib/utils";
import { requireCaseAccess } from "@/lib/case-access";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // SECURITY (v2.1.4): verify the requesting session can see this case
    // before returning its analysis (which contains mutations, ICD-10 codes,
    // DDI alerts, conclusion — all PHI).
    const access = await requireCaseAccess(id, req);
    if (!access.ok) return access.response;

    const analysis = await db.analysisResult.findUnique({
      where: { caseId: id },
    });
    if (!analysis) {
      return NextResponse.json({ error: "Analysis not performed", analysis: null }, { status: 404 });
    }

    const data = {
      id: analysis.id,
      caseId: analysis.caseId,
      entities: safeJsonParse(analysis.entities, []),
      mutations: safeJsonParse(analysis.mutations, []),
      recommendations: safeJsonParse(analysis.recommendations, []),
      conclusion: analysis.conclusion,
      sections: safeJsonParse(analysis.sections, []),
      confidence: safeJsonParse(analysis.confidence, {}),
      citations: safeJsonParse(analysis.citations, []),
      imageFindings: safeJsonParse(analysis.imageFindings, []),
      controlWeights: safeJsonParse(analysis.controlWeights, {}),
      doctorComments: safeJsonParse(analysis.doctorComments, []),
      therapyRecommendations: safeJsonParse(analysis.therapyRecommendations, []),
      ddiAlerts: safeJsonParse(analysis.ddiAlerts, []),
      icd10Suggestions: safeJsonParse(analysis.icd10Suggestions, []),
      pathwayMatches: safeJsonParse(analysis.pathwayMatches, []),
      // v5.0: структурированные клинические данные
      structured: parseStructured(analysis.structured),
      version: analysis.version,
      createdAt: analysis.createdAt.toISOString(),
      updatedAt: analysis.updatedAt.toISOString(),
    };
    return NextResponse.json({ analysis: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "analysis GET error", { caseId: id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
