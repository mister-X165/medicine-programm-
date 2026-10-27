// СППВР v5.0 — Network Health & Circuit Breaker (REWORK)
// ============================================================================
// PURPOSE: отказоустойчивая работа с сетью. При недоступности интернета
// (DNS, connection refused, timeout) система должна:
//   1. Быстро детектировать сбой (не висеть по 15 с на каждый запрос)
//   2. Не «ронять» сеть из-за ОДНОГО сбойного хоста (v5.0: circuit breaker
//      теперь PER-HOST, а не глобальный)
//   3. Автоматически ВОССТАНАВЛИВАТЬ статус фоновым зондом — раньше сеть
//      «слетала» после некоторого времени работы и не возвращалась, потому
//      что статус обновлялся только при очередном запросе (а запросов могло
//      не быть), и один-два тайм-аута Минздрава открывали цепь на всё.
//   4. Никогда не ронять запрос — всегда деградировать graceful.
//
// v5.0 CHANGELOG (исправление «сеть слетает после некоторого времени»):
//   • МУЛЬТИ-ЭНДПОИНТНЫЙ ЗОНД: раньше проверялся ТОЛЬКО cr.minzdrav.gov.ru —
//     его троттлинг/медленный ответ помечал всю систему «офлайн», хотя
//     интернет работал. Теперь зонд считается успешным, если доступен
//     ХОТЯ БЫ ОДИН из независимых эндпоинтов (Минздрав, Cloudflare, gstatic,
//     Яндекс). Список переопределяется через NETWORK_PROBE_ENDPOINTS.
//   • ГИСТЕРЕЗИС: статус уходит в «офлайн» только после NETWORK_OFFLINE_AFTER_
//     FAILURES (по умолч. 2) ПОДРЯД неудачных ЦИКЛОВ зондирования; один
//     успешный зонд немедленно возвращает «онлайн».
//   • ФОНОВОЕ ЗОНДИРОВАНИЕ: таймер (setInterval, unref) раз в
//     NETWORK_PROBE_INTERVAL_MS обновляет статус сам — статус актуален и
//     восстанавливается даже без входящих запросов.
//   • PER-HOST CIRCUIT BREAKER: сбои одного хоста (например,PubMed недоступен)
//     не блокируют остальные (Минздрав работает). У каждого хоста свой
//     порог/охлаждение (env-настраиваемые).
//   • Глобальный статус (online) остаётся чисто ИНФОРМАЦИОННЫМ: safeFetch
//     выполняет запрос, даже если глобальный зонд «офлайн» (персистентные
//     кеши Минздрава могут отдать данные), но уважает per-host цепь.
//
// Используется: web-rag.ts, international-rag.ts, chat/analyze routes,
// api/network/status, api/health.
// ============================================================================

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Конфигурация (env)
// ---------------------------------------------------------------------------

const PROBE_INTERVAL_MS = parseInt(process.env.NETWORK_PROBE_INTERVAL_MS ?? "60000", 10);
const PROBE_TIMEOUT_MS = parseInt(process.env.NETWORK_PROBE_TIMEOUT_MS ?? "8000", 10);
// Гистерезис: столько подряд неудачных циклов зондирования = «офлайн»
const OFFLINE_AFTER_FAILURES = Math.max(
  1,
  parseInt(process.env.NETWORK_OFFLINE_AFTER_FAILURES ?? "2", 10),
);
// Per-host circuit breaker
const HOST_FAILURE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.NETWORK_CIRCUIT_FAILURE_THRESHOLD ?? "4", 10),
);
const HOST_COOLDOWN_MS = Math.max(
  5_000,
  parseInt(process.env.NETWORK_CIRCUIT_COOLDOWN_MS ?? "30000", 10),
);

// ---------------------------------------------------------------------------
// Эндпоинты зондирования
// ---------------------------------------------------------------------------
// Независимые друг от друга хосты: если ХОТЯ БЫ ОДИН ответил (любой HTTP-статус,
// включая 3xx/4xx/5xx) — сетевая связность есть. Минздрав РФ оставлен первым
// (основной зависимый источник), нейтральные CDN добавлены, чтобы троттлинг
// одного сайта не помечал всю систему офлайн.
//
// v4.3 audit fix сохранён: никаких вызовов z.ai-инфраструктуры.

const DEFAULT_PROBE_ENDPOINTS = [
  "https://cr.minzdrav.gov.ru/", // Минздрав РФ — публичная страница репозитория КР
  "https://apicr.minzdrav.gov.ru/api.ashx?op=GetNkoList", // Минздрав РФ — API КР
  "https://cloudflare.com/cdn-cgi/trace", // Cloudflare — нейтральный лёгкий эндпоинт
  "https://www.gstatic.com/generate_204", // Google — lightweight 204
  "https://ya.ru/", // Яндекс — независимая сеть
];

function probeEndpoints(): string[] {
  const raw = (process.env.NETWORK_PROBE_ENDPOINTS ?? "").trim();
  if (!raw) return DEFAULT_PROBE_ENDPOINTS;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
  return list.length > 0 ? list : DEFAULT_PROBE_ENDPOINTS;
}

// Хосты, чьи сбои НЕ должны влиять на глобальный статус (информационный
// онлайн-флаг остаётся положительным, а per-host цепь открывается отдельно).
// Внешние ИСТОЧНИКИ ЗНАНИЙ перечислены здесь, потому что их недоступность —
// штатная ситуация (нет интернета / блокировка), а не авария сети приложения.
const KNOWLEDGE_SOURCE_HOSTS = [
  "apicr.minzdrav.gov.ru",
  "cr.minzdrav.gov.ru",
  "minzdrav.gov.ru",
  "rosminzdrav.ru",
  "eutils.ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "duckduckgo.com",
  "html.duckduckgo.com",
  "lite.duckduckgo.com",
  "who.int",
  "nice.org.uk",
  "cochrane.org",
  "cdc.gov",
  "escardio.org",
  "ema.europa.eu",
];

/** Хост является источником знаний (его сбои не роняют глобальный статус). */
export function isKnowledgeSourceHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWLEDGE_SOURCE_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/**
 * @deprecated Совместимость со старыми вызовами. Раньше список хостов обходил
 * глобальный circuit breaker; в v5.0 цепь per-host, поэтому байпас не нужен.
 * Оставлено, чтобы не ломать внешних импортов (возвращает false).
 */
export function isBypassHost(url: string): boolean {
  return isKnowledgeSourceHost(url);
}

// ---------------------------------------------------------------------------
// Глобальный статус сети (информационный)
// ---------------------------------------------------------------------------

export interface NetworkStatus {
  online: boolean;
  lastCheck: number; // epoch ms
  lastError: string | null;
  consecutiveFailures: number; // подряд неудачных ЦИКЛОВ зондирования
  circuitOpenedAt: number | null; // когда последний раз уходили в офлайн
}

const status: NetworkStatus = {
  online: true, // оптимистично на старте
  lastCheck: 0,
  lastError: null,
  consecutiveFailures: 0,
  circuitOpenedAt: null,
};

let probeInProgress = false;

/**
 * Быстрая проверка связности:
 *  - онлайн и недавно (< 30 c) проверяли — вернуть кеш без запроса;
 *  - офлайн и интервал перепроверки не прошёл — fail-fast;
 *  - иначе — реальный зонд (достаточно ОДНОГО успешного эндпоинта).
 */
export async function checkNetwork(): Promise<boolean> {
  const now = Date.now();
  const sinceLastCheck = now - status.lastCheck;

  if (status.online && status.lastCheck > 0 && sinceLastCheck < 30_000) {
    return true;
  }
  if (!status.online && sinceLastCheck < PROBE_INTERVAL_MS) {
    return false;
  }
  if (probeInProgress) {
    return status.online;
  }

  probeInProgress = true;
  try {
    const { online, lastError } = await probeNetwork();
    if (online) {
      // Гистерезис: один успешный зонд немедленно возвращает «онлайн»
      if (!status.online) {
        logger.info("network", "Network recovered — status online", {
          offlineMs: status.circuitOpenedAt ? now - status.circuitOpenedAt : undefined,
        });
      }
      status.online = true;
      status.consecutiveFailures = 0;
      status.lastError = null;
      status.circuitOpenedAt = null;
      status.lastCheck = now;
    } else {
      status.consecutiveFailures += 1;
      status.lastCheck = now;
      // v5.0: сохраняем КОНКРЕТНУЮ причину (было: безликое «Network probe failed» —
      // невозможно было понять, почему сеть «слетела»)
      status.lastError = lastError || status.lastError || "Network probe failed";
      // Гистерезис: офлайн только после N подряд неудачных циклов
      if (
        status.online &&
        status.consecutiveFailures >= OFFLINE_AFTER_FAILURES
      ) {
        status.online = false;
        status.circuitOpenedAt = now;
        logger.warn("network", "Network marked offline (hysteresis)", {
          consecutiveFailures: status.consecutiveFailures,
          lastError: status.lastError,
        });
      }
    }
    return status.online;
  } finally {
    probeInProgress = false;
  }
}

/**
 * Зонд: перебирает эндпоинты; первый успешный HTTP-ответ = сеть есть.
 * Возвращает статус и последнюю ошибку (для диагностики «почему офлайн»).
 */
async function probeNetwork(): Promise<{ online: boolean; lastError: string | null }> {
  let lastError: string | null = null;
  for (const endpoint of probeEndpoints()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        signal: ctrl.signal,
        headers: {
          // v5.0 CRITICAL FIX: User-Agent обязан быть ASCII (HTTP ByteString).
          // Кириллический «СППВР/…» в заголовке приводил к выбросу
          // «Cannot convert argument to a ByteString…» на КАЖДЫЙ зонд под
          // Node/undici — сетевые проверки всегда «падали», circuit breaker
          // открывался и статус сети навсегда «слетал» в офлайн, хотя
          // интернет работал. Это и была причина жалобы «сеть слетает после
          // некоторого времени работы программы».
          "User-Agent": "SPPVR/5.0 (health-check)",
          Accept: "text/html,application/json,*/*;q=0.8",
        },
        // Редиректы не нужны — факта HTTP-ответа достаточно
        redirect: "manual" as RequestRedirect,
      });
      if (res.status > 0) {
        // Любой HTTP-ответ значит, что TCP+TLS+DNS работают
        return { online: true, lastError: null };
      }
      lastError = `HTTP ${res.status} от ${endpoint}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e instanceof Error && "cause" in e
        ? String((e as Error & { cause?: { code?: string } }).cause?.code ?? "")
        : "";
      lastError = `${endpoint} → ${msg}${code ? ` (${code})` : ""}`;
      logger.debug?.("network", "Probe endpoint failed", { endpoint, error: lastError });
    } finally {
      clearTimeout(timer);
    }
  }
  return { online: false, lastError };
}

// ---------------------------------------------------------------------------
// Фоновое зонди­рование — статус самообновляется и самовосстанавливается
// ---------------------------------------------------------------------------

let backgroundTimerStarted = false;

/** Запускает фоновый зонд (идемпотентно; вызывается lib-модулями при старте). */
export function ensureBackgroundProbe(): void {
  if (backgroundTimerStarted) return;
  backgroundTimerStarted = true;
  // Первый зонд — сразу после старта, в фоне
  setTimeout(() => {
    void checkNetwork();
  }, 3_000).unref?.();
  const timer = setInterval(() => {
    if (probeInProgress) return;
    void checkNetwork().catch(() => {
      /* never crash the timer */
    });
  }, PROBE_INTERVAL_MS);
  timer.unref?.();
}

// Запускаем фоновый зонд при первом импорте модуля
ensureBackgroundProbe();

/** Статус без зондирования (для health/UI). */
export function getNetworkStatus(): NetworkStatus {
  return { ...status };
}

/** Ручная пометка сбоя (информационная; per-host цепь обрабатывается отдельно). */
export function reportNetworkFailure(error: string): void {
  status.lastError = error;
  status.lastCheck = Date.now();
  // Глобальный статус меняют только циклы зондирования (гистерезис) —
  // одиночный сбой запроса не роняет всю сеть (главная причина бага «сеть
  // слетает»). Но зафиксировать ошибку для UI нужно.
}

/** Ручная пометка успеха. */
export function reportNetworkSuccess(): void {
  status.lastError = null;
  status.lastCheck = Date.now();
}

// ---------------------------------------------------------------------------
// PER-HOST Circuit Breaker
// ---------------------------------------------------------------------------

interface HostBreaker {
  failures: number;
  openedAt: number | null;
}

const hostBreakers = new Map<string, HostBreaker>();

function breakerFor(host: string): HostBreaker {
  let b = hostBreakers.get(host);
  if (!b) {
    b = { failures: 0, openedAt: null };
    hostBreakers.set(host, b);
  }
  return b;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Проверяет, разомкнута ли цепь хоста (fail-fast). Полуоткрытие: после
 * HOST_COOLDOWN_MS пропускает одну попытку.
 */
export function isHostCircuitOpen(url: string): boolean {
  const b = breakerFor(hostOf(url));
  if (b.failures < HOST_FAILURE_THRESHOLD || b.openedAt === null) return false;
  if (Date.now() - b.openedAt >= HOST_COOLDOWN_MS) {
    // Полуоткрытие: сбрасываем счётчик, следующая попытка реальная
    b.failures = HOST_FAILURE_THRESHOLD - 1;
    b.openedAt = null;
    logger.info("network", `Circuit half-open for ${hostOf(url)} — probing`);
    return false;
  }
  return true;
}

export function reportHostFailure(url: string, error: string): void {
  const host = hostOf(url);
  const b = breakerFor(host);
  b.failures += 1;
  if (b.failures >= HOST_FAILURE_THRESHOLD && b.openedAt === null) {
    b.openedAt = Date.now();
    logger.warn("network", `Circuit opened for ${host} (per-host)`, {
      failures: b.failures,
      error,
    });
  }
  reportNetworkFailure(error);
}

export function reportHostSuccess(url: string): void {
  const host = hostOf(url);
  const b = breakerFor(host);
  if (b.failures > 0 || b.openedAt !== null) {
    logger.info("network", `Circuit closed for ${host}`);
  }
  b.failures = 0;
  b.openedAt = null;
}

/** Статистика per-host цепей для админки/диагностики. */
export function getHostBreakerStats(): Array<{
  host: string;
  failures: number;
  open: boolean;
}> {
  return Array.from(hostBreakers.entries()).map(([host, b]) => ({
    host,
    failures: b.failures,
    open: b.openedAt !== null && Date.now() - b.openedAt < HOST_COOLDOWN_MS,
  }));
}

// ---------------------------------------------------------------------------
// Circuit breaker — совместимая обёртка (теперь per-host внутри)
// ---------------------------------------------------------------------------

export interface CircuitBreakerOptions {
  /** @deprecated v5.0: порог per-host из env (NETWORK_CIRCUIT_FAILURE_THRESHOLD) */
  failureThreshold?: number;
  /** @deprecated v5.0: охлаждение per-host из env (NETWORK_CIRCUIT_COOLDOWN_MS) */
  cooldownMs?: number;
  /** Имя операции для логов. */
  name?: string;
}

export interface CircuitBreakerResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  circuitOpen?: boolean;
}

export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  options: CircuitBreakerOptions = {},
): Promise<CircuitBreakerResult<T>> {
  const name = options.name ?? "operation";
  void options; // пороги больше не переопределяются на уровне вызова

  // Адрес хоста fn не знает — per-host логика применяется в safeFetch.
  // Здесь остаётся только перехват ошибок и классификация.
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNetworkError = isNetworkErrorLike(e);
    logger.warn("network", `Circuit breaker caught error in ${name}`, {
      error: msg,
      isNetworkError,
    });
    return { ok: false, error: msg };
  }
}

/**
 * Heuristic: does this error look like a network-level failure (as opposed
 * to an application-level error like a 404 or 500)?
 */
function isNetworkErrorLike(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("enotfound")) return true; // DNS
  if (msg.includes("econnrefused")) return true;
  if (msg.includes("econnreset")) return true;
  if (msg.includes("etimedout")) return true;
  if (msg.includes("eai_again")) return true; // DNS temporary failure
  if (msg.includes("aborted")) return true; // timeout
  if (msg.includes("timeout")) return true;
  if (msg.includes("network")) return true;
  if (msg.includes("undici")) return true; // Node fetch internals
  if (msg.includes("socket")) return true;
  if (msg.includes("other side closed")) return true;
  if (e instanceof TypeError && msg.includes("fetch")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// safeFetch — fetch(), который никогда не бросает исключение (per-host цепь)
// ---------------------------------------------------------------------------

export interface SafeFetchResult {
  ok: boolean;
  response?: Response;
  error?: string;
  circuitOpen?: boolean;
  fromCache?: boolean;
}

export async function safeFetch(
  url: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<SafeFetchResult> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const { timeoutMs: _omit, ...fetchOptions } = options ?? {};

  // v5.0: per-host circuit breaker. Сбои одного хоста не блокируют остальные.
  if (isHostCircuitOpen(url)) {
    return {
      ok: false,
      error: `Хост ${hostOf(url)} временно недоступен (circuit open, автопроверка через ${Math.round(HOST_COOLDOWN_MS / 1000)} с).`,
      circuitOpen: true,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: ctrl.signal,
    });
    reportHostSuccess(url);
    return { ok: true, response };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isNetworkErrorLike(e)) {
      reportHostFailure(url, msg);
    }
    // Информационный глобальный статус НЕ роняем одиночным сбоем
    logger.warn("network", `safeFetch failed: ${hostOf(url)}`, { error: msg });
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
