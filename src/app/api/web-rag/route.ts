// СППВР v4.2 — Web RAG API (Минздрав РФ — ПРЯМОЙ РАЗБОР ПО ТЕМЕ)
// POST /api/web-rag — ИИ напрямую разбирает репозиторий КР Минздрава по теме
//   Body: { caseId?: string, topic?: string, customQuery?: string,
//           maxResults?: number, enableContentFetch?: boolean, icd10Codes?: string[] }
//   • topic/customQuery — тема разбора (напр. «тактика лечения гипертензии»):
//     поиск КР → полные тексты → парсинг всех разделов → фрагменты по теме
//   • caseId — тема строится из диагноза/выписки кейса (санитизируется)
//   Returns: { results, topic, parsedFragments, sanitizedQuery, fetchedAt, fromCache }
//
// GET /api/web-rag — Check web RAG availability (no search performed)
//   Returns: { available: true, sources: [...] }
//
// v4.2: ИИ подключается НАПРЯМУЮ к официальному репозиторию КР Минздрава РФ
// (cr.minzdrav.gov.ru, API — apicr.minzdrav.gov.ru) и парсит его по теме.
//
// PRIVACY: This endpoint runs the query sanitizer BEFORE any network call.
// No PHI ever leaves the server. The search query contains ONLY clinical
// terms (diagnosis names, gene symbols, medication INNs, ICD-10 codes).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runWebRag } from "@/lib/web-rag";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import { requireCaseAccess } from "@/lib/case-access";
import { appendAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AUTHORITATIVE_SOURCES = [
  "Минздрав РФ — Клинические рекомендации (cr.minzdrav.gov.ru/clin-rec)",
  "Минздрав РФ — API репозитория КР (apicr.minzdrav.gov.ru)",
];

export async function GET() {
  return NextResponse.json({
    available: true,
    description:
      "Web RAG v4.2 — ИИ напрямую подключается к репозиторию КР Минздрава РФ (cr.minzdrav.gov.ru) и парсит его по теме запроса: поиск КР → полные тексты → все разделы → фрагменты, релевантные теме",
    sources: AUTHORITATIVE_SOURCES,
    privacyNote:
      "All queries are sanitized to remove PHI before sending to the Минздрав repository. Only clinical terms (diagnosis, gene, medication INN, ICD-10) are used.",
    cacheTTL: "Список КР — 24 ч, полный текст КР — 7 дней, МКБ — 30 дней (SQLite + память; полные тексты кэшируются в облегчённом виде — без base64-изображений)",
  });
}

export async function POST(req: Request) {
  try {
    const session = await requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const { caseId, topic, maxResults, enableContentFetch, customQuery, icd10Codes } = body as {
      caseId?: string;
      topic?: string;
      maxResults?: number;
      enableContentFetch?: boolean;
      customQuery?: string;
      icd10Codes?: string[];
    };

    // If a caseId is provided, load the case and build the query from its
    // de-identified data. If topic/customQuery is provided (admin/debug only),
    // use it directly as the parse topic (still sanitized).
    let diagnosisHint: string | null | undefined;
    let dischargeSummary: string | undefined;
    let mutations: Array<{ gene: string; variant: string }> | undefined;
    let medications: string[] | undefined;
    let entities: Array<{ type: string; value: string }> | undefined;
    let parseTopic: string | undefined;

    if (caseId) {
      // SECURITY (v4.3 audit fix): enforce case ownership before loading the
      // case's de-identified data into the RAG query. Previously any
      // authenticated doctor could feed ANY case's diagnosis/discharge/
      // mutations into the Минздрав search and infer the victim's diagnosis
      // from the returned clinical recommendations.
      const access = await requireCaseAccess(caseId, req);
      if (!access.ok) return access.response;

      const found = await db.case.findUnique({
        where: { id: caseId },
        include: {
          documents: { where: { fileType: "discharge" } },
          analysis: true,
        },
      });
      if (!found) {
        return NextResponse.json({ error: "Case not found" }, { status: 404 });
      }
      diagnosisHint = found.diagnosisHint;
      dischargeSummary = found.documents
        .map((d) => d.deidContent)
        .join("\n\n")
        .slice(0, 3000);

      if (found.analysis) {
        try {
          mutations = JSON.parse(found.analysis.mutations || "[]");
        } catch { /* ignore */ }
        try {
          entities = JSON.parse(found.analysis.entities || "[]");
        } catch { /* ignore */ }
      }

      // Audit the web RAG request
      await appendAudit({
        caseId,
        doctorId: session.doctorId,
        action: "web_rag_search",
        details: JSON.stringify({
          maxResults: maxResults ?? 8,
          enableContentFetch: enableContentFetch ?? true,
        }),
      }).catch(() => {});
    } else if (topic || customQuery) {
      // Debug/direct mode: тема разбора репозитория (санитизируется в runWebRag)
      parseTopic = (topic || customQuery)!;
    } else {
      return NextResponse.json(
        { error: "Either caseId, topic or customQuery must be provided." },
        { status: 400 },
      );
    }

    const result = await runWebRag({
      topic: parseTopic,
      diagnosisHint,
      dischargeSummary,
      mutations,
      medications,
      entities,
      maxResults,
      enableContentFetch,
      icd10Codes,
    });

    logger.info("web-rag", "Web RAG API response", {
      caseId: caseId ?? "custom",
      resultCount: result.results.length,
      fromCache: result.fromCache,
      termsUsed: result.sanitizedQuery.terms,
      removedPHICount: result.sanitizedQuery.removedPHI.length,
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    logger.error("web-rag", "Web RAG API error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}
