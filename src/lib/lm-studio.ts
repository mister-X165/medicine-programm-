// СППВР v5.1 — клиент ЛОКАЛЬНОГО ИИ-сервера (OpenAI-compatible инференс).
// ТЗ п. 4.1: прямой HTTP-вызов /v1/chat/completions.
//
// v5.1: ПОДДЕРЖКА llama-server (llama.cpp) — выбор провайдера через AI_PROVIDER:
//
//   AI_PROVIDER=llama-server  → llama.cpp llama-server (рекомендуется):
//       запуск на рабочей станции:  .\llama-server.exe -m model.gguf --port 8080
//       (или --host 127.0.0.1 --port 8080 -c 8192 --alias <имя>)
//       дефолтный URL: http://127.0.0.1:8080/v1
//       Особенности учтены:
//         • Health: GET /v1/models, при сбое — фолбэк на нативный GET /health
//         • cache_prompt: true — переиспользование KV-кеша (быстрее повторные
//           вызовы с длинным системным промптом)
//         • HTTP 404 «model not found» (если запущен с --alias) — автоматический
//           резолв реального id модели из /models и повтор запроса
//
//   AI_PROVIDER=lm-studio  → LM Studio (прежний режим):
//       дефолтный URL: http://127.0.0.1:1234/v1
//
// ОБЩИЕ параметры (тайм-ауты, ретраи, генерация) читаются из AI_* переменных
// с фолбэком на прежние LM_STUDIO_* (обратная совместимость .env v5.0).
//
// STREAMING (stream: true) — КРИТИЧНО для небольших моделей на CPU, которые
// генерируют длинные ответы (до 8K токенов) по 5-10 минут. Без streaming
// HTTP-соединение разрывается по тайм-ауту промежуточных прокси.
//
// v5.0 CHANGELOG (сохранено):
//   • КЕШ ЗДОРОВЬЯ: /models кешируется на AI_HEALTH_CACHE_MS — getActiveProvider()
//     больше не «долбит» сервер проверками перед каждым вызовом.
//   • УСТОЙЧИВОСТЬ К ОБРЫВАМ: сетевые ошибки (ECONNRESET/«other side closed»)
//     — разовое немедленное переподключение с чистым сокетом.
//   • SSRF-защита: hostname — localhost либо явно разрешён в
//     AI_EXTRA_ALLOWED_HOSTS (для стационарного GPU-сервера больницы).
//   • Поддержка API-ключа (Bearer).

import { logger } from "@/lib/logger";

export type AIProviderName = "llama-server" | "lm-studio";

export interface LMStudioConfig {
  provider: AIProviderName;
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  idleTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  healthTimeoutMs: number;
  healthCacheMs: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function numFloat(value: string | undefined, fallback: number): number {
  const n = parseFloat((value ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Человекочитаемая метка провайдера (для логов, UI, ошибок). */
export function providerLabel(provider: AIProviderName): string {
  return provider === "llama-server" ? "llama-server" : "LM Studio";
}

/**
 * Активный провайдер из .env (AI_PROVIDER).
 * Значения: "llama-server" (llama.cpp), "lm-studio" (LM Studio).
 * Если AI_PROVIDER не задан: при наличии LLAMA_SERVER_URL — llama-server,
 * иначе LM Studio (обратная совместимость с .env v5.0).
 */
export function getAIProvider(): AIProviderName {
  const raw = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (["llama-server", "llama", "llama.cpp", "llamacpp", "llama_cpp"].includes(raw)) {
    return "llama-server";
  }
  if (["lm-studio", "lmstudio", "lm_studio"].includes(raw)) {
    return "lm-studio";
  }
  if (raw.length === 0 && (process.env.LLAMA_SERVER_URL ?? "").trim().length > 0) {
    return "llama-server";
  }
  return "lm-studio";
}

/**
 * Общая переменная: сначала AI_<name>, при пустом значении — LM_STUDIO_<name>.
 * Так настройки v5.0 продолжают работать, а новые деплои могут использовать AI_*.
 */
function sharedEnv(name: string): string | undefined {
  const generic = (process.env[`AI_${name}`] ?? "").trim();
  if (generic.length > 0) return generic;
  return process.env[`LM_STUDIO_${name}`];
}

const PROVIDER_DEFAULT_URL: Record<AIProviderName, string> = {
  "llama-server": "http://127.0.0.1:8080/v1",
  "lm-studio": "http://127.0.0.1:1234/v1",
};

/**
 * Чтение конфигурации ИИ-провайдера из переменных окружения (.env).
 * Дефолты: llama-server → 127.0.0.1:8080, LM Studio → 127.0.0.1:1234.
 */
export function getLMStudioConfig(): LMStudioConfig {
  const provider = getAIProvider();
  const DEFAULT_URL = PROVIDER_DEFAULT_URL[provider];

  const enabled = (sharedEnv("ENABLED") ?? "true").toLowerCase() !== "false";

  // URL: провайдероспецифичная переменная (LLAMA_SERVER_URL / LM_STUDIO_URL),
  // иначе общий AI_URL / LM_STUDIO_URL, иначе дефолт порта провайдера.
  const providerUrl = (
    provider === "llama-server"
      ? process.env.LLAMA_SERVER_URL
      : process.env.LM_STUDIO_URL
  )?.trim();
  const rawUrl = (providerUrl || sharedEnv("URL") || DEFAULT_URL).trim();
  let baseUrl = rawUrl.replace(/\/+$/, "");

  // SSRF defense: URL должен указывать на локальный адрес ЛИБО на
  // хост, явно разрешённый оператором в AI_EXTRA_ALLOWED_HOSTS.
  // Неверный env (или инъекция в CI/CD), указывающий на внутренний хост
  // (например cloud metadata 169.254.169.254), превратил бы каждый LLM-вызов
  // в SSRF-пробу — такие хосты отклоняются жёстко.
  try {
    const u = new URL(baseUrl);
    const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
    const extra = (sharedEnv("EXTRA_ALLOWED_HOSTS") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    for (const h of extra) ALLOWED_HOSTS.add(h);
    if (!ALLOWED_HOSTS.has(u.hostname)) {
      logger.error(
        "lm-studio",
        `ИИ-сервер: hostname "${u.hostname}" не разрешён (localhost или AI_EXTRA_ALLOWED_HOSTS) — использую дефолт ${DEFAULT_URL} (SSRF-защита).`,
      );
      baseUrl = DEFAULT_URL;
    }
  } catch {
    logger.error("lm-studio", `Некорректный URL ИИ-сервера "${rawUrl}" — использую дефолт ${DEFAULT_URL}.`);
    baseUrl = DEFAULT_URL;
  }

  // Модель/ключ: провайдероспецифичная переменная с фолбэком на общую.
  const providerModel = (
    provider === "llama-server"
      ? process.env.LLAMA_SERVER_MODEL
      : process.env.LM_STUDIO_MODEL
  )?.trim();
  const model = (providerModel || sharedEnv("MODEL") || "").trim();

  const providerKey = (
    provider === "llama-server"
      ? process.env.LLAMA_SERVER_API_KEY
      : process.env.LM_STUDIO_API_KEY
  )?.trim();
  const apiKey = (providerKey || sharedEnv("API_KEY") || "").trim();

  return {
    provider,
    enabled,
    baseUrl,
    model,
    apiKey: apiKey.length > 0 ? apiKey : undefined,
    temperature: numFloat(sharedEnv("TEMPERATURE"), 0.2),
    maxTokens: num(sharedEnv("MAX_TOKENS"), 8192),
    timeoutMs: num(sharedEnv("TIMEOUT_MS"), 600_000),
    idleTimeoutMs: num(sharedEnv("IDLE_TIMEOUT_MS"), 180_000),
    maxRetries: Math.max(1, num(sharedEnv("MAX_RETRIES"), 2)),
    retryBaseDelayMs: num(sharedEnv("RETRY_BASE_DELAY_MS"), 1000),
    healthTimeoutMs: num(sharedEnv("HEALTH_TIMEOUT_MS"), 3000),
    healthCacheMs: num(sharedEnv("HEALTH_CACHE_MS"), 15_000),
  };
}

/** Алиас с нейтральным именем — новая точка входа для конфигурации. */
export const getAIProviderConfig = getLMStudioConfig;

interface LMChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LMChatCompletionResponse {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface LMModelsResponse {
  object?: string;
  data?: Array<{
    id: string;
    object?: string;
    owned_by?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Health check c кешем (v5.0) + llama-server /health fallback (v5.1)
// ---------------------------------------------------------------------------

export interface LMHealthResult {
  ok: boolean;
  error?: string;
  models?: string[];
  latencyMs?: number;
  /** Каким зондом проверено: "/models" (OpenAI) или "/health" (нативный llama-server). */
  via?: "models" | "health";
}

let healthCache: { result: LMHealthResult; expiresAt: number } | null = null;

/** Сбросить кеш доступности (вызывается при сетевом сбое чата). */
export function invalidateLMHealthCache(): void {
  healthCache = null;
}

// ---------------------------------------------------------------------------
// Общий чтение SSE-потока (DRY): chat и vision используют один и тот же
// парсер OpenAI-совместимого text/event-stream. Вызывает onDelta для каждой
// текстовой дельты и возвращает управление при [DONE], ошибке в потоке или
// idle-тайм-ауте.
// ---------------------------------------------------------------------------
async function readChatStream(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  provider: AIProviderName,
  onDelta: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastActivity = Date.now();

  while (true) {
    if (Date.now() - lastActivity > idleTimeoutMs) {
      logger.error("lm-studio", "ИИ-сервер: idle-тайм-аут streaming", { provider, idleTimeoutMs });
      return;
    }
    const { done, value } = await reader.read();
    if (done) return;
    lastActivity = Date.now();
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // последняя неполная строка остаётся в буфере

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          error?: unknown;
        };
        // llama-server может прислать ошибку прямо в потоке — прекращаем
        if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error) {
          logger.error("lm-studio", "ИИ-сервер: ошибка в streaming-ответе", {
            provider,
            error: typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error).slice(0, 200),
          });
          return;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        // Частичный JSON — игнорируем, соберём из следующих чанков
      }
    }
  }
}

function authHeaders(cfg: LMStudioConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  return headers;
}

/** Является ли ошибка сетевой (стоит ли переподключиться и повторить). */
function isConnectionLevelError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("other side closed") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("econnaborted") ||
    msg.includes("epipe") ||
    msg.includes("und_err_socket")
  );
}

interface ProbeOutcome {
  ok: boolean;
  error?: string;
  models: string[];
  latencyMs: number;
  via: "models" | "health";
}

/** Зонд OpenAI-совместимый: GET {baseUrl}/models. */
async function probeModels(cfg: LMStudioConfig): Promise<ProbeOutcome> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.healthTimeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      method: "GET",
      signal: ctrl.signal,
      headers: authHeaders(cfg),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}`,
        models: [],
        latencyMs: Date.now() - started,
        via: "models",
      };
    }
    const data = (await res.json()) as LMModelsResponse;
    let models = (data.data ?? []).map((m) => m.id).filter(Boolean);
    if (models.length > 10) models = models.slice(0, 10);
    return { ok: true, models, latencyMs: Date.now() - started, via: "models" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort|timeout/i.test(msg) ? "Тайм-аут (сервер не отвечает)" : msg,
      models: [],
      latencyMs: Date.now() - started,
      via: "models",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Нативный зонд llama-server: GET {origin}/health → {"status":"ok"}.
 * Используется как фолбэк, если /models недоступен (старые сборки llama.cpp,
 * нестандартные пути, --alias и т.п.).
 */
async function probeHealthRoot(cfg: LMStudioConfig): Promise<ProbeOutcome> {
  const started = Date.now();
  const origin = new URL(cfg.baseUrl).origin;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.healthTimeoutMs);
  try {
    const res = await fetch(`${origin}/health`, {
      method: "GET",
      signal: ctrl.signal,
      headers: authHeaders(cfg),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}`,
        models: [],
        latencyMs: Date.now() - started,
        via: "health",
      };
    }
    // llama-server отдаёт {"status":"ok"}; при загрузке модели — 503 с ошибкой.
    let statusOk = true;
    try {
      const body = (await res.json()) as { status?: string; error?: unknown };
      statusOk = !body.error && (body.status === undefined || body.status === "ok");
    } catch {
      // Тело не JSON — но HTTP 200 уже означает живой сервер.
    }
    return {
      ok: statusOk,
      error: statusOk ? undefined : "Сервер отвечает, но модель загружается",
      models: [],
      latencyMs: Date.now() - started,
      via: "health",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort|timeout/i.test(msg) ? "Тайм-аут (сервер не отвечает)" : msg,
      models: [],
      latencyMs: Date.now() - started,
      via: "health",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Проверка доступности ИИ-сервера.
 * llama-server: сначала GET {baseUrl}/models, при сбое — GET {origin}/health.
 * Результат кешируется на AI_HEALTH_CACHE_MS (по умолч. 15 с),
 * чтобы не долбить сервер проверками перед каждым LLM-вызовом.
 */
export async function checkLMStudioHealth(force = false): Promise<LMHealthResult> {
  const cfg = getLMStudioConfig();
  if (!cfg.enabled) {
    return { ok: false, error: `ИИ-сервер отключён (${cfg.provider === "llama-server" ? "AI_ENABLED" : "LM_STUDIO_ENABLED"}=false)` };
  }

  const now = Date.now();
  if (!force && healthCache && now < healthCache.expiresAt) {
    return healthCache.result;
  }

  let outcome = await probeModels(cfg);

  // llama-server: фолбэк на нативный /health (в корне origin)
  if (!outcome.ok && cfg.provider === "llama-server") {
    const fallback = await probeHealthRoot(cfg);
    if (fallback.ok) outcome = fallback;
  }

  const result: LMHealthResult = {
    ok: outcome.ok,
    error: outcome.error,
    models: outcome.ok && outcome.models.length > 0 ? outcome.models : undefined,
    latencyMs: outcome.latencyMs,
    via: outcome.via,
  };
  healthCache = { result, expiresAt: Date.now() + cfg.healthCacheMs };

  // Модель не задана явно — запоминаем первую с сервера (лог при первом разе)
  if (result.ok && result.models && result.models.length > 0 && !cfg.model) {
    logger.info(
      "lm-studio",
      `Модель ИИ не задана явно (${cfg.provider === "llama-server" ? "LLAMA_SERVER_MODEL" : "LM_STUDIO_MODEL"}) — используем первую модель сервера`,
      { model: result.models[0], via: result.via },
    );
  }

  return result;
}

/**
 * LLM-запрос к локальному серверу — POST {baseUrl}/chat/completions.
 * Совместимо с OpenAI Chat Completions API (LM Studio и llama-server).
 *
 * ИСПОЛЬЗУЕТ STREAMING (stream: true) — это КРИТИЧЕСКИ важно для небольших
 * моделей (gemma-3-4b на CPU), которые генерируют длинные ответы (до 8K
 * токенов) по 5-10 минут. Без streaming HTTP-соединение разрывается по
 * тайм-ауту промежуточных прокси (Caddy 30с, Next.js 60с, fetch 120с).
 * При streaming токены поступают постоянно → соединение живое → модель
 * доделывает ответ.
 *
 * v5.1 (llama-server): cache_prompt: true + авто-резолв модели при 404
 * («model not found» — если сервер запущен с --alias).
 *
 * Возвращает строку-ответ или null при ошибке.
 */
export async function lmStudioChat(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; temperature?: number; maxTokens?: number },
): Promise<string | null> {
  const cfg = getLMStudioConfig();
  if (!cfg.enabled) return null;

  const attemptOnce = (): Promise<string | null> =>
    lmStudioChatOnce(cfg, systemPrompt, userMessage, options, false);

  // Попытка 1 — обычная; при сетевом сбое сокета — немедленная попытка 2
  try {
    const first = await attemptOnce();
    return first;
  } catch (e) {
    if (isConnectionLevelError(e)) {
      logger.warn("lm-studio", "Соединение сброшено — переподключение чистым сокетом", {
        provider: cfg.provider,
        error: e instanceof Error ? e.message : String(e),
      });
      invalidateLMHealthCache();
      return await attemptOnce();
    }
    throw e;
  }
}

async function lmStudioChatOnce(
  cfg: LMStudioConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; temperature?: number; maxTokens?: number },
  isModelRetry = false,
): Promise<string | null> {
  const finalSystem = options?.json
    ? `${systemPrompt}\n\nВАЖНО: ответь ТОЛЬКО валидным JSON без markdown-обёртки.`
    : systemPrompt;

  const messages: LMChatMessage[] = [
    { role: "system", content: finalSystem },
    { role: "user", content: userMessage },
  ];

  // Тайм-аут из ENV (AI_TIMEOUT_MS, по умолч. 10 минут): gemma-3-4b
  // на CPU может генерировать 8K токенов до 5-8 минут. Streaming держит
  // соединение активным, abort-controller — предохранитель от зависаний.
  const timeoutMs = cfg.timeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const requestBody: Record<string, unknown> = {
    model: cfg.model || pickModelFromCache() || (cfg.provider === "llama-server" ? "" : "local-model"),
    messages,
    temperature: options?.temperature ?? cfg.temperature,
    max_tokens: options?.maxTokens ?? cfg.maxTokens,
    stream: true, // ← STREAMING: критично для длинных ответов на CPU
  };
  // llama-server: переиспользование KV-кеша промпта — заметно быстрее
  // повторные вызовы с большим системным промптом (анализ кейсов).
  if (cfg.provider === "llama-server") {
    requestBody.cache_prompt = true;
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        ...authHeaders(cfg),
        // Не кешировать — важно для streaming
        Accept: "text/event-stream",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("lm-studio", "ИИ-сервер: HTTP-ошибка chat/completions", {
        provider: cfg.provider,
        status: res.status,
        body: text.slice(0, 200),
      });

      // llama-server, запущенный с --alias, возвращает 404 «model not found»,
      // если имя модели в запросе не совпало. Автоматически резолвим реальный
      // id из /models и повторяем ОДИН раз.
      if (
        res.status === 404 &&
        cfg.provider === "llama-server" &&
        !isModelRetry &&
        /model/i.test(text)
      ) {
        invalidateLMHealthCache();
        const health = await checkLMStudioHealth(true);
        if (health.ok && health.models && health.models.length > 0) {
          rememberFirstModel(health.models);
          logger.warn("lm-studio", "404 model not found — повтор с моделью с сервера", {
            model: health.models[0],
          });
          return await lmStudioChatOnce(cfg, systemPrompt, userMessage, options, true);
        }
      }

      // HTTP-ошибка не сетевая — переподключение не поможет
      return null;
    }

    if (!res.body) {
      // Сервер не поддерживает streaming — fallback к JSON-ответу
      const data = (await res.json()) as LMChatCompletionResponse;
      return data.choices?.[0]?.message?.content ?? null;
    }

    // Читаем SSE-поток (Server-Sent Events) общим парсером.
    let fullContent = "";
    await readChatStream(res.body, cfg.idleTimeoutMs, cfg.provider, (delta) => {
      fullContent += delta;
    });
    return fullContent || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) {
      logger.error("lm-studio", "ИИ-сервер: тайм-аут чата", { provider: cfg.provider, timeoutMs });
    } else {
      logger.error("lm-studio", "ИИ-сервер: ошибка чата", { provider: cfg.provider, error: msg });
    }
    throw e; // наверх — там решается, стоит ли переподключиться
  } finally {
    clearTimeout(timer);
  }
}

// Кеш первой модели сервера — чтобы не отправлять произвольное имя модели
// (важно для llama-server с --alias: 404 обрабатывается ретраем выше).
let firstKnownModel: string | null = null;
export function rememberFirstModel(models: string[]): void {
  if (models.length > 0 && !firstKnownModel) firstKnownModel = models[0];
}
function pickModelFromCache(): string | null {
  return firstKnownModel;
}

/**
 * VLM-анализ изображения через локальный сервер (если загружена
 * multimodal-модель: LM Studio (vision) или llama-server с --mmproj).
 * Совместимо с OpenAI Vision API: content = [{type:"text"}, {type:"image_url"}].
 * Использует streaming для поддержки длинных ответов.
 */
export async function lmStudioVision(
  imageDataUrl: string,
  question: string,
): Promise<string | null> {
  const cfg = getLMStudioConfig();
  if (!cfg.enabled) return null;

  const timeoutMs = cfg.timeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const body: Record<string, unknown> = {
    model: cfg.model || pickModelFromCache() || (cfg.provider === "llama-server" ? "" : "local-model"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    temperature: cfg.temperature,
    max_tokens: 1024,
    stream: true,
  };
  if (cfg.provider === "llama-server") {
    body.cache_prompt = true;
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        ...authHeaders(cfg),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.error("lm-studio", "ИИ-сервер: HTTP-ошибка vision", {
        provider: cfg.provider,
        status: res.status,
      });
      return null;
    }
    if (!res.body) {
      const data = (await res.json()) as LMChatCompletionResponse;
      return data.choices?.[0]?.message?.content ?? null;
    }
    let fullContent = "";
    await readChatStream(res.body, cfg.idleTimeoutMs, cfg.provider, (delta) => {
      fullContent += delta;
    });
    return fullContent || null;
  } catch (e) {
    logger.error("lm-studio", "ИИ-сервер: ошибка vision", {
      provider: cfg.provider,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
