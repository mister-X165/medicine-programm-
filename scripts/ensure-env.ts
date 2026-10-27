// СППВР v5.1 — fail-safe .env recovery (Task: container recreate resilience)
// ============================================================================
// The sandbox container may be recreated with a default .env containing only
// DATABASE_URL. Server-side secrets (JWT_SECRET, ENCRYPTION_KEY) then go
// missing and every API route fails with 503 "Server misconfigured".
//
// This script runs BEFORE `next dev` (see package.json "dev" script):
//   • preserves existing valid secrets untouched;
//   • generates fresh 256-bit hex secrets for anything missing;
//   • v5.1: RESTORES missing AI-provider / network / RAG settings (llama-server
//     block etc.) with documented defaults — USER-EDITED VALUES ARE NEVER
//     OVERWRITTEN (only keys fully absent from .env are appended);
//   • never weakens validation in src/lib/env.ts (>= 64 chars, blacklist);
//   • prints a clear report to stdout.
//
// NOTE on data impact: E2EE patient data (enc:v1:) is encrypted client-side
// with the doctor's DEK — it does NOT depend on these server secrets and
// survives rotation. Only previously created encrypted backups become
// undecryptable after ENCRYPTION_KEY rotation (accepted trade-off, documented
// in worklog).
// ============================================================================

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ENV_PATH = new URL("../.env", import.meta.url).pathname;
const REQUIRED: Array<{ key: string; hint: string }> = [
  { key: "JWT_SECRET", hint: "auth session tokens" },
  { key: "ENCRYPTION_KEY", hint: "server-side storage/backup encryption" },
];

/**
 * v5.1: настройки внешних подключений, которые должны существовать в .env.
 * Если ключ ОТСУТСТВУЕТ (например, .env сброшен при пересоздании контейнера),
 * он дописывается со значением по умолчанию. Существующие значения
 * (включая пустые, типа LLAMA_SERVER_MODEL=) НЕ перезаписываются.
 */
const ENSURE_DEFAULTS: Array<[key: string, value: string, comment: string]> = [
  // --- ИИ-провайдер (llama.cpp llama-server) ---
  ["AI_PROVIDER", "llama-server", "Провайдер ИИ: llama-server (llama.cpp) | lm-studio"],
  ["LLAMA_SERVER_URL", "http://127.0.0.1:8080/v1", "URL llama-server (дефолт llama.cpp: порт 8080)"],
  ["LLAMA_SERVER_MODEL", "", "Модель llama-server (пусто = первая с сервера)"],
  ["LLAMA_SERVER_API_KEY", "", "API-ключ llama-server (нужен при --api-key)"],
  // --- LM Studio (альтернативный провайдер) ---
  ["LM_STUDIO_ENABLED", "true", "LM Studio включён (альтернативный провайдер)"],
  ["LM_STUDIO_URL", "http://127.0.0.1:1234/v1", "URL LM Studio (дефолт: порт 1234)"],
  // --- Общие параметры ИИ (AI_* имеют приоритет над LM_STUDIO_*) ---
  ["LM_STUDIO_TIMEOUT_MS", "600000", "Тайм-аут LLM-запроса (CPU-модель на 8K токенов: 5-8 мин)"],
  ["LM_STUDIO_IDLE_TIMEOUT_MS", "180000", "Idle-тайм-аут streaming-ответа"],
  ["LM_STUDIO_MAX_RETRIES", "2", "Повторы при пустом/оборванном ответе"],
  ["LM_STUDIO_RETRY_BASE_DELAY_MS", "1000", "Базовая задержка между повторами"],
  ["LM_STUDIO_TEMPERATURE", "0.2", "Температура генерации по умолчанию"],
  ["LM_STUDIO_MAX_TOKENS", "8192", "Лимит выходных токенов по умолчанию"],
  ["LM_STUDIO_HEALTH_TIMEOUT_MS", "3000", "Тайм-аут health-проверки (/models, llama-server: фолбэк /health)"],
  ["LM_STUDIO_HEALTH_CACHE_MS", "15000", "Кеш health-проверки"],
  ["LM_STUDIO_EXTRA_ALLOWED_HOSTS", "", "Доп. хосты ИИ-сервера помимо localhost (SSRF-защита)"],
  // --- Сеть / Network Health ---
  ["NETWORK_PROBE_INTERVAL_MS", "60000", "Интервал фонового зонда сети"],
  ["NETWORK_PROBE_TIMEOUT_MS", "8000", "Тайм-аут одного зонда сети"],
  ["NETWORK_OFFLINE_AFTER_FAILURES", "2", "Офлайн после N подряд неудачных циклов (гистерезис)"],
  ["NETWORK_CIRCUIT_FAILURE_THRESHOLD", "4", "Порог сбоев хоста для circuit breaker"],
  ["NETWORK_CIRCUIT_COOLDOWN_MS", "30000", "Охлаждение разомкнутой цепи хоста"],
  // --- ИИ-конвейер (анализ кейсов) ---
  ["AI_DEEP_ANALYSIS", "true", "Глубокий анализ: черновик -> самопроверка ИИ"],
  ["AI_SELF_VERIFY_PASSES", "1", "Число проходов самопроверки"],
  ["AI_TEMPERATURE_ANALYSIS", "0.2", "Температура заключения анализа"],
  ["AI_MAX_TOKENS_ANALYSIS", "8192", "Лимит токенов заключения анализа"],
  // --- Международные источники (web RAG) ---
  ["INTL_RAG_ENABLED", "true", "PubMed/ВОЗ/NICE/Cochrane/CDC/ESC в дополнение к КР Минздрава"],
  ["INTL_RAG_MAX_RESULTS", "6", "Максимум результатов международных источников"],
  ["INTL_RAG_TIMEOUT_MS", "12000", "Тайм-аут загрузки внешней страницы"],
];

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function generateSecret(): string {
  // 64 hex chars = 256 bit entropy; meets MIN_SECRET_LENGTH (64) in env.ts.
  return randomBytes(32).toString("hex");
}

export function main(): void {
  if (!existsSync(ENV_PATH)) {
    // Portable relative path (resolved against prisma/schema.prisma → <root>/db)
    writeFileSync(ENV_PATH, "DATABASE_URL=file:../db/custom.db\n");
  }

  let raw = readFileSync(ENV_PATH, "utf8");
  let parsed = parseEnv(raw);
  const missing = REQUIRED.filter((r) => !parsed[r.key] || parsed[r.key].length < 64);
  const weak = missing.filter((r) => parsed[r.key] && parsed[r.key]!.length < 64);

  if (missing.length > 0) {
    for (const { key, hint } of missing) {
      const value = generateSecret();
      if (weak.some((w) => w.key === key)) {
        // Replace the weak line in-place instead of appending a duplicate key.
        const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
        raw = raw.replace(re, `${key}=${value}`);
        writeFileSync(ENV_PATH, raw);
        console.log(`[ensure-env] rotated weak ${key} (${hint}) → fresh 256-bit secret`);
      } else {
        const prefix = raw.endsWith("\n") || raw.length === 0 ? "" : "\n";
        raw += `${prefix}${key}=${value}\n`;
        writeFileSync(ENV_PATH, raw);
        console.log(`[ensure-env] generated ${key} (${hint}) → fresh 256-bit secret`);
      }
    }
    parsed = parseEnv(raw);
  } else {
    console.log("[ensure-env] all required secrets present — nothing to do");
  }

  // v5.1: восстановление настроек подключений (ИИ-провайдер, сеть, RAG).
  // Только ОТСУТСТВУЮЩИЕ ключи — существующие значения не трогаем.
  const missingSettings = ENSURE_DEFAULTS.filter(([key]) => !(key in parsed));
  if (missingSettings.length > 0) {
    const prefix = raw.endsWith("\n") ? "" : "\n";
    const block =
      `${prefix}\n# === Автовосстановление ensure-env: отсутствовавшие настройки подключений ===\n` +
      missingSettings
        .map(([key, value, comment]) => `# ${comment}\n${key}=${value}`)
        .join("\n") +
      "\n";
    appendFileSync(ENV_PATH, block);
    for (const [key] of missingSettings) {
      console.log(`[ensure-env] restored missing setting ${key} → default`);
    }
    console.log("[ensure-env] connection settings restored (user values preserved)");
  }

  console.log("[ensure-env] .env is now valid");
}

main();
