// СППВР v2.0 — Analysis Version History API
// GET /api/cases/[id]/analysis/versions — Get analysis version history
//
// v2.1.2 (Task 2-d): returns the FULL parsed snapshot for each version so the
// UI can render side-by-side diffs without a second round-trip per version.
// Also appends a synthetic "current" entry (isCurrent=true) representing the
// live AnalysisResult row — the latest version is NOT stored as an
// AnalysisVersion snapshot (it IS the current state), so we synthesize one
// here so the dialog can diff "previous → current" out of the box.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeJsonParse, parseStructured } from "@/lib/utils";
import { requireCaseAccess } from "@/lib/case-access";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type Snapshot = Record<string, unknown>;

function parseSnapshot(raw: string | null | undefined): Snapshot {
  if (!raw) return {};
  return safeJsonParse<Snapshot>(raw, {}) ?? {};
}

function buildCurrentSnapshot(a: {
  entities: string;
  mutations: string;
  recommendations: string;
  conclusion: string;
  sections: string;
  confidence: string;
  citations: string;
  imageFindings: string;
  ddiAlerts: string;
  icd10Suggestions: string;
  pathwayMatches: string;
  structured?: string | null;
}): Snapshot {
  return {
    entities: safeJsonParse(a.entities, []),
    mutations: safeJsonParse(a.mutations, []),
    recommendations: safeJsonParse(a.recommendations, []),
    conclusion: a.conclusion,
    sections: safeJsonParse(a.sections, []),
    confidence: safeJsonParse(a.confidence, {}),
    citations: safeJsonParse(a.citations, []),
    imageFindings: safeJsonParse(a.imageFindings, []),
    ddiAlerts: safeJsonParse(a.ddiAlerts, []),
    icd10Suggestions: safeJsonParse(a.icd10Suggestions, []),
    pathwayMatches: safeJsonParse(a.pathwayMatches, []),
    // v5.0: структурированные клинические данные в текущем состоянии
    structured: parseStructured(a.structured),
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  try {
    // SECURITY (v2.1.4): verify the requesting session can see this case
    // before returning version history (snapshots contain PHI).
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;

    const analysis = await db.analysisResult.findUnique({
      where: { caseId },
    });

    if (!analysis) {
      return NextResponse.json(
        { error: "Analysis not found", versions: [], currentVersion: 0, totalVersions: 0 },
        { status: 404 },
      );
    }

    const versionRows = await db.analysisVersion.findMany({
      where: { analysisId: analysis.id },
      orderBy: { version: "desc" },
    });

    // Historical version rows (each one's snapshot is the state of the analysis
    // AT that version number, captured just before the next re-analysis overwrote it).
    const historical = versionRows.map((v) => ({
      id: v.id,
      analysisId: v.analysisId,
      version: v.version,
      changeNote: v.changeNote,
      doctorId: v.doctorId,
      createdAt: v.createdAt.toISOString(),
      snapshot: parseSnapshot(v.snapshot),
      snapshotSize: v.snapshot.length,
      isCurrent: false,
    }));

    // Synthetic "current" entry — represents the live AnalysisResult row.
    // This is the newest version (analysis.version) and has no AnalysisVersion row
    // because the snapshot is only written when a NEW version supersedes it.
    const currentEntry = {
      id: `current-${analysis.id}`,
      analysisId: analysis.id,
      version: analysis.version,
      changeNote: "Текущая версия (активна)",
      doctorId: null,
      createdAt: analysis.updatedAt.toISOString(),
      snapshot: buildCurrentSnapshot(analysis),
      snapshotSize: 0,
      isCurrent: true,
    };

    // Combine + sort by version DESC so newest is first.
    const versions = [currentEntry, ...historical].sort(
      (a, b) => b.version - a.version,
    );

    return NextResponse.json({
      versions,
      currentVersion: analysis.version,
      totalVersions: versions.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "analysis/versions GET error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
