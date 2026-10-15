// СППВР v5.1 — слой ИИ-инференса с graceful degradation (ТЗ п. 4.1, 5.1, 5.3)
// Приоритет провайдеров:
//   1. Локальный OpenAI-compatible сервер (AI_PROVIDER):
//        • llama-server (llama.cpp) — AI_PROVIDER=llama-server, порт 8080
//        • LM Studio — AI_PROVIDER=lm-studio, порт 1234
//   2. Ручной режим — если сервер недоступен (ТЗ 5.3)
//
// Все вычисления выполняются локально (ФЗ-152 ст. 18 ч. 3): данные пациента
// не покидают рабочую станцию. Облачные провайдеры не используются.
//
// v5.1: поддержка llama-server (llama.cpp) наряду с LM Studio; параметры
// retry/temperature/maxTokens — из ENV (AI_* с фолбэком LM_STUDIO_*);
// health-проверка кешируется (см. lm-studio.ts).

import { logger } from "@/lib/logger";
import {
  getLMStudioConfig,
  getAIProvider,
  providerLabel,
  lmStudioChat,
  lmStudioVision,
  checkLMStudioHealth,
  invalidateLMHealthCache,
  rememberFirstModel,
} from "./lm-studio";

export type AIProvider = "llama-server" | "lm-studio" | "none";

/**
 * Какой провайдер ИИ сейчас активен.
 *   "llama-server" — llama.cpp llama-server включён и отвечает
 *   "lm-studio"    — LM Studio включён и отвечает
 *   "none"         — ИИ-сервер недоступен (ручной режим)
 */
export async function getActiveProvider(): Promise<AIProvider> {
  const cfg = getLMStudioConfig();
  if (cfg.enabled) {
    const health = await checkLMStudioHealth(); // кешируется на 15 с
    if (health.ok) {
      if (health.models) rememberFirstModel(health.models);
      return cfg.provider;
    }
  }
  return "none";
}

/**
 * Комплексная проверка ИИ-ядра: llama-server/LM Studio → none.
 * Для health-check возвращает статус и метаданные провайдера.
 * Поля lmStudioOk/lmStudioError сохранены для совместимости формы ответа
 * (теперь означают «провайдер доступен/ошибка»).
 */
export async function checkAIHealth(): Promise<{
  ok: boolean;
  error?: string;
  provider?: AIProvider;
  lmStudioOk?: boolean;
  lmStudioError?: string;
  model?: string;
}> {
  const cfg = getLMStudioConfig();
  const label = providerLabel(cfg.provider);
  let providerOk = false;
  let providerError: string | undefined;
  if (cfg.enabled) {
    const lmHealth = await checkLMStudioHealth();
    providerOk = lmHealth.ok;
    providerError = lmHealth.error;
    if (providerOk) {
      return {
        ok: true,
        provider: cfg.provider,
        lmStudioOk: true,
        model: cfg.model || lmHealth.models?.[0],
      };
    }
  }

  // Провайдер недоступен
  const parts: string[] = [];
  if (!cfg.enabled) {
    parts.push(`ИИ-сервер (${label}) отключён в конфигурации (AI_ENABLED=false)`);
  } else if (providerError) {
    parts.push(`${label}: ${providerError}`);
  } else {
    parts.push(
      cfg.provider === "llama-server"
        ? "llama-server не настроен (LLAMA_SERVER_URL не указан) — проверьте, что llama-server запущен"
        : "LM Studio не настроен (LM_STUDIO_URL не указан)",
    );
  }
  return {
    ok: false,
    error: parts.join(" | "),
    provider: "none",
    lmStudioOk: providerOk,
    lmStudioError: providerError,
  };
}

/**
 * LLM-запрос для текстового анализа (NER, заключения, RAG).
 * Приоритет: llama-server/LM Studio → null (ручной режим).
 *
 * options.maxTokens позволяет увеличить лимит выходных токенов для длинных
 * заключений. Это критично для небольших моделей (напр. gemma-3-4b), которые
 * при дефолтном лимите обрывают ответ на середине JSON.
 *
 * RETRY-логика (ENV: AI_MAX_RETRIES / AI_RETRY_BASE_DELAY_MS):
 * при пустом/коротком/оборванном ответе запрос повторяется. Сетевые сбои
 * (сброс сокета) внутри lmStudioChat дополнительно гасятся немедленным
 * переподключением.
 */
export async function llmChat(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; temperature?: number; maxTokens?: number },
): Promise<string | null> {
  const cfg = getLMStudioConfig();
  const label = providerLabel(getAIProvider());

  // ИИ-сервер (единственный провайдер) с retry
  if (!cfg.enabled) {
    logger.warn("ai", `LLM запрос невозможен: ${label} отключён (AI_ENABLED=false)`);
    return null;
  }

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    let result: string | null = null;
    try {
      result = await lmStudioChat(systemPrompt, userMessage, options);
    } catch (e) {
      logger.warn("ai", `${label}: сетевая ошибка попытки`, {
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
      invalidateLMHealthCache();
    }
    if (result && result.trim().length > 0) {
      // Проверка минимальной полноты ответа — для JSON хотя бы 20 символов,
      // для plain-text хотя бы 50 (чтобы отсечь обрывы на "тера...")
      const minLen = options?.json ? 20 : 50;
      if (result.trim().length >= minLen) {
        return result;
      }
      logger.warn("ai", `${label}: короткий ответ, retry`, {
        attempt,
        length: result.length,
      });
    } else {
      logger.warn("ai", `${label}: пустой ответ, retry`, { attempt });
    }
    if (attempt < cfg.maxRetries) {
      // Экспоненциальная задержка: base, base*3, base*9... (ENV-настраиваемая)
      const delayMs = cfg.retryBaseDelayMs * Math.pow(3, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  // ИИ-сервер не дал валидного ответа после retry — ручной режим
  logger.warn("ai", `${label}: retry исчерпан, возврат в ручной режим`);
  return null;
}

/**
 * VLM-анализ изображения (медицинские снимки). ТЗ п. 3.2.
 * Использует локальный сервер с загруженной multimodal-моделью
 * (LM Studio vision или llama-server с --mmproj).
 * Возвращает null, если сервер недоступен или не имеет vision-модели.
 */
export async function vlmAnalyzeImage(
  imageDataUrl: string,
  question: string,
): Promise<string | null> {
  const cfg = getLMStudioConfig();
  if (cfg.enabled) {
    const result = await lmStudioVision(imageDataUrl, question);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Безопасный парсинг JSON-ответа LLM (с очисткой от markdown).
 */
export function parseJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  // Удаление markdown-обёртки ```json ... ```
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Попытка найти первый { ... } или [ ... ]
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as T;
      } catch {}
    }
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]) as T;
      } catch {}
    }
    return null;
  }
}
