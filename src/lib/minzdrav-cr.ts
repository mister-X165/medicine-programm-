// СППВР v4.1 — Официальный клиент репозитория клинических рекомендаций
// Минздрава РФ (https://cr.minzdrav.gov.ru/clin-rec)
// ============================================================================
// НАЗНАЧЕНИЕ: ЕДИНСТВЕННЫЙ источник внешних клинических рекомендаций в
// системе. Все клинические рекомендации берутся ИСКЛЮЧИТЕЛЬНО из
// официального архива Минздрава РФ — репозитория cr.minzdrav.gov.ru
// (утверждённые КР, приказы Минздрава России).
//
// ИСПОЛЬЗУЕМЫЕ ЭНДПОИНТЫ (backend репозитория — apicr.minzdrav.gov.ru):
//   POST /api.ashx?op=GetJsonClinrecsFilterV2  — поиск КР по названию/МКБ/
//        возрастной категории/дате/статусу с пагинацией.
//   GET  /api.ashx?op=GetClinrec2&id={code}_{version} — ПОЛНЫЙ структурированный
//        текст КР (разделы: краткая информация, диагностика, лечение,
//        реабилитация, профилактика, приложения со шкалами и алгоритмами).
//   GET  /api.ashx?op=GetClinrecPdf&id={code}_{version} — официальный PDF КР.
//   GET  /api.ashx?op=GetMkbRefList — справочник МКБ-10 (с Id для фильтров).
//   GET  /api.ashx?op=GetNkoList — справочник НКО (разработчиков КР).
//
// ПУБЛИЧНЫЕ ССЫЛКИ:
//   Просмотр КР:      https://cr.minzdrav.gov.ru/view-cr/{code}_{version}
//   Список КР:        https://cr.minzdrav.gov.ru/clin-rec
//   Архив КР:         https://cr.minzdrav.gov.ru/archive
//
// ПРИВАТНОСТЬ (ФЗ-152, ФЗ-323 ст. 13):
//   Наружу отправляются ТОЛЬКО санитизированные клинические термины
//   (названия заболеваний, коды МКБ-10) — без ФИО, дат и нарратива.
//   См. query-sanitizer.ts, который вызывается ДО этого модуля.
//
// НАДЁЖНОСТЬ / ОФЛАЙН:
//   - Все ответы кэшируются в таблицу MinzdravCache (SQLite) с TTL:
//     список КР — 24 ч, полный текст КР — 7 дней, справочник МКБ — 30 дней.
//     Это позволяет работать на локальном ПК врача даже без интернета
//     (кэш переживает перезапуск приложения).
//   - Функции НИКОГДА не бросают исключений: при недоступности сети
//     возвращается кэш (даже просроченный) или пустой результат с ошибкой.
//   - apicr.minzdrav.gov.ru добавлен в BYPASS_CIRCUIT_HOSTS — сбои поиска
//     не размыкают общий circuit breaker сети.
// ============================================================================

import { db } from "./db";
import { logger } from "./logger";
import { safeFetch } from "./network-health";

// ---------------------------------------------------------------------------
// Конфигурация
// ---------------------------------------------------------------------------

/** Базовый URL backend--API официального репозитория КР Минздрава РФ. */
const MINZDRAV_API_BASE = "https://apicr.minzdrav.gov.ru/api.ashx";

/** Публичный URL репозитория КР (для ссылок в UI и заключениях). */
export const MINZDRAV_CR_SITE = "https://cr.minzdrav.gov.ru";

/** User-Agent, под которым обращаемся к API Минздрава. */
const MINZDRAV_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Таймаут одного запроса к API Минздрава (мс). */
const REQUEST_TIMEOUT_MS = 20000;

/** TTL кэша по типам (мс). */
const TTL = {
  search: 24 * 60 * 60 * 1000, // 24 часа — список КР
  full: 7 * 24 * 60 * 60 * 1000, // 7 дней — полный текст КР
  mkbref: 30 * 24 * 60 * 60 * 1000, // 30 дней — справочник МКБ
  nko: 30 * 24 * 60 * 60 * 1000, // 30 дней — справочник НКО
};

/**
 * Лимит хранимых полных текстов КР (оптимизация размера приложения):
 * один slim-текст ~100-500 КБ, 40 штук ≈ 4-15 МБ — с запасом в бюджете
 * ≤38 МБ на всё приложение. Более старые вытесняются.
 */
const MAX_FULL_CACHE_ENTRIES = 40;

/**
 * Периодическая чистка кэша (каждый 8-й вызов cacheSet):
 *   • удаляет просроченные записи любого типа;
 *   • ограничивает число полных текстов КР MAX_FULL_CACHE_ENTRIES
 *     (вытесняются самые старые по fetchedAt).
 */
async function pruneCacheIfNeeded(): Promise<void> {
  try {
    await db.minzdravCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const fullCount = await db.minzdravCache.count({ where: { kind: "full" } });
    if (fullCount > MAX_FULL_CACHE_ENTRIES) {
      const excess = fullCount - MAX_FULL_CACHE_ENTRIES;
      const oldest = await db.minzdravCache.findMany({
        where: { kind: "full" },
        orderBy: { fetchedAt: "asc" },
        take: excess,
        select: { id: true },
      });
      if (oldest.length > 0) {
        await db.minzdravCache.deleteMany({
          where: { id: { in: oldest.map((o) => o.id) } },
        });
        logger.info("minzdrav", "Кэш полных текстов КР вытеснен (лимит размера)", {
          evicted: oldest.length,
          limit: MAX_FULL_CACHE_ENTRIES,
        });
      }
    }
  } catch {
    // чистка — best-effort, ошибка не влияет на работу
  }
}

let cacheWriteCounter = 0;

/** Включён ли поиск в Минздраве (выключается через .env, по умолчанию ВКЛ). */
export const MINZDRAV_ENABLED = process.env.MINZDRAV_CR_ENABLED !== "false";

// ---------------------------------------------------------------------------
// Типы (соответствуют ответам apicr.minzdrav.gov.ru)
// ---------------------------------------------------------------------------

/** Элемент справочника МКБ-10 из GetMkbRefList. */
export interface MkbRefItem {
  Id: number;
  ParentId: number | null;
  Name: string;
  Code: string;
  IsGroup: boolean;
  treeLevel: number;
}

/** Код МКБ внутри карточки КР. */
export interface ClinrecMkb {
  ClinRecId: number;
  MkbId: number;
  MkbName: string;
  MkbCode: string;
}

/** Разработчик КР (профессиональная ассоциация). */
export interface ClinrecDeveloper {
  ClinRecId: number;
  NkoId: number;
  NkoName: string;
  NkoShortName: string | null;
}

/** Карточка КР из списка (GetJsonClinrecsFilterV2). */
export interface ClinrecListItem {
  Id: number;
  Name: string;
  NPC_approved: boolean | null;
  PublishDateStr: string | null;
  Code: number;
  Version: number;
  CodeVersion: string; // напр. "286_3"
  Status: number;
  ApplyStatus: number | null;
  ApplyStatusCalculated: number | null;
  AgeCategory: number;
  AgeCategoryStr: string; // "Взрослые" | "Дети" | "Взрослые, дети"
  CreatedStr: string | null;
  PrevCrId: number | null;
  Developers: ClinrecDeveloper[] | null;
  Mkbs: ClinrecMkb[] | null;
  Specialities: unknown;
}

/** Ответ поиска КР. */
export interface ClinrecSearchResponse {
  Data: ClinrecListItem[];
  CurrentPage: number;
  PageSize: number;
  TotalRecords: number;
  Erorrs: unknown;
}

/** Раздел полного текста КР (GetClinrec2). */
export interface ClinrecSection {
  id: string; // напр. "doc_diag_2_3"
  title: string; // напр. "2.3 Лабораторные исследования"
  content: string; // HTML-содержимое
  content_index: number;
}

/** Полный текст КР (GetClinrec2). */
export interface ClinrecFull {
  db_id: number;
  version: number;
  id: string; // "286_3"
  name: string;
  mkb: string; // "E10.2/E10.3/..."
  created: string | null;
  status: number;
  code: number;
  obj: { sections: ClinrecSection[] } | null;
  adult: boolean;
  child: boolean;
  NPC_approved: boolean | null;
  proff_associations: unknown;
  approved: string | null;
  publish_date: string | null;
  mkbs: ClinrecMkb[] | null;
  specialities: unknown;
  apply_status: number | null;
  apply_status_calculated: number | null;
  prev_cr_id: string | null;
}

/** Нормализованный результат поиска КР для UI/RAG. */
export interface ClinrecMatch {
  codeVersion: string; // "286_3"
  name: string;
  mkbCodes: string[]; // ["E10.2", ...]
  mkbString: string; // "E10.2/E10.3"
  developers: string[]; // названия НКО
  ageCategory: string; // "Взрослые, дети"
  publishDate: string | null;
  npcApproved: boolean; // одобрена НПС (Научно-практическим советом)
  applyStatusCalculated: number | null;
  url: string; // https://cr.minzdrav.gov.ru/view-cr/286_3
  pdfUrl: string; // https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=286_3
  relevanceScore: number; // 0..1
  contentExcerpt?: string; // выдержка из полного текста (если fetched)
  diagnosticsExcerpt?: string; // выдержка раздела «Диагностика»
  therapyExcerpt?: string; // выдержка раздела «Лечение»
  sectionsCount?: number;
}

/** Параметры поиска КР. */
export interface ClinrecSearchParams {
  query?: string; // текстовый поиск по названию
  mkbCodes?: string[]; // фильтр по кодам МКБ-10 (напр. ["E11"])
  ageCategory?: number | null; // 1 дети | 2 взрослые | 3 все; null — не фильтровать
  page?: number;
  pageSize?: number;
  includeContent?: boolean; // загрузить полные тексты топ-результатов
  maxContentFetch?: number; // сколько полных текстов грузить (по умолч. 3)
}

// ---------------------------------------------------------------------------
// Кэш: память (горячий) + SQLite MinzdravCache (персистентный)
// ---------------------------------------------------------------------------

interface MemEntry {
  payload: string;
  expiresAt: number;
}
const memCache = new Map<string, MemEntry>();
const MEM_CACHE_MAX = 200;

function memGet(key: string): string | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return e.payload;
}

function memSet(key: string, payload: string, ttlMs: number): void {
  if (memCache.size > MEM_CACHE_MAX) {
    // грубая очистка просроченных
    const now = Date.now();
    for (const [k, v] of memCache) {
      if (now > v.expiresAt) memCache.delete(k);
    }
    if (memCache.size > MEM_CACHE_MAX) {
      const first = memCache.keys().next().value;
      if (first) memCache.delete(first);
    }
  }
  memCache.set(key, { payload, expiresAt: Date.now() + ttlMs });
}

/**
 * Двухуровневое чтение кэша: память → SQLite (валидный) →
 * SQLite (просроченный, только если allowStale) → null.
 */
async function cacheGet(
  key: string,
  kind: keyof typeof TTL,
  allowStale = false,
): Promise<string | null> {
  const hot = memGet(key);
  if (hot) return hot;
  try {
    const row = await db.minzdravCache.findUnique({ where: { cacheKey: key } });
    if (!row) return null;
    const fresh = row.expiresAt.getTime() > Date.now();
    if (!fresh && !allowStale) return null;
    memSet(key, row.payload, Math.max(row.expiresAt.getTime() - Date.now(), 60_000));
    return row.payload;
  } catch (e) {
    logger.warn("minzdrav", "Cache read failed", {
      key: key.slice(0, 80),
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Запись в оба уровня кэша (best-effort, ошибка БД не роняет поиск). */
async function cacheSet(
  key: string,
  kind: keyof typeof TTL,
  payload: string,
): Promise<void> {
  const ttl = TTL[kind];
  memSet(key, payload, ttl);
  try {
    await db.minzdravCache.upsert({
      where: { cacheKey: key },
      create: {
        cacheKey: key,
        kind,
        payload,
        expiresAt: new Date(Date.now() + ttl),
      },
      update: {
        payload,
        kind,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + ttl),
      },
    });
    // Раз в 8 записей — чистка (просроченные + лимит полных текстов)
    cacheWriteCounter++;
    if (cacheWriteCounter % 8 === 0) {
      await pruneCacheIfNeeded();
    }
  } catch (e) {
    logger.warn("minzdrav", "Cache write failed (non-blocking)", {
      key: key.slice(0, 80),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Базовый HTTP к API Минздрава (никогда не бросает)
// ---------------------------------------------------------------------------

async function minzdravFetch(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  const result = await safeFetch(url, {
    ...init,
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: {
      "User-Agent": MINZDRAV_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ru-RU,ru;q=0.9",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!result.ok || !result.response?.ok) {
    logger.warn("minzdrav", "API request failed", {
      url: url.slice(0, 120),
      error: result.error ?? `HTTP ${result.response?.status ?? "?"}`,
      circuitOpen: result.circuitOpen ?? false,
    });
    return null;
  }
  return result.response;
}

// ---------------------------------------------------------------------------
// HTML → текст (для выдержек КР)
// ---------------------------------------------------------------------------

/** Декодирует основные HTML-сущности. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&deg;/g, "°");
}

/** Конвертирует HTML-содержимое раздела КР в читаемый текст. */
export function htmlToText(html: string): string {
  let text = html
    // таблицы → строки с "|"
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|table|ul|ol|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    // удаляем все остальные теги
    .replace(/<[^>]+>/g, "")
    // сущности
    ;
  text = decodeEntities(text);
  // нормализация пробелов
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ \| /g, " | ")
    .trim();
}

// ---------------------------------------------------------------------------
// Справочник МКБ (GetMkbRefList) — для трансляции кодов в Id фильтра
// ---------------------------------------------------------------------------

let mkbRefPromise: Promise<MkbRefItem[]> | null = null;

/** Загружает (и кэширует) полный справочник МКБ-10 Минздрава. */
export async function getMkbRefList(force = false): Promise<MkbRefItem[]> {
  if (!force && mkbRefPromise) return mkbRefPromise;
  mkbRefPromise = (async () => {
    const cacheKey = "mkbref";
    const cached = await cacheGet(cacheKey, "mkbref");
    if (cached) {
      try {
        return JSON.parse(cached) as MkbRefItem[];
      } catch {
        /* кэш повреждён — обновим */
      }
    }
    const res = await minzdravFetch(`${MINZDRAV_API_BASE}?op=GetMkbRefList`);
    if (!res) {
      // офлайн-режим: попробуем просроченный кэш
      const stale = await cacheGet(cacheKey, "mkbref", true);
      if (stale) {
        try {
          return JSON.parse(stale) as MkbRefItem[];
        } catch {
          /* ignore */
        }
      }
      return [];
    }
    try {
      const data = (await res.json()) as MkbRefItem[];
      if (Array.isArray(data) && data.length > 0) {
        await cacheSet(cacheKey, "mkbref", JSON.stringify(data));
        logger.info("minzdrav", "МКБ reference loaded", { count: data.length });
        return data;
      }
    } catch (e) {
      logger.warn("minzdrav", "МКБ reference parse failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return [];
  })();
  return mkbRefPromise;
}

/**
 * Преобразует коды МКБ-10 (напр. ["E11", "E11.9"]) в Id справочника
 * Минздрава для фильтра mkbid. Поддерживает групповые коды и префиксы:
 * ищем точное совпадение кода, затем код без точки, затем родителя.
 */
export async function resolveMkbIds(codes: string[]): Promise<number[]> {
  if (codes.length === 0) return [];
  const ref = await getMkbRefList();
  if (ref.length === 0) return [];
  const byCode = new Map<string, number>();
  for (const item of ref) byCode.set(item.Code.toUpperCase(), item.Id);

  const ids = new Set<number>();
  for (const raw of codes) {
    const code = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) continue;
    // точное совпадение
    const exact = byCode.get(code);
    if (exact) {
      ids.add(exact);
      continue;
    }
    // код с точкой → пробуем родителя (E11.9 → E11)
    const dot = code.indexOf(".");
    if (dot > 0) {
      const parent = byCode.get(code.slice(0, dot));
      if (parent) {
        ids.add(parent);
        continue;
      }
    }
    // префиксное совпадение (E1 → E10..E14 группы)
    for (const [c, id] of byCode) {
      if (c.startsWith(code) && c.length <= code.length + 2) {
        ids.add(id);
        if (ids.size >= 25) break; // не раздуваем фильтр
      }
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Поиск клинических рекомендаций (GetJsonClinrecsFilterV2)
// ---------------------------------------------------------------------------

interface CrFilter {
  fieldName: string;
  filterType: number;
  filterValueType: number;
  value1?: string | number;
  value2?: string;
  values?: Array<string | number>;
}

/**
 * Поиск КР в официальном репозитории Минздрава.
 *
 * @param p.query         текст по названию КР (содержит, регистронезависимо)
 * @param p.mkbCodes      коды МКБ-10 для фильтра (напр. из подсказок ИИ)
 * @param p.ageCategory   1 — дети, 2 — взрослые, 3 — взрослые и дети
 * @param p.page          страница (с 1)
 * @param p.pageSize      размер страницы
 * @param p.includeContent загрузить полные тексты топ-N КР (выдержки)
 */
export async function searchClinrecs(
  p: ClinrecSearchParams = {},
): Promise<{ items: ClinrecListItem[]; total: number; error?: string; fromCache: boolean }> {
  if (!MINZDRAV_ENABLED) {
    return { items: [], total: 0, error: "Поиск в репозитории Минздрава отключён (MINZDRAV_CR_ENABLED=false)", fromCache: false };
  }

  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, p.pageSize ?? 10));

  const filters: CrFilter[] = [
    // status=0 — утверждённые (действующие) КР, как на cr.minzdrav.gov.ru/clin-rec
    { fieldName: "status", filterType: 1, filterValueType: 2, value1: 0, value2: "", values: [] },
  ];
  if (p.query && p.query.trim().length >= 2) {
    filters.push({
      fieldName: "name",
      filterType: 2, // содержит
      filterValueType: 1,
      value1: p.query.trim().slice(0, 120),
      value2: "",
      values: [],
    });
  }
  if (p.mkbCodes && p.mkbCodes.length > 0) {
    const mkbIds = await resolveMkbIds(p.mkbCodes);
    if (mkbIds.length > 0) {
      filters.push({
        fieldName: "mkbid",
        filterType: 9, // вхождение в набор
        filterValueType: 1,
        value1: "",
        value2: "",
        values: mkbIds,
      });
    }
  }
  if (p.ageCategory != null && p.ageCategory > 0) {
    filters.push({
      fieldName: "agecategory",
      filterType: 9,
      filterValueType: 1,
      value1: "",
      value2: "",
      values: [p.ageCategory],
    });
  }

  // Ключ кэша: нормализованные фильтры
  const cacheKey = `search:${JSON.stringify({ q: (p.query ?? "").trim().toLowerCase(), mkb: (p.mkbCodes ?? []).map((c) => c.toUpperCase()).sort(), age: p.ageCategory ?? 0, page, pageSize })}`;

  const cached = await cacheGet(cacheKey, "search");
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ClinrecSearchResponse;
      return { items: parsed.Data ?? [], total: parsed.TotalRecords ?? 0, fromCache: true };
    } catch {
      /* повреждённый кэш — идём в сеть */
    }
  }

  const url = `${MINZDRAV_API_BASE}?op=GetJsonClinrecsFilterV2`;
  const res = await minzdravFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${MINZDRAV_CR_SITE}/clin-rec`,
      Origin: MINZDRAV_CR_SITE,
    },
    body: JSON.stringify({
      page,
      pageSize,
      filters,
      sortOption: { fieldName: "publishdate", sortType: 2 }, // новые сверху
    }),
  });

  if (!res) {
    // офлайн: просроченный кэш лучше ничего
    const stale = await cacheGet(cacheKey, "search", true);
    if (stale) {
      try {
        const parsed = JSON.parse(stale) as ClinrecSearchResponse;
        logger.info("minzdrav", "Offline: serving stale search cache", { cacheKey: cacheKey.slice(0, 60) });
        return { items: parsed.Data ?? [], total: parsed.TotalRecords ?? 0, fromCache: true };
      } catch {
        /* ignore */
      }
    }
    return { items: [], total: 0, error: "Репозиторий Минздрава (apicr.minzdrav.gov.ru) недоступен", fromCache: false };
  }

  try {
    const data = (await res.json()) as ClinrecSearchResponse;
    if (!Array.isArray(data.Data)) {
      return { items: [], total: 0, error: "Неожиданный формат ответа API Минздрава", fromCache: false };
    }
    await cacheSet(cacheKey, "search", JSON.stringify(data));
    logger.info("minzdrav", "CR search completed", {
      query: p.query?.slice(0, 60),
      total: data.TotalRecords,
      returned: data.Data.length,
    });
    return { items: data.Data, total: data.TotalRecords ?? 0, fromCache: false };
  } catch (e) {
    return {
      items: [],
      total: 0,
      error: `Ошибка разбора ответа Минздрава: ${e instanceof Error ? e.message : String(e)}`,
      fromCache: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Полный текст КР (GetClinrec2)
// ---------------------------------------------------------------------------

/**
 * Облегчение полного текста КР перед записью в кэш (оптимизация размера):
 *   • Удаляется раздел doc_whole — он ДУБЛИРУЕТ все остальные разделы одним
 *     куском (до 200+ КБ чистой избыточности).
 *   • Из HTML разделов вырезаются встроенные base64-изображения (алгоритмы
 *     и шкалы Приложений Б/Г содержат ПНГ-картинки по 200-500 КБ каждая,
 *     что раздувает JSON одной КР до 2-7 МБ). Текст при этом сохраняется
 *     полностью — изображения не участвуют ни в RAG-разборе, ни в
 *     текстовом отображении разделов.
 */
export function slimClinrecFullForCache(full: ClinrecFull): ClinrecFull {
  if (!full.obj?.sections) return full;
  const sections = full.obj.sections
    // doc_whole — дубликат всех разделов, в кэше не нужен
    .filter((s) => s.id !== "doc_whole")
    .map((s) => ({
      ...s,
      // Вырезаем data:-URI изображения (base64 ПНГ), сохраняя остальной HTML
      content: (s.content ?? "").replace(
        /<img[^>]*src\s*=\s*["']data:image\/[^"']*["'][^>]*>/gi,
        "",
      ),
    }));
  return { ...full, obj: { sections } };
}

/**
 * Загружает полный структурированный текст КР по коду версии "286_3".
 * Кэшируется на 7 дней (тексты КР меняются редко — только при пересмотре).
 * В кэш пишется ОБЛЕГЧЁННАЯ копия (без base64-картинок и дублирующего
 * doc_whole) — см. slimClinrecFullForCache: экономит мегабайты в SQLite.
 */
export async function getClinrecFull(
  codeVersion: string,
  force = false,
): Promise<ClinrecFull | null> {
  const cv = codeVersion.trim();
  if (!/^\d+_\d+$/.test(cv)) {
    logger.warn("minzdrav", "Invalid CodeVersion", { codeVersion: cv });
    return null;
  }
  const cacheKey = `full:${cv}`;

  if (!force) {
    const cached = await cacheGet(cacheKey, "full");
    if (cached) {
      try {
        return JSON.parse(cached) as ClinrecFull;
      } catch {
        /* повреждён */
      }
    }
  }

  const url = `${MINZDRAV_API_BASE}?op=GetClinrec2&id=${encodeURIComponent(cv)}`;
  const res = await minzdravFetch(url, {
    headers: { Referer: `${MINZDRAV_CR_SITE}/view-cr/${cv}` },
  });

  if (!res) {
    // офлайн: просроченный кэш
    const stale = await cacheGet(cacheKey, "full", true);
    if (stale) {
      try {
        return JSON.parse(stale) as ClinrecFull;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  try {
    const data = (await res.json()) as ClinrecFull;
    if (!data || typeof data.name !== "string") return null;
    // Полные тексты бывают очень большими (2-7 МБ из-за base64-картинок в
    // Приложениях Б/Г). В кэш пишем ОБЛЕГЧЁННУЮ версию: тексты разделов
    // сохраняются полностью, встроенные изображения и дубль doc_whole — нет.
    const slim = slimClinrecFullForCache(data);
    await cacheSet(cacheKey, "full", JSON.stringify(slim));
    logger.info("minzdrav", "Clinrec full cached (slim)", {
      codeVersion: cv,
      sections: slim.obj?.sections?.length ?? 0,
      rawChars: JSON.stringify(data).length,
      slimChars: JSON.stringify(slim).length,
    });
    return slim;
  } catch (e) {
    logger.warn("minzdrav", "GetClinrec2 parse failed", {
      codeVersion: cv,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Извлечение релевантных разделов из полного текста КР
// ---------------------------------------------------------------------------

/** Идентификаторы разделов «Диагностика» (для диагностического контекста). */
const DIAG_SECTION_IDS = [
  "doc_diag_2", "doc_diag_2_1", "doc_diag_2_2", "doc_diag_2_3",
  "doc_diag_2_4", "doc_diag_2_5", "doc_diag_2_6",
];

/** Идентификаторы раздела «Лечение». */
const THERAPY_SECTION_IDS = ["doc_3"];

/** Идентификаторы раздела «Краткая информация» (определение, классификация). */
const BRIEF_SECTION_IDS = [
  "doc_crat_info_1_1", "doc_crat_info_1_2", "doc_crat_info_1_5",
  "doc_crat_info_1_6",
];

function sectionsBy(full: ClinrecFull, ids: string[]): ClinrecSection[] {
  const sections = full.obj?.sections ?? [];
  return sections.filter((s) => ids.includes(s.id));
}

/** Собирает текстовую выдержку из указанных разделов КР. */
function excerptFrom(
  full: ClinrecFull,
  ids: string[],
  maxChars: number,
): string {
  const parts: string[] = [];
  let total = 0;
  for (const s of sectionsBy(full, ids)) {
    const text = htmlToText(s.content).trim();
    if (text.length < 20) continue;
    parts.push(`【${s.title}】\n${text}`);
    total += text.length;
    if (total >= maxChars) break;
  }
  return parts.join("\n\n").slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Нормализация карточек КР → ClinrecMatch (для UI и RAG)
// ---------------------------------------------------------------------------

/** Оценивает релевантность КР для поисковых терминов (0..1). */
function scoreRelevance(item: ClinrecListItem, terms: string[]): number {
  if (terms.length === 0) return 0.5;
  const haystack = `${item.Name} ${(item.Mkbs ?? []).map((m) => `${m.MkbCode} ${m.MkbName}`).join(" ")}`.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    const term = t.toLowerCase().trim();
    if (term.length < 3) continue;
    if (haystack.includes(term)) hits++;
  }
  const base = hits / terms.length;
  // КР, одобренные НПС Минздрава, получают небольшой бонус доверия
  const npcBonus = item.NPC_approved ? 0.05 : 0;
  return Math.min(1, 0.35 + base * 0.6 + npcBonus);
}

/** Публичная ссылка просмотра КР на cr.minzdrav.gov.ru. */
export function clinrecUrl(codeVersion: string): string {
  return `${MINZDRAV_CR_SITE}/view-cr/${codeVersion}`;
}

/** Ссылка на официальный PDF КР. */
export function clinrecPdfUrl(codeVersion: string): string {
  return `${MINZDRAV_API_BASE}?op=GetClinrecPdf&id=${encodeURIComponent(codeVersion)}`;
}

/**
 * Расширенный поиск КР Минздрава: список + (опционально) выдержки полных
 * текстов. Главная функция для RAG-конвейера и UI базы знаний.
 */
export async function findClinrecs(
  p: ClinrecSearchParams & { terms?: string[] } = {},
): Promise<ClinrecMatch[]> {
  // ─── Многошаговая стратегия поиска ───────────────────────────────────
  // API Минздрава ищет по подстроке названия КР. Полный запрос из
  // нескольких терминов ("гипертония гипертензия") почти никогда не
  // встречается в названиях дословно, поэтому:
  //   Шаг 1: полный запрос
  //   Шаг 2: если 0 результатов — каждый термин отдельно (до 4 терминов)
  //   Шаг 3: если 0 — первые 2 термина, затем первый термин
  // Результаты объединяются с дедупликацией по CodeVersion.
  const terms = p.terms ?? (p.query ? p.query.split(/\s+/).filter((t) => t.length > 2) : []);

  let items: ClinrecListItem[] = [];
  let error: string | undefined;

  // Шаг 1: полный запрос
  const primary = await searchClinrecs(p);
  items = primary.items;
  error = primary.error;

  // Шаг 2: поиск по отдельным терминам
  if (items.length === 0 && !error && terms.length > 1) {
    const perTerm = await Promise.all(
      terms.slice(0, 4).map((t) =>
        searchClinrecs({
          query: t,
          mkbCodes: p.mkbCodes,
          ageCategory: p.ageCategory,
          page: 1,
          pageSize: Math.max(3, Math.floor((p.pageSize ?? 10) / 2)),
        }),
      ),
    );
    const seen = new Set<string>();
    for (const r of perTerm) {
      if (r.error) error = r.error;
      for (const item of r.items) {
        if (!seen.has(item.CodeVersion)) {
          seen.add(item.CodeVersion);
          items.push(item);
        }
      }
    }
    if (items.length > 0) {
      logger.info("minzdrav", "CR search: per-term retry succeeded", {
        terms: terms.slice(0, 4),
        found: items.length,
      });
    }
  }

  if (items.length === 0 && (error || items.length === 0)) {
    logger.warn("minzdrav", "findClinrecs: no results", { error, query: p.query?.slice(0, 60) });
  }

  const matches: ClinrecMatch[] = items.map((item) => ({
    codeVersion: item.CodeVersion,
    name: item.Name,
    mkbCodes: (item.Mkbs ?? []).map((m) => m.MkbCode),
    mkbString: (item.Mkbs ?? []).map((m) => m.MkbCode).join(", "),
    developers: (item.Developers ?? []).map((d) => d.NkoName).filter(Boolean),
    ageCategory: item.AgeCategoryStr,
    publishDate: item.PublishDateStr,
    npcApproved: Boolean(item.NPC_approved),
    applyStatusCalculated: item.ApplyStatusCalculated,
    url: clinrecUrl(item.CodeVersion),
    pdfUrl: clinrecPdfUrl(item.CodeVersion),
    relevanceScore: scoreRelevance(item, terms.length > 0 ? terms : [p.query ?? ""]),
  }));

  // Сортировка по релевантности
  matches.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Догрузка полных текстов для топ-N (выдержки диагностики/лечения)
  if (p.includeContent && matches.length > 0) {
    const top = matches.slice(0, Math.max(1, Math.min(p.maxContentFetch ?? 3, matches.length)));
    await Promise.all(
      top.map(async (m) => {
        const full = await getClinrecFull(m.codeVersion);
        if (!full) return;
        m.contentExcerpt = excerptFrom(full, BRIEF_SECTION_IDS, 1200);
        m.diagnosticsExcerpt = excerptFrom(full, DIAG_SECTION_IDS, 2200);
        m.therapyExcerpt = excerptFrom(full, THERAPY_SECTION_IDS, 2200);
        m.sectionsCount = full.obj?.sections?.length ?? 0;
      }),
    );
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Контекст для LLM (RAG)
// ---------------------------------------------------------------------------

/**
 * Строит текстовый контекст из найденных КР Минздрава для подачи в LLM.
 * Формат — компактные блоки с точными ссылками на официальный источник.
 */
export function buildClinrecContext(matches: ClinrecMatch[]): string {
  if (matches.length === 0) return "";
  const blocks = matches.map((m, i) => {
    const parts: string[] = [];
    parts.push(`[КР Минздрава РФ #${i + 1}] ${m.name}`);
    parts.push(`Код/версия: ${m.codeVersion}; МКБ-10: ${m.mkbString || "—"}; Возрастная категория: ${m.ageCategory}; Утверждена НПС: ${m.npcApproved ? "да" : "нет"}`);
    if (m.developers.length > 0) {
      parts.push(`Разработчики: ${m.developers.join("; ")}`);
    }
    parts.push(`Официальный источник: ${m.url}`);
    if (m.diagnosticsExcerpt) {
      parts.push(`--- Из раздела «Диагностика» ---\n${m.diagnosticsExcerpt}`);
    }
    if (m.therapyExcerpt) {
      parts.push(`--- Из раздела «Лечение» ---\n${m.therapyExcerpt}`);
    }
    if (!m.diagnosticsExcerpt && !m.therapyExcerpt && m.contentExcerpt) {
      parts.push(m.contentExcerpt);
    }
    return parts.join("\n");
  });
  return [
    "КОНТЕКСТ: ФРАГМЕНТЫ ОФИЦИАЛЬНЫХ КЛИНИЧЕСКИХ РЕКОМЕНДАЦИЙ МИНЗДРАВА РФ",
    "(репозиторий cr.minzdrav.gov.ru — утверждённые КР)",
    "Все рекомендации ниже основаны ТОЛЬКО на официальных КР Минздрава России.",
    "",
    ...blocks,
  ].join("\n");
}

/**
 * Быстрый подбор КР по коду МКБ-10 — для привязки диагнозов (диф. диагноз,
 * подсказки МКБ) к официальной клинической рекомендации.
 */
export async function findClinrecByMkb(
  icd10: string,
  ageCategory?: number | null,
): Promise<ClinrecMatch | null> {
  if (!icd10.trim()) return null;
  const { items } = await searchClinrecs({ mkbCodes: [icd10], ageCategory: ageCategory ?? undefined, pageSize: 5 });
  if (items.length === 0) return null;
  const item = items[0];
  return {
    codeVersion: item.CodeVersion,
    name: item.Name,
    mkbCodes: (item.Mkbs ?? []).map((m) => m.MkbCode),
    mkbString: (item.Mkbs ?? []).map((m) => m.MkbCode).join(", "),
    developers: (item.Developers ?? []).map((d) => d.NkoName).filter(Boolean),
    ageCategory: item.AgeCategoryStr,
    publishDate: item.PublishDateStr,
    npcApproved: Boolean(item.NPC_approved),
    applyStatusCalculated: item.ApplyStatusCalculated,
    url: clinrecUrl(item.CodeVersion),
    pdfUrl: clinrecPdfUrl(item.CodeVersion),
    relevanceScore: 1,
  };
}

/**
 * Быстрый подбор КР по названию диагноза — для диф. диагностики.
 */
export async function findClinrecByName(
  diagnosisName: string,
  ageCategory?: number | null,
): Promise<ClinrecMatch | null> {
  if (!diagnosisName.trim()) return null;
  // Оставляем ключевые слова диагноза (первые 4 слова без стоп-слов)
  const stop = new Set([
    "и", "или", "не", "с", "у", "в", "на", "о", "об", "острый", "острая",
    "хронический", "хроническая", "типа", "вид",
  ]);
  const words = diagnosisName
    .toLowerCase()
    .replace(/[()«»",.]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 3);
  const query = words.join(" ").trim();
  if (query.length < 3) return null;
  const { items } = await searchClinrecs({ query, ageCategory: ageCategory ?? undefined, pageSize: 5 });
  if (items.length === 0) return null;
  // выбираем самую релевантную по совпадению слов
  let best = items[0];
  let bestScore = -1;
  for (const item of items) {
    const score = scoreRelevance(item, words);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return {
    codeVersion: best.CodeVersion,
    name: best.Name,
    mkbCodes: (best.Mkbs ?? []).map((m) => m.MkbCode),
    mkbString: (best.Mkbs ?? []).map((m) => m.MkbCode).join(", "),
    developers: (best.Developers ?? []).map((d) => d.NkoName).filter(Boolean),
    ageCategory: best.AgeCategoryStr,
    publishDate: best.PublishDateStr,
    npcApproved: Boolean(best.NPC_approved),
    applyStatusCalculated: best.ApplyStatusCalculated,
    url: clinrecUrl(best.CodeVersion),
    pdfUrl: clinrecPdfUrl(best.CodeVersion),
    relevanceScore: bestScore,
  };
}

// ---------------------------------------------------------------------------
// Статистика кэша (для UI / системного статуса)
// ---------------------------------------------------------------------------

export async function getMinzdravCacheStats(): Promise<{
  entries: number;
  fullTexts: number;
  searches: number;
  oldestFetch: string | null;
}> {
  try {
    const [entries, fullTexts, searches, oldest] = await Promise.all([
      db.minzdravCache.count(),
      db.minzdravCache.count({ where: { kind: "full" } }),
      db.minzdravCache.count({ where: { kind: "search" } }),
      db.minzdravCache.findFirst({ orderBy: { fetchedAt: "asc" } }),
    ]);
    return {
      entries,
      fullTexts,
      searches,
      oldestFetch: oldest?.fetchedAt?.toISOString() ?? null,
    };
  } catch {
    return { entries: 0, fullTexts: 0, searches: 0, oldestFetch: null };
  }
}
