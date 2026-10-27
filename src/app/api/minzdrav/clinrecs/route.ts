// СППВР v4.1 — API поиска КР Минздрава РФ
// GET /api/minzdrav/clinrecs?q=<текст>&mkb=E11,E10&age=2&page=1&pageSize=10&includeContent=true
//   Поиск утверждённых клинических рекомендаций в ОФИЦИАЛЬНОМ репозитории
//   Минздрава РФ (cr.minzdrav.gov.ru/clin-rec, backend apicr.minzdrav.gov.ru).
//   Возвращает нормализованные карточки КР с ссылками на просмотр и PDF.
//
// Все запросы кэшируются в SQLite (MinzdravCache): список — 24 ч,
// полный текст — 7 дней. При офлайне отдаётся кэш.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import {
  findClinrecs,
  searchClinrecs,
  getMinzdravCacheStats,
  MINZDRAV_ENABLED,
} from "@/lib/minzdrav-cr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  }

  if (!MINZDRAV_ENABLED) {
    return NextResponse.json(
      { error: "Поиск в репозитории Минздрава отключён администратором (MINZDRAV_CR_ENABLED=false)" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const mkbRaw = url.searchParams.get("mkb")?.trim() ?? "";
  const ageRaw = url.searchParams.get("age");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(30, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "10", 10) || 10));
  const includeContent = url.searchParams.get("includeContent") === "true";
  const statsOnly = url.searchParams.get("stats") === "true";

  // Только статистика кэша (для системного статуса)
  if (statsOnly) {
    const stats = await getMinzdravCacheStats();
    return NextResponse.json({
      source: "Минздрав РФ — Клинические рекомендации",
      site: "https://cr.minzdrav.gov.ru/clin-rec",
      cache: stats,
    });
  }

  const mkbCodes = mkbRaw
    .split(/[,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-TV-Z][0-9]{2}(\.[0-9]{1,2})?$/.test(c))
    .slice(0, 5);

  const ageCategory = ageRaw ? parseInt(ageRaw, 10) : null;
  const validAge = ageCategory && [1, 2, 3].includes(ageCategory) ? ageCategory : null;

  if (!q && mkbCodes.length === 0) {
    return NextResponse.json(
      { error: "Укажите параметр q (текст поиска) или mkb (коды МКБ-10)" },
      { status: 400 },
    );
  }

  try {
    const started = Date.now();
    const matches = await findClinrecs({
      query: q || undefined,
      mkbCodes: mkbCodes.length > 0 ? mkbCodes : undefined,
      ageCategory: validAge,
      page,
      pageSize,
      includeContent,
      maxContentFetch: 3,
      terms: q ? q.split(/\s+/).filter((t) => t.length > 2).slice(0, 5) : [],
    });

    // Общее количество записей для пагинации
    const { total, fromCache, error } = await searchClinrecs({
      query: q || undefined,
      mkbCodes: mkbCodes.length > 0 ? mkbCodes : undefined,
      ageCategory: validAge,
      page,
      pageSize,
    });

    const cacheStats = await getMinzdravCacheStats();

    if (q.length > 2) {
      appendAudit({
        doctorId: session.doctorId,
        action: "minzdrav_cr_search",
        details: JSON.stringify({ query: q.slice(0, 120), mkbCodes, results: matches.length }),
      }).catch(() => {});
    }

    logger.info("minzdrav-api", "CR search served", {
      q: q.slice(0, 60),
      mkbCodes,
      found: matches.length,
      total,
      fromCache,
      ms: Date.now() - started,
    });

    return NextResponse.json({
      source: "Минздрав РФ — Клинические рекомендации",
      repository: "https://cr.minzdrav.gov.ru/clin-rec",
      results: matches,
      total,
      page,
      pageSize,
      fromCache,
      error: error && matches.length === 0 ? error : undefined,
      cache: cacheStats,
    });
  } catch (e) {
    logger.error("minzdrav-api", "CR search failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: `Ошибка поиска КР Минздрава: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
