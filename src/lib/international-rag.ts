// СППВР v5.0 — International RAG: авторитетные международные источники
// ============================================================================
// PURPOSE: по запросу пользователя система ищет доказательную информацию не
// только в КР Минздрава РФ (см. minzdrav-rag.ts), но и в АВТОРИТЕТНЫХ
// МЕЖДУНАРОДНЫХ источниках:
//
//   1. PubMed / NCBI E-utilities (esearch + esummary + efetch abstracts)
//      — рецензируемые публикации, Systematic Reviews/Meta-Analysis;
//   2. DuckDuckGo HTML-поиск, ограниченный доверенными доменами:
//      who.int, nice.org.uk, cochrane.org, cdc.gov, escardio.org,
//      ema.europa.eu, ncbi.nlm.nih.gov/books (StatPearls/Bookshelf),
//      nccn.org.
//
// PRIVACY (ФЗ-152, ФЗ-323 ст. 13): наружу уходят ТОЛЬКО санитизированные
// клинические термины (тот же SanitizedQuery, что и для Минздрава) — без ФИО,
// дат и нарратива. Запрос переводится на английский терминологический ядра
// (МКБ/МНН/патофизиологические термины) перед отправкой.
//
// НАДЁЖНОСТЬ: per-host circuit breaker (network-health.ts) — недоступность
// PubMed не блокирует Минздрав и наоборот. Тайм-ауты INTL_RAG_TIMEOUT_MS.
// Результаты кешируются в памяти на 6 ч (IntlRagCache).
// ============================================================================

import { logger } from "./logger";
import { safeFetch } from "./network-health";
import { htmlToText } from "./minzdrav-cr";

const INTL_ENABLED = process.env.INTL_RAG_ENABLED !== "false";
const INTL_MAX_RESULTS = Math.max(
  1,
  parseInt(process.env.INTL_RAG_MAX_RESULTS ?? "6", 10),
);
const PAGE_TIMEOUT_MS = Math.max(
  3_000,
  parseInt(process.env.INTL_RAG_TIMEOUT_MS ?? "12000", 10),
);

// ---------------------------------------------------------------------------
// Типы (совместимы с WebRagResult из web-rag.ts)
// ---------------------------------------------------------------------------

export interface IntlRagResult {
  title: string;
  url: string;
  /** Человекочитаемое имя источника: "PubMed — NLM", "ВОЗ (WHO)", "NICE", … */
  source: string;
  snippet: string;
  publishedDate?: string;
  contentExcerpt?: string;
  relevanceScore: number;
  /** Идентификатор провайдера: pubmed | duckduckgo-guideline */
  provider: "pubmed" | "duckduckgo-guideline";
}

export interface IntlRagResponse {
  results: IntlRagResult[];
  /** Английский терминологический запрос, ушедший наружу (для аудита). */
  englishQuery: string;
  error?: string;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Словарь RU → EN для перевода клинического ядра запроса
// ---------------------------------------------------------------------------

const RU_EN_TERMINOLOGY: Array<[RegExp, string]> = [
  [/артериальн[а-яё]+ гипертензи[а-яё]+/gi, "arterial hypertension"],
  [/гипертоническ[а-яё]+ болезн[а-яё]+/gi, "hypertension"],
  [/сахарный диабет/gi, "diabetes mellitus"],
  [/ишемическ[а-яё]+ болезнь сердца/gi, "ischemic heart disease"],
  [/инфаркт миокарда/gi, "myocardial infarction"],
  [/хроническ[а-яё]+ сердечн[а-яё]+ недостаточност[а-яё]+/gi, "chronic heart failure"],
  [/фибрилляци[а-яё]+ предсердий/gi, "atrial fibrillation"],
  [/инсульт/gi, "stroke"],
  [/пневмони[а-яё]+/gi, "pneumonia"],
  [/хроническ[а-яё]+ обструктивн[а-яё]+ заболевани[а-яё]+ лёгких|хроническ[а-яё]+ обструктивн[а-яё]+ болезн[а-яё]+ лёгких/gi, "COPD"],
  [/бронхиальн[а-яё]+ астм[а-яё]+/gi, "bronchial asthma"],
  [/туберкулёз|туберкулез/gi, "tuberculosis"],
  [/онкологическ[а-яё]+|злокачественн[а-яё]+ новообразован[а-яё]+/gi, "malignant neoplasm"],
  [/рак молочной железы/gi, "breast cancer"],
  [/рак лёгкого|рак легкого/gi, "lung cancer"],
  [/рак предстательной железы/gi, "prostate cancer"],
  [/колоректальн[а-яё]+ рак/gi, "colorectal cancer"],
  [/железодефицитн[а-яё]+ анеми[а-яё]+/gi, "iron deficiency anemia"],
  [/анеми[а-яё]+/gi, "anemia"],
  [/гипотиреоз/gi, "hypothyroidism"],
  [/тиреотоксикоз/gi, "hyperthyroidism"],
  [/остеоартроз|остеоартрит/gi, "osteoarthritis"],
  [/ревматоидн[а-яё]+ артрит/gi, "rheumatoid arthritis"],
  [/подагр[а-яё]+/gi, "gout"],
  [/панкреатит/gi, "pancreatitis"],
  [/холецистит/gi, "cholecystitis"],
  [/гастрит/gi, "gastritis"],
  [/язвенная болезнь/gi, "peptic ulcer disease"],
  [/гэрд|рефлюкс[а-яё]+ болезн[а-яё]+/gi, "gastroesophageal reflux disease"],
  [/цирроз печени/gi, "liver cirrhosis"],
  [/хроническ[а-яё]+ болезн[а-яё]+ почек/gi, "chronic kidney disease"],
  [/мочекаменн[а-яё]+ болезн[а-яё]+/gi, "urolithiasis"],
  [/мигрень/gi, "migraine"],
  [/эпилепси[а-яё]+/gi, "epilepsy"],
  [/депресси[а-яё]+/gi, "depression"],
  [/тревожн[а-яё]+ расстройств[а-яё]+/gi, "anxiety disorder"],
  [/шизофрени[а-яё]+/gi, "schizophrenia"],
  [/депрессивн[а-яё]+ эпизод/gi, "depressive episode"],
  [/никотинов[а-яё]+ зависимост[а-яё]+/gi, "tobacco use disorder"],
  [/алкогольн[а-яё]+ зависимост[а-яё]+/gi, "alcohol use disorder"],
  [/ковид|covid/gi, "COVID-19"],
  [/новой коронавирусн[а-яё]+ инфекци[а-яё]+/gi, "COVID-19"],
  [/беременност[а-яё]+/gi, "pregnancy"],
  [/кашель/gi, "cough"],
  [/лихорадк[а-яё]+/gi, "fever"],
  [/головн[а-яё]+ боль/gi, "headache"],
  [/боль в груди/gi, "chest pain"],
  [/одышк[а-яё]+/gi, "dyspnea"],
  [/головокружени[а-яё]+/gi, "dizziness"],
  [/рефлекторн[а-яё]+ кашель/gi, "reflex cough"],
];

// Клинические рекомендательные организации для DDG site-фильтра
const GUIDELINE_DOMAINS = [
  "who.int",
  "nice.org.uk",
  "cochrane.org",
  "cdc.gov",
  "escardio.org",
  "ema.europa.eu",
  "ncbi.nlm.nih.gov/books",
  "nccn.org",
];

const DOMAIN_SOURCE_NAMES: Array<[string, string]> = [
  ["who.int", "ВОЗ (WHO)"],
  ["nice.org.uk", "NICE (Великобритания)"],
  ["cochrane.org", "Cochrane Library"],
  ["cdc.gov", "CDC (США)"],
  ["escardio.org", "ESC (Европейское кардиологическое общество)"],
  ["ema.europa.eu", "EMA (Европейское агентство лекарств)"],
  ["ncbi.nlm.nih.gov/books", "NCBI Bookshelf"],
  ["nccn.org", "NCCN (США, онкология)"],
];

function sourceNameForUrl(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  for (const [domain, name] of DOMAIN_SOURCE_NAMES) {
    if (host === domain || host.endsWith("." + domain) || (domain.includes("/") && url.includes(domain))) {
      return name;
    }
  }
  return "Международный источник";
}

// ---------------------------------------------------------------------------
// RU → EN перевод ядра запроса (детерминированный, словарный)
// ---------------------------------------------------------------------------

export function buildEnglishQuery(sanitizedQuery: string): string {
  let q = " " + sanitizedQuery.toLowerCase().slice(0, 400) + " ";
  // Применяем словарь: заменяем русские клинические фразы английскими
  for (const [re, en] of RU_EN_TERMINOLOGY) {
    q = q.replace(re, ` ${en} `);
  }
  // Оставшиеся кириллические слова выбрасываем (наружу уйдёт только EN-ядро),
  // т.к. международные поисковые системы по-русски ищут плохо.
  const words = q
    .replace(/[^a-z0-9\s-]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  const unique = Array.from(new Set(words)).slice(0, 8);
  return unique.join(" ");
}

const STOPWORDS = new Set([
  "синдром", "болезнь", "заболевание", "пациент", "пациента", "лечение",
  "терапия", "диагноз", "клинический", "recommendation", "guideline",
  "treatment", "therapy", "disease", "syndrome", "patient", "diagnosis",
  "clinical", "the", "and", "for", "with", "without", "from", "данных",
  "симптомы", "жалобы", "анализ", "анализы", "мкб",
]);

// ---------------------------------------------------------------------------
// Кеш (память, 6 ч)
// ---------------------------------------------------------------------------

interface CacheEntry {
  response: IntlRagResponse;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function getCached(key: string): IntlRagResponse | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    cache.delete(key);
    return null;
  }
  return e.response;
}

function setCached(key: string, response: IntlRagResponse): void {
  cache.set(key, { response, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 80) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expiresAt) cache.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Главный вход
// ---------------------------------------------------------------------------

/**
 * Поиск в международных авторитетных источниках по теме.
 * @param sanitizedQuery — санитизированная строка (термины без PHI)
 * @param englishQueryOverride — готовый EN-запрос (если уже построен)
 */
export async function runInternationalRag(params: {
  sanitizedQuery: string;
  englishQueryOverride?: string;
  maxResults?: number;
}): Promise<IntlRagResponse> {
  const fetchedAt = new Date().toISOString();
  const maxResults = Math.min(params.maxResults ?? INTL_MAX_RESULTS, 10);

  const empty = (error?: string): IntlRagResponse => ({
    results: [],
    englishQuery: params.englishQueryOverride ?? "",
    error,
    fetchedAt,
  });

  if (!INTL_ENABLED) {
    return empty("Поиск международных источников отключён (INTL_RAG_ENABLED=false).");
  }

  const enQuery =
    params.englishQueryOverride?.trim() || buildEnglishQuery(params.sanitizedQuery || "");
  if (enQuery.length < 3) {
    return empty("Не удалось построить англоязычный терминологический запрос.");
  }

  const cacheKey = `intl:${enQuery.toLowerCase()}::${maxResults}`;
  const cached = getCached(cacheKey);
  if (cached) {
    logger.info("intl-rag", "International RAG served from memory cache", {
      query: enQuery,
      count: cached.results.length,
    });
    return cached;
  }

  logger.info("intl-rag", "Поиск в международных источниках", { query: enQuery });

  // Параллельно: PubMed + guideline-поиск (DDG по доверенным доменам)
  const [pubmed, guidelines] = await Promise.allSettled([
    searchPubMed(enQuery, Math.min(4, maxResults)),
    searchGuidelinesViaDDG(enQuery, Math.min(4, maxResults)),
  ]);

  const results: IntlRagResult[] = [];
  if (pubmed.status === "fulfilled") results.push(...pubmed.value);
  if (guidelines.status === "fulfilled") results.push(...guidelines.value);

  // Дедуп по URL + ранжирование: guideline-источники и PubMed чередуем
  const seen = new Set<string>();
  const deduped: IntlRagResult[] = [];
  const interleave: IntlRagResult[] = [];
  const maxLen = Math.max(
    pubmed.status === "fulfilled" ? pubmed.value.length : 0,
    guidelines.status === "fulfilled" ? guidelines.value.length : 0,
  );
  for (let i = 0; i < maxLen; i++) {
    if (guidelines.status === "fulfilled" && guidelines.value[i]) interleave.push(guidelines.value[i]);
    if (pubmed.status === "fulfilled" && pubmed.value[i]) interleave.push(pubmed.value[i]);
  }
  for (const r of interleave) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    deduped.push(r);
    if (deduped.length >= maxResults) break;
  }

  const response: IntlRagResponse = {
    results: deduped,
    englishQuery: enQuery,
    error:
      deduped.length === 0
        ? "Международные источники недоступны или по запросу ничего не найдено."
        : undefined,
    fetchedAt,
  };
  if (deduped.length > 0) setCached(cacheKey, response);

  logger.info("intl-rag", "Международный поиск завершён", {
    query: enQuery,
    found: deduped.length,
  });

  return response;
}

// ---------------------------------------------------------------------------
// Провайдер 1: PubMed (NCBI E-utilities)
// ---------------------------------------------------------------------------

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

interface PubMedArticle {
  pmid: string;
  title: string;
  journal: string;
  pubDate: string;
  pubType?: string;
}

/** Поиск статей в PubMed (приоритет обзорам/метаанализам и гайдлайнам). */
async function searchPubMed(query: string, max: number): Promise<IntlRagResult[]> {
  // Склоняем запрос к доказательным публикациям
  const term = `${query} AND (guideline[pt] OR systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt] OR review[pt])`;
  const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${max}&sort=relevance&retmode=json`;

  const searchRes = await safeFetch(searchUrl, { timeoutMs: PAGE_TIMEOUT_MS });
  if (!searchRes.ok || !searchRes.response) return [];
  if (!searchRes.response.ok) return [];

  const searchData = (await searchRes.response.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  const ids = (searchData.esearchresult?.idlist ?? []).filter(Boolean);
  if (ids.length === 0) return [];

  // Резюме статей
  const summaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
  const sumRes = await safeFetch(summaryUrl, { timeoutMs: PAGE_TIMEOUT_MS });
  if (!sumRes.ok || !sumRes.response || !sumRes.response.ok) return [];
  const sumData = (await sumRes.response.json()) as {
    result?: Record<
      string,
      { title?: string; fulljournalname?: string; pubdate?: string; pubtype?: string[] }
    >;
  };

  const articles: PubMedArticle[] = [];
  for (const id of ids) {
    const r = sumData.result?.[id];
    if (!r?.title) continue;
    articles.push({
      pmid: id,
      title: r.title.replace(/\s*\.$/, ""),
      journal: r.fulljournalname ?? "",
      pubDate: r.pubdate ?? "",
      pubType: (r.pubtype ?? []).join(", "),
    });
  }
  if (articles.length === 0) return [];

  // Абстракты — только для топ-2 статей (экономия времени)
  const topIds = articles.slice(0, 2).map((a) => a.pmid);
  const abstracts = await fetchPubMedAbstracts(topIds);

  return articles.map((a, i) => {
    const abstract = abstracts.get(a.pmid);
    const url = `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`;
    return {
      title: a.title,
      url,
      source: "PubMed — NLM",
      snippet: [a.journal, a.pubDate, a.pubType].filter(Boolean).join(" • "),
      publishedDate: a.pubDate || undefined,
      contentExcerpt: abstract?.slice(0, 1500),
      relevanceScore: Math.max(0.55 - i * 0.05, 0.35),
      provider: "pubmed" as const,
    };
  });
}

/** Загрузка абстрактов (efetch, текст). Возвращает Map pmid → abstract. */
async function fetchPubMedAbstracts(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const url = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`;
  const res = await safeFetch(url, { timeoutMs: PAGE_TIMEOUT_MS });
  if (!res.ok || !res.response || !res.response.ok) return out;
  const text = await res.response.text();
  // efetch текстовый формат: блоки разделены пустой строкой с PMID
  // Формат: "1. <title>\n<journal>...\nPMID: 12345\n..."
  const blocks = text.split(/\n\n(?=\d+\.\s)/);
  for (const block of blocks) {
    const pmidMatch = block.match(/PMID:\s*(\d+)/);
    if (!pmidMatch) continue;
    // Абстракт между "Abstract" и "PMID:"
    const absMatch = block.match(/Abstract\s*([\s\S]*?)\s*PMID:/);
    const body = (absMatch ? absMatch[1] : block).replace(/\s{2,}/g, " ").trim();
    if (body.length > 100) out.set(pmidMatch[1], body);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Провайдер 2: клинические гайдлайны через DuckDuckGo (site: доверенные)
// ---------------------------------------------------------------------------

/** Поиск гайдлайнов ВОЗ/NICE/Cochrane/CDC/ESC/EMA/NCCN через DDG. */
async function searchGuidelinesViaDDG(query: string, max: number): Promise<IntlRagResult[]> {
  // v5.0: DDG HTML-эндпоинт плохо обрабатывает сложные "(site:a OR site:b)"
  // запросы и временами блокирует автоматические обращения (rate-limit).
  // Поэтому: простой запрос + КЛИЕНТСКАЯ фильтрация по доверенным доменам,
  // с FALLBACK на lite.duckduckgo.com при пустой выдаче.
  const q = `${query} clinical guideline recommendations`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "text/html",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const fetchHtml = async (url: string): Promise<string | null> => {
    const res = await safeFetch(url, { timeoutMs: PAGE_TIMEOUT_MS, headers });
    if (!res.ok || !res.response || !res.response.ok) return null;
    try {
      return await res.response.text();
    } catch {
      return null;
    }
  };

  // Попытка 1: html.duckduckgo.com (полная выдача со сниппетами)
  let html: string =
    (await fetchHtml(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    )) ?? "";
  let results = parseDdgHtmlResults(html, max * 3);

  // Попытка 2 (fallback): lite.duckduckgo.com — проще и реже блокируется
  if (results.length === 0) {
    html =
      (await fetchHtml(
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
      )) ?? "";
    results = parseDdgHtmlResults(html, max * 3);
  }
  if (results.length === 0) return [];

  // Сниппеты из полной выдачи DDG (result__snippet) — только если они есть
  {
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let sIdx = 0;
    let m2: RegExpExecArray | null;
    while ((m2 = snippetRe.exec(html)) !== null && sIdx < results.length) {
      results[sIdx].snippet = stripTags(m2[1] ?? "").trim().slice(0, 400);
      sIdx++;
    }
  }

  const top = results.slice(0, max);

  // Контент топ-2 страниц (лучший усилиями; недоступность страницы не валит всё)
  await Promise.allSettled(
    top.slice(0, 2).map(async (r) => {
      const content = await fetchPageText(r.url);
      if (content) r.snippet = (r.snippet || content.slice(0, 200)).slice(0, 400);
    }),
  );

  return top.map((r, i) => ({
    title: r.title,
    url: r.url,
    source: sourceNameForUrl(r.url),
    snippet: r.snippet,
    contentExcerpt: undefined,
    relevanceScore: Math.max(0.6 - i * 0.06, 0.3),
    provider: "duckduckgo-guideline" as const,
  }));
}

/**
 * Разбирает выдачу DDG (html- или lite-версию) и возвращает результаты,
 * отфильтрованные по доверенным доменам (GUIDELINE_DOMAINS).
 */
function parseDdgHtmlResults(
  html: string,
  limit: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  if (!html) return results;

  const pushResult = (href: string, title: string): void => {
    if (!href || !title) return;
    const url = decodeDdgHref(href);
    if (!url || !/^https?:\/\//.test(url)) return;
    // Фильтр: только доверенные домены (клиентская фильтрация)
    const host = (() => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const trusted = GUIDELINE_DOMAINS.some((d) => {
      const bare = d.replace(/^www\./, "");
      return host === bare || host.endsWith("." + bare) || url.includes(bare);
    });
    if (!trusted) return;
    if (results.some((r) => r.url === url)) return;
    results.push({ title, url, snippet: "" });
  };

  // Формат 1: полная выдача <a class="result__a" href="...">Title</a>
  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]+href="([^"]+)"[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && results.length < limit) {
    pushResult((m[1] ?? m[3] ?? "").trim(), stripTags(m[2] ?? m[4] ?? "").trim());
  }
  if (results.length > 0) return results;

  // Формат 2: lite-версия — все ссылки на //duckduckgo.com/l/?uddg=...
  // (сами результаты идут парами: ссылка-заголовок + ссылка-источник)
  const liteRe = /href="(\/\/duckduckgo\.com\/l\/\?uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = liteRe.exec(html)) !== null && results.length < limit) {
    const title = stripTags(m[2] ?? "").trim();
    // Пропускаем иконки/служебные ссылки без текста
    if (!title || title.length < 8) continue;
    pushResult(m[1].trim(), title);
  }
  return results;
}

/** Загружает страницу и извлекает читаемый текст (для contentExcerpt). */
async function fetchPageText(url: string): Promise<string | null> {
  const res = await safeFetch(url, {
    timeoutMs: PAGE_TIMEOUT_MS,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok || !res.response || !res.response.ok) return null;
  try {
    const html = await res.response.text();
    const text = htmlToText(html);
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

function decodeDdgHref(href: string): string | null {
  try {
    if (href.startsWith("//")) href = "https:" + href;
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (/^https?:/.test(u.href)) return u.href;
    return null;
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
