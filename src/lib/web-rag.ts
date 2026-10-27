// СППВР v5.0 — Web RAG Module (КР Минздрава РФ + МЕЖДУНАРОДНЫЕ ИСТОЧНИКИ)
// ============================================================================
// PURPOSE: ИИ НАПРЯМУЮ подключается к официальному репозиторию клинических
// рекомендаций Минздрава РФ — https://cr.minzdrav.gov.ru/clin-rec — и
// ПАРСИТ его ПО ТЕМЕ ЗАПРОСА (см. minzdrav-rag.ts):
//
// v5.0: ДОБАВЛЕН ПОИСК ПО МЕЖДУНАРОДНЫМ АВТОРИТЕТНЫМ ИСТОЧНИКАМ (см.
// international-rag.ts): PubMed/NLM (рецензируемые обзоры, метаанализы,
// гайдлайны), ВОЗ, NICE, Cochrane, CDC, ESC, EMA, NCBI Bookshelf, NCCN —
// через NCBI E-utilities и DuckDuckGo site-фильтр по доверенным доменам.
// Запросы санитизируются (PHI исключается) и переводятся в англоязычное
// терминологическое ядро. Приоритет в синтезе — за КР Минздрава РФ;
// международные источники идут для сопоставления и дополнительной
// доказательной базы.
//
//   sanitizeCaseForQuery() → extractDiagnosisPhrasesForCrSearch()
//     → parseClinrecsByTopic()  [ПОИСК КР → ПОЛНЫЕ ТЕКСТЫ → ПАРСИНГ ВСЕХ
//                                РАЗДЕЛОВ → РАНЖИРОВАНИЕ ФРАГМЕНТОВ ПО ТЕМЕ]
//     → buildWebRagContext() → LLM
//
// v4.2 REWORK (прямое подключение ИИ к репозиторию Минздрава):
//   Ранее (v4.1) модуль брал короткие выдержки из ФИКСИРОВАННЫХ разделов
//   (doc_diag_2*, doc_3) с обрезанием на 2200 символов. Теперь полный текст
//   каждой найденной КР разбирается ЦЕЛИКОМ (все разделы, включая «Лечение»,
//   «Алгоритмы действий врача» (Прил. Б), «Шкалы» (Прил. Г)), нарезается на
//   фрагменты ~900 символов, и ИИ получает ИМЕННО ТЕ фрагменты, которые
//   релевантны теме запроса. Это настоящий topic-driven RAG поверх
//   официального репозитория Минздрава РФ.
//
// Каждая найденная КР содержит:
//   • Название, код/версию (напр. 62_3), коды МКБ-10, возрастную категорию
//   • Дату размещения, разработчиков (НКО), признак одобрения НПС Минздрава
//   • Разобранные ПО ТЕМЕ фрагменты разделов (диагностика/лечение/шкалы/…)
//   • Прямую ссылку на официальный источник и PDF
//
// PRIVACY (ФЗ-152, ФЗ-323 ст. 13):
//   Наружу отправляются ТОЛЬКО санитизированные клинические термины
//   (названия диагнозов, гены, МНН препаратов, коды МКБ-10) — без ФИО,
//   дат, и нарратива. См. query-sanitizer.ts.
//
// OFFLINE / НАДЁЖНОСТЬ:
//   Все ответы Минздрава кэшируются в SQLite (MinzdravCache) с TTL
//   (список 24 ч, полный текст 7 дней, МКБ 30 дней; полные тексты пишутся
//   в кэш в облегчённом виде — без base64-картинок). При отсутствии
//   интернета система отдаёт кэш — врач продолжает работать.
// ============================================================================

import { logger } from "./logger";
import {
  sanitizeCaseForQuery,
  extractDiagnosisPhrasesForCrSearch,
  type SanitizedQuery,
} from "./query-sanitizer";
import { checkNetwork, getNetworkStatus } from "./network-health";
import {
  MINZDRAV_ENABLED,
  MINZDRAV_CR_SITE,
} from "./minzdrav-cr";
import {
  runInternationalRag,
  type IntlRagResult,
} from "./international-rag";
import {
  parseClinrecsByTopic,
  ragMatchesToSummary,
  type RagFragment,
  type TopicRagResult,
} from "./minzdrav-rag";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const WEB_RAG_ENABLED = process.env.WEB_RAG_ENABLED !== "false"; // default: true
const WEB_RAG_DEFAULT_MAX = parseInt(process.env.WEB_RAG_MAX_RESULTS ?? "6", 10);
const WEB_RAG_CACHE_TTL_MS = parseInt(
  process.env.WEB_RAG_CACHE_TTL_MS ?? String(24 * 60 * 60 * 1000),
  10,
);

/** Официальный источник (единственный) для отображения в UI. */
export const AUTHORITATIVE_SOURCE = {
  name: "Минздрав РФ — Клинические рекомендации",
  site: MINZDRAV_CR_SITE,
  repository: `${MINZDRAV_CR_SITE}/clin-rec`,
  api: "https://apicr.minzdrav.gov.ru/api.ashx",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebRagResult {
  title: string;
  url: string;
  source: string; // "Минздрав РФ — Клинические рекомендации" | "PubMed — NLM" | "ВОЗ (WHO)" | …
  snippet: string;
  publishedDate?: string;
  contentExcerpt?: string; // собранные по теме фрагменты КР
  relevanceScore: number; // 0..1
  codeVersion?: string; // "62_3" — код/версия КР в репозитории
  /** Фрагменты, отобранные ИИ при разборе полного текста КР по теме. */
  fragments?: RagFragment[];
}

export interface WebRagResponse {
  results: WebRagResult[];
  sanitizedQuery: SanitizedQuery;
  /** v4.2: тема, по которой ИИ напрямую разбирал репозиторий. */
  topic?: string;
  /** v4.2: сколько фрагментов разобрано из полных текстов КР. */
  parsedFragments?: number;
  /** v5.0: англоязычный запрос, ушедший в международные источники. */
  intlEnglishQuery?: string;
  error?: string;
  fromCache?: boolean;
  fetchedAt: string;
  networkStatus?: {
    online: boolean;
    lastError: string | null;
    circuitOpen: boolean;
  };
}

// ---------------------------------------------------------------------------
// In-memory cache (краткосрочный, поверх персистентного кэша Минздрава)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = WEB_RAG_CACHE_TTL_MS;

interface CacheEntry {
  response: WebRagResponse;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function getCached(key: string): WebRagResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { ...entry.response, fromCache: true };
}

function setCached(key: string, response: WebRagResponse): void {
  cache.set(key, {
    response,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expiresAt) cache.delete(k);
    }
  }
}

function getNetworkStatusSnapshot(): {
  online: boolean;
  lastError: string | null;
  circuitOpen: boolean;
} {
  const s = getNetworkStatus();
  return {
    online: s.online,
    lastError: s.lastError,
    circuitOpen: s.circuitOpenedAt !== null,
  };
}

// ---------------------------------------------------------------------------
// Конвертация TopicRagResult → WebRagResponse (совместимость интерфейса)
// ---------------------------------------------------------------------------

function topicResultToWebResponse(
  rag: TopicRagResult,
  sanitized: SanitizedQuery,
  maxResults: number,
): WebRagResponse {
  const results: WebRagResult[] = rag.matches.slice(0, maxResults).map((m) => {
    const snippetParts: string[] = [];
    if (m.mkbString) snippetParts.push(`МКБ-10: ${m.mkbString}`);
    snippetParts.push(`Возрастная категория: ${m.ageCategory}`);
    if (m.npcApproved) snippetParts.push("Одобрена НПС Минздрава России");
    if (m.developers.length > 0) {
      snippetParts.push(`Разработчики: ${m.developers.slice(0, 3).join("; ")}`);
    }
    if (m.publishDate) snippetParts.push(`Дата размещения: ${m.publishDate.slice(0, 10)}`);
    if (m.sectionsCount) snippetParts.push(`Разделов в КР: ${m.sectionsCount}`);

    // contentExcerpt — собранные ИИ по теме фрагменты полного текста КР
    const contentExcerpt = m.fragments
      .map((f) => `【${f.sectionTitle}】\n${f.text}`)
      .join("\n\n")
      .slice(0, 4000);

    return {
      title: m.name,
      url: m.url,
      source: "Минздрав РФ — Клинические рекомендации",
      snippet: snippetParts.join(" • "),
      publishedDate: m.publishDate ?? undefined,
      contentExcerpt: contentExcerpt || undefined,
      relevanceScore: m.relevanceScore,
      codeVersion: m.codeVersion,
      fragments: m.fragments,
    };
  });

  const parsedFragments = rag.matches.reduce((s, m) => s + m.fragments.length, 0);

  return {
    results,
    sanitizedQuery: sanitized,
    topic: rag.topic,
    parsedFragments,
    error: rag.error,
    fromCache: false,
    fetchedAt: rag.fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * ИИ НАПРЯМУЮ подключается к репозиторию КР Минздрава РФ и разбирает его по
 * теме: поиск КР → загрузка полных текстов → парсинг всех разделов →
 * отбор фрагментов, релевантных теме.
 *
 * @param params.diagnosisHint    предполагаемый диагноз кейса
 * @param params.dischargeSummary текст выписки (санитизируется)
 * @param params.mutations        генетические варианты
 * @param params.medications      препараты (МНН)
 * @param params.entities         NER-сущности
 * @param params.topic            явная тема запроса (напр., вопрос врача)
 * @param params.maxResults       максимум результатов
 * @param params.enableContentFetch разбирать полные тексты КР (по умолч. да)
 */
export async function runWebRag(params: {
  diagnosisHint?: string | null;
  dischargeSummary?: string;
  mutations?: Array<{ gene: string; variant: string }>;
  medications?: string[];
  entities?: Array<{ type: string; value: string }>;
  topic?: string;
  maxResults?: number;
  enableContentFetch?: boolean;
  icd10Codes?: string[];
}): Promise<WebRagResponse> {
  const {
    diagnosisHint,
    dischargeSummary,
    mutations,
    medications,
    entities,
    topic,
    maxResults = WEB_RAG_DEFAULT_MAX,
    enableContentFetch = true,
    icd10Codes,
  } = params;

  const emptyResponse = (error: string, warnings: string[] = []): WebRagResponse => ({
    results: [],
    sanitizedQuery: { query: "", terms: [], removedPHI: [], warnings },
    error,
    fetchedAt: new Date().toISOString(),
    networkStatus: getNetworkStatusSnapshot(),
  });

  // 0. Kill-switches
  if (!WEB_RAG_ENABLED) {
    return emptyResponse(
      "Веб-RAG отключён в конфигурации (WEB_RAG_ENABLED=false).",
      ["Web RAG disabled (WEB_RAG_ENABLED=false)"],
    );
  }
  if (!MINZDRAV_ENABLED) {
    return emptyResponse(
      "Поиск в репозитории Минздрава отключён (MINZDRAV_CR_ENABLED=false).",
      ["Минздрав CR disabled"],
    );
  }

  // 1. Санитизация запроса (PHI исключается ДО выхода в сеть)
  const sanitized = sanitizeCaseForQuery({
    diagnosisHint,
    dischargeSummary,
    mutations,
    medications,
    entities,
  });

  // Диагностические фразы для поиска КР Минздрава — ПЕРВИЧНЫЙ сигнал.
  // Репозиторий КР ищет по подстроке названия («Артериальная гипертензия…»),
  // поэтому полная фраза диагноза работает лучше отдельных слов.
  const diagnosisPhrases = extractDiagnosisPhrasesForCrSearch({
    diagnosisHint,
    entities,
    dischargeSummary,
  });

  // ICD-10 коды — клинические идентификаторы, PHI не являются
  const mkbFilter = (icd10Codes ?? [])
    .filter((c) => /^[A-TV-Z][0-9]{2}/i.test(c.trim()))
    .slice(0, 5);

  // 2. Тема для прямого разбора репозитория:
  //    a) явная тема (вопрос врача / фокус чата)
  //    b) диагностическая фраза (диагноз кейса)
  //    c) санитизированный запрос
  const topicSource =
    topic?.trim() ||
    diagnosisPhrases[0] ||
    sanitized.query;

  if (!topicSource && mkbFilter.length === 0) {
    return {
      ...emptyResponse(
        sanitized.warnings.join("; ") ||
          "Не извлечено клинических терминов для поиска КР Минздрава.",
      ),
      sanitizedQuery: sanitized,
    };
  }

  // 3. Краткосрочный кэш
  const cacheKey = `topic:${topicSource.toLowerCase()}::${mkbFilter.join(",")}::${maxResults}::${enableContentFetch}`;
  const cached = getCached(cacheKey);
  if (cached) {
    logger.info("web-rag", "Web RAG served from memory cache", {
      topic: topicSource.slice(0, 60),
      resultCount: cached.results.length,
    });
    return { ...cached, networkStatus: getNetworkStatusSnapshot() };
  }

  // 4. Проверка сети (apicr.minzdrav.gov.ru обходит circuit breaker,
  //    персистентный кэш Минздрава может отдать результат даже при офлайне)
  const isOnline = await checkNetwork();
  if (!isOnline) {
    logger.info("web-rag", "Network probe failed — trying Минздрав CR anyway (persistent cache may serve)", {
      topic: topicSource.slice(0, 60),
    });
  }

  logger.info("web-rag", "Прямой разбор репозитория КР Минздрава по теме", {
    topic: topicSource.slice(0, 80),
    diagnosisPhrases,
    terms: sanitized.terms,
    mkbFilter,
    maxResults,
    fetchContent: enableContentFetch,
    online: isOnline,
  });

  // 5. ПРЯМОЙ РАЗБОР РЕПОЗИТОРИЯ ПО ТЕМЕ (minzdrav-rag.ts):
  //    поиск КР → полные тексты → парсинг всех разделов → фрагменты по теме
  const rag = await parseClinrecsByTopic(topicSource, {
    icd10Codes: mkbFilter,
    maxClinrecs: Math.min(Math.max(maxResults, 3), 4),
    maxFragmentsPerClinrec: enableContentFetch ? 5 : 0,
    maxTotalChars: 12000,
  });

  let response = topicResultToWebResponse(rag, sanitized, maxResults);

  // 5a. v5.0: МЕЖДУНАРОДНЫЕ ИСТОЧНИКИ (PubMed, ВОЗ, NICE, Cochrane, CDC, ESC…)
  //     — best-effort, параллельно смыслу Минздрава; недоступность не валит
  //     основной разбор. Наружу уходят только англоязычные термины без PHI.
  let intlResults: IntlRagResult[] = [];
  let intlEnglishQuery = "";
  try {
    const intl = await runInternationalRag({
      sanitizedQuery: sanitized.query,
      englishQueryOverride: undefined,
      maxResults: maxResults,
    });
    intlResults = intl.results;
    intlEnglishQuery = intl.englishQuery;
    if (intlResults.length > 0) {
      logger.info("web-rag", "Международные источники добавлены к выдаче", {
        count: intlResults.length,
        query: intlEnglishQuery,
      });
    }
  } catch (e) {
    logger.warn("web-rag", "Международный поиск не удался (non-blocking)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 5b. Fallback: если по теме ничего не найдено — пробуем отдельные
  //     санитизированные термины (короткие запросы)
  if (response.results.length === 0 && sanitized.terms.length > 1) {
    for (const take of [2, 1]) {
      const shortTopic = sanitized.terms.slice(0, take).join(" ");
      if (shortTopic.length < 3) continue;
      try {
        const retry = await parseClinrecsByTopic(shortTopic, {
          icd10Codes: mkbFilter,
          maxClinrecs: 3,
          maxFragmentsPerClinrec: enableContentFetch ? 4 : 0,
        });
        if (retry.matches.length > 0) {
          response = topicResultToWebResponse(retry, sanitized, maxResults);
          logger.info("web-rag", "Разбор репозитория по короткой теме удался", {
            shortTopic,
            found: retry.matches.length,
          });
          break;
        }
      } catch (e) {
        logger.warn("web-rag", "Минздрав CR retry failed", {
          shortTopic,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // 5c. v5.0: сливаем международные результаты в выдачу (Минздрав первым)
  if (intlResults.length > 0) {
    const seenUrls = new Set(response.results.map((r) => r.url));
    for (const r of intlResults) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      response.results.push({
        title: r.title,
        url: r.url,
        source: r.source,
        snippet: r.snippet,
        publishedDate: r.publishedDate,
        contentExcerpt: r.contentExcerpt,
        relevanceScore: r.relevanceScore,
      });
    }
  }

  // 6. Уточнённая диагностика ошибки: «сеть недоступна» vs «не найдено»
  if (response.results.length === 0 && !response.error) {
    const reachable = await checkNetwork();
    response.error = reachable
      ? "В официальном репозитории Минздрава РФ (cr.minzdrav.gov.ru) не найдено клинических рекомендаций по данной теме."
      : "Репозиторий Минздрава РФ (apicr.minzdrav.gov.ru) недоступен — проверьте интернет-соединение. При восстановлении связи разбор будет повторен автоматически.";
  }

  if (response.results.length > 0) setCached(cacheKey, response);

  logger.info("web-rag", "Разбор источников по теме завершён", {
    topic: response.topic ?? topicSource.slice(0, 60),
    resultCount: response.results.length,
    parsedFragments: response.parsedFragments ?? 0,
    intlCount: intlResults.length,
    removedPHI: sanitized.removedPHI.length,
  });

  return {
    ...response,
    intlEnglishQuery: intlEnglishQuery || undefined,
    networkStatus: getNetworkStatusSnapshot(),
  };
}

// ---------------------------------------------------------------------------
// Context builder (для LLM)
// ---------------------------------------------------------------------------

/**
 * Строит текстовый контекст из найденных источников для включения в промпт
 * LLM: официальные КР Минздрава РФ (приоритет) + международные источники
 * (PubMed/ВОЗ/NICE/Cochrane/CDC/ESC/EMA/NCCN) для сопоставления.
 */
export function buildWebRagContext(
  results: WebRagResult[],
  sanitizedQuery?: SanitizedQuery,
): string {
  if (results.length === 0) return "";

  const parts: string[] = [];
  if (sanitizedQuery?.query) {
    parts.push(`(Разбор репозитория выполнен по теме: "${sanitizedQuery.query}". PHI исключена.)`);
  }
  const minzdravResults = results.filter(
    (r) => r.source === "Минздрав РФ — Клинические рекомендации",
  );
  const intlResults = results.filter(
    (r) => r.source !== "Минздрав РФ — Клинические рекомендации",
  );

  parts.push("=== ЧАСТЬ 1. ОФИЦИАЛЬНЫЕ КЛИНИЧЕСКИЕ РЕКОМЕНДАЦИИ МИНЗДРАВА РФ (ПРИОРИТЕТ №1) ===");
  parts.push("Источник: репозиторий клинических рекомендаций Минздрава России (cr.minzdrav.gov.ru).");
  parts.push("Это УТВЕРЖДЁННЫЕ клинические рекомендации Минздрава РФ, разобранные ИИ напрямую");
  parts.push("из официального репозитория по теме запроса. Формулируя диагностику и лечение,");
  parts.push("ПРИОРИТЕТ — у этих официальных КР. Все назначения и диагностические шаги");
  parts.push("согласовывай с приведёнными фрагментами КР; указывай код КР (например, 62_3).");
  parts.push("");

  for (let i = 0; i < minzdravResults.length; i++) {
    const r = minzdravResults[i];
    parts.push(`[КР Минздрава РФ #${i + 1}] ${r.title}`);
    if (r.codeVersion) parts.push(`Код/версия КР: ${r.codeVersion}`);
    parts.push(`Официальный источник: ${r.url}`);
    if (r.publishedDate) {
      parts.push(`Дата размещения: ${r.publishedDate.slice(0, 10)}`);
    }
    if (r.snippet) {
      parts.push(r.snippet);
    }
    if (r.fragments && r.fragments.length > 0) {
      parts.push("Фрагменты КР, отобранные по теме запроса:");
      for (const f of r.fragments) {
        parts.push(`— «${f.sectionTitle}»:\n${f.text}`);
      }
    } else if (r.contentExcerpt) {
      parts.push(`Фрагменты КР:\n${r.contentExcerpt}`);
    }
    parts.push("");
  }

  parts.push("=== КОНЕЦ ОФИЦИАЛЬНЫХ КР МИНЗДРАВА РФ ===");

  // v5.0: международные источники — для сопоставления и доп. доказательств
  if (intlResults.length > 0) {
    parts.push("");
    parts.push("=== ЧАСТЬ 2. МЕЖДУНАРОДНЫЕ АВТОРИТЕТНЫЕ ИСТОЧНИКИ (ДОПОЛНЕНИЕ) ===");
    parts.push("PubMed (рецензируемые публикации), ВОЗ, NICE, Cochrane, CDC, ESC, EMA, NCCN.");
    parts.push("Используй их для: сопоставления с КР РФ, дополнительных доказательств,");
    parts.push("современных подходов, которых ещё нет в КР РФ. ВСЕГДА указывай источник и");
    parts.push("ссылку. При расхождении с КР Минздрава РФ — упомяни оба подхода и приоритет");
    parts.push("КР РФ для практики в РФ.");
    parts.push("");
    for (let i = 0; i < intlResults.length; i++) {
      const r = intlResults[i];
      parts.push(`[Междунар. источник #${i + 1}] ${r.title}`);
      parts.push(`Источник: ${r.source} — ${r.url}`);
      if (r.publishedDate) parts.push(`Дата: ${r.publishedDate.slice(0, 10)}`);
      if (r.snippet) parts.push(r.snippet);
      if (r.contentExcerpt) parts.push(`Содержание:\n${r.contentExcerpt.slice(0, 1500)}`);
      parts.push("");
    }
    parts.push("=== КОНЕЦ МЕЖДУНАРОДНЫХ ИСТОЧНИКОВ ===");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Реэкспорты для маршрутов (диф. диагностика, анализ)
// ---------------------------------------------------------------------------

export { buildClinrecContext } from "./minzdrav-cr";
export { ragMatchesToSummary, type RagFragment, type ClinrecRagMatch } from "./minzdrav-rag";
export { runInternationalRag, buildEnglishQuery } from "./international-rag";
