// СППВР v2.1 — Global Knowledge Search API (aggregator)
// ============================================================================
// GET /api/knowledge?q=<query>&limit=<n>
//
// Fans a single search query out to ALL 5 knowledge sources (clinical
// recommendations, drug-drug interactions, ICD-10 codes, clinical pathways,
// and uploaded knowledge documents) in parallel via Prisma Promise.all,
// then merges the results into a single ranked list with a per-result
// relevance score.
//
// Returns:
//   {
//     results: Array<{
//       source: "recommendation"|"ddi"|"icd10"|"pathway"|"document",
//       id, title, snippet, metadata, score
//     }>,
//     counts: { recommendation, ddi, icd10, pathway, document }
//   }
//
// Authentication: REQUIRED (all knowledge endpoints require auth per v2.1
// security hardening). Uses getSessionFromRequest from @/lib/auth.
//
// Case-insensitive search: SQLite's default `LIKE` is case-insensitive for
// ASCII but case-SENSITIVE for Cyrillic. To compensate, we issue dual OR
// clauses (q.toLowerCase + q.toUpperCase) for every searchable field — this
// catches all-lowercase and all-uppercase variants. Mixed-case Cyrillic
// queries still may miss some matches; the relevance score is computed
// case-insensitively after fetch so ranking is correct regardless.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface RawResult {
  source: "recommendation" | "ddi" | "icd10" | "pathway" | "document";
  id: string;
  title: string;
  snippet: string;
  metadata: Record<string, unknown>;
  score: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count case-insensitive occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string | null | undefined, needle: string): number {
  if (!needle || !haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let idx = h.indexOf(n);
  while (idx !== -1) {
    count++;
    idx = h.indexOf(n, idx + n.length);
  }
  return count;
}

/**
 * Build a snippet of `text` centered around the first match of `q`,
 * capped at `maxLen` characters with ellipsis on either side if truncated.
 */
function makeSnippet(text: string, q: string, maxLen = 240): string {
  if (!text) return "";
  if (!q || text.length <= maxLen) {
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  }
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) {
    return text.slice(0, maxLen) + "…";
  }
  const pad = Math.floor((maxLen - q.length) / 2);
  const start = Math.max(0, idx - pad);
  const end = Math.min(text.length, idx + q.length + pad);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    // 1. Authentication — all knowledge endpoints require auth
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam
      ? Math.min(
          Math.max(parseInt(limitParam, 10) || DEFAULT_LIMIT, 1),
          MAX_LIMIT,
        )
      : DEFAULT_LIMIT;

    // Empty query → empty result (client shows "type to search" hint)
    if (!q) {
      return NextResponse.json({
        results: [],
        counts: { recommendation: 0, ddi: 0, icd10: 0, pathway: 0, document: 0 },
      });
    }

    // Dual-case WHERE clauses for Cyrillic + ASCII case-insensitivity.
    const qLower = q.toLowerCase();
    const qUpper = q.toUpperCase();

    const [recs, ddis, codes, pathways, documents] = await Promise.all([
      db.clinicalRecommendation.findMany({
        where: {
          OR: [
            { title: { contains: qLower } },
            { title: { contains: qUpper } },
            { content: { contains: qLower } },
            { content: { contains: qUpper } },
            { keywords: { contains: qLower } },
            { keywords: { contains: qUpper } },
            { gene: { contains: qUpper } },
            { gene: { contains: qLower } },
          ],
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      db.drugInteraction.findMany({
        where: {
          OR: [
            { drug1: { contains: qLower } },
            { drug1: { contains: qUpper } },
            { drug2: { contains: qLower } },
            { drug2: { contains: qUpper } },
            { description: { contains: qLower } },
            { description: { contains: qUpper } },
          ],
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      db.iCD10Code.findMany({
        where: {
          OR: [
            { code: { contains: qUpper } },
            { code: { contains: qLower } },
            { description: { contains: qLower } },
            { description: { contains: qUpper } },
            { block: { contains: qLower } },
            { block: { contains: qUpper } },
            { chapter: { contains: qLower } },
            { chapter: { contains: qUpper } },
          ],
        },
        take: limit,
        orderBy: { code: "asc" },
      }),
      db.clinicalPathway.findMany({
        where: {
          AND: [
            { isActive: true },
            {
              OR: [
                { name: { contains: qLower } },
                { name: { contains: qUpper } },
                { description: { contains: qLower } },
                { description: { contains: qUpper } },
                { category: { contains: qLower } },
                { category: { contains: qUpper } },
                { icd10Code: { contains: qUpper } },
                { icd10Code: { contains: qLower } },
              ],
            },
          ],
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      // v2.1.4: search uploaded KnowledgeDocuments by title/fileName/rawText
      db.knowledgeDocument.findMany({
        where: {
          AND: [
            { isActive: true },
            {
              OR: [
                { title: { contains: qLower } },
                { title: { contains: qUpper } },
                { fileName: { contains: qLower } },
                { fileName: { contains: qUpper } },
                { rawText: { contains: qLower } },
                { rawText: { contains: qUpper } },
              ],
            },
          ],
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Build unified results with relevance scoring
    const results: RawResult[] = [];

    for (const r of recs) {
      const score =
        countOccurrences(r.title, q) * 3 +
        countOccurrences(r.content, q) * 2 +
        countOccurrences(r.keywords, q) +
        (r.gene ? countOccurrences(r.gene, q) * 5 : 0);
      results.push({
        source: "recommendation",
        id: r.id,
        title: r.title,
        snippet: makeSnippet(r.content || r.title, q),
        metadata: {
          category: r.category,
          gene: r.gene,
          mutation: r.mutation,
          evidenceLevel: r.evidenceLevel,
          source: r.source,
        },
        score,
      });
    }

    for (const d of ddis) {
      const pair = `${d.drug1} + ${d.drug2}`;
      const score =
        countOccurrences(d.drug1, q) * 3 +
        countOccurrences(d.drug2, q) * 3 +
        countOccurrences(d.description, q) * 2 +
        countOccurrences(d.mechanism, q);
      results.push({
        source: "ddi",
        id: d.id,
        title: pair,
        snippet: makeSnippet(d.description || pair, q),
        metadata: {
          severity: d.severity,
          mechanism: d.mechanism,
          management: d.management,
          evidenceLevel: d.evidenceLevel,
          source: d.source,
        },
        score,
      });
    }

    for (const c of codes) {
      const score =
        countOccurrences(c.code, q) * 5 +
        countOccurrences(c.description, q) * 2 +
        countOccurrences(c.block, q) +
        countOccurrences(c.chapter, q);
      results.push({
        source: "icd10",
        id: c.id,
        title: c.code,
        snippet: makeSnippet(c.description, q),
        metadata: {
          code: c.code,
          description: c.description,
          chapter: c.chapter,
          block: c.block,
        },
        score,
      });
    }

    for (const p of pathways) {
      const score =
        countOccurrences(p.name, q) * 3 +
        countOccurrences(p.description, q) * 2 +
        countOccurrences(p.category, q) +
        (p.icd10Code ? countOccurrences(p.icd10Code, q) * 2 : 0);
      results.push({
        source: "pathway",
        id: p.id,
        title: p.name,
        snippet: makeSnippet(p.description, q),
        metadata: {
          category: p.category,
          icd10Code: p.icd10Code,
          version: p.version,
          source: p.source,
        },
        score,
      });
    }

    // v2.1.4: uploaded knowledge documents — search across title/fileName/rawText.
    // Score weights: title match (×5), fileName match (×2), rawText match (×1).
    for (const d of documents) {
      const score =
        countOccurrences(d.title, q) * 5 +
        countOccurrences(d.fileName, q) * 2 +
        countOccurrences(d.rawText, q);
      results.push({
        source: "document",
        id: d.id,
        title: d.title || d.fileName,
        snippet: makeSnippet(d.rawText || d.title, q),
        metadata: {
          fileName: d.fileName,
          fileType: d.fileType,
          category: d.category,
          chunkCount: d.chunkCount,
          fileSize: d.fileSize,
          source: d.source,
          createdAt: d.createdAt,
        },
        score,
      });
    }

    // Sort: score desc, tie-break alphabetically by title
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const counts = {
      recommendation: recs.length,
      ddi: ddis.length,
      icd10: codes.length,
      pathway: pathways.length,
      document: documents.length,
    };

    logger.info("api", "Global knowledge search", {
      q,
      doctorId: session.doctorId,
      totalResults: results.length,
      counts,
    });

    return NextResponse.json({ results, counts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
