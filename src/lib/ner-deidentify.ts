// СППВР — Локальная NER-де-идентификация (ФЗ-152)
// ============================================================================
// ВАЖНО (v2.1): этот модуль НЕ отправляет сырой текст пациента в
// облачный LLM. Вся обработка выполняется ЛОКАЛЬНО на основе расширенного
// набора регулярных выражений из ./deidentify. Это обеспечивает соответствие
// ФЗ-152 ст. 18 ч. 3 (передача ПДн третьим лицам без обезличивания запрещена).
//
// API-поверхность сохранена, чтобы вызывающий код не изменился.
//
// Compliance: ФЗ-152 ст. 18 ч. 3, HIPAA §164.514(b) (Safe Harbor de-id).

import { deidentifyText, containsPHI } from "./deidentify";
import { logger } from "./logger";

export interface NEREntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  replacement: string;
}

export interface NERDeidResult {
  text: string;
  entities: NEREntity[];
  method: "ner_ml" | "regex_fallback";
  processingTimeMs: number;
  model?: string;
}

// Токены замены по типу сущности (русско-английские)
const REPLACEMENT_TOKENS: Record<string, string> = {
  СНИЛС: "[СНИЛС]",
  "Полис ОМС": "[ПОЛИС]",
  Паспорт: "[ПАСПОРТ]",
  ИНН: "[ИНН]",
  Телефон: "[ТЕЛЕФОН]",
  Email: "[EMAIL]",
  "Дата рождения": "[ДАТА_РОЖ]",
  Индекс: "[ИНДЕКС]",
  Адрес: "[АДРЕС]",
  "Номер карты": "[НОМЕР_КАРТЫ]",
  "Номер документа": "[НОМЕР_ДОКУМЕНТА]",
  ФИО: "[ПАЦИЕНТ]",
  "ФИО (кратко)": "[ПАЦИЕНТ]",
  "ФИО врача": "[ВРАЧ]",
};

/**
 * Локальная NER-де-идентификация.
 *
 * Алгоритм:
 *   1. Запускаем расширенный regex-движок из ./deidentify.
 *   2. Вычисляем позиции каждой сущности в исходном тексте (для UI/аудита).
 *   3. Возвращаем результат с method="regex_fallback" (обратно-совместимо
 *      со старым контрактом; "ner_ml" зарезервировано на случай подключения
 *      локальной модели в будущем).
 *
 * Никакие данные не покидают процесс.
 */
export async function nerDeidentify(
  rawText: string,
  _lang: "ru" | "en" = "ru",
): Promise<NERDeidResult> {
  const startTime = Date.now();

  const regexResult = deidentifyText(rawText);

  // Вычисляем позиции сущностей в исходном тексте для аудита/отладки.
  const entities: NEREntity[] = [];
  for (const r of regexResult.replacements) {
    const token = REPLACEMENT_TOKENS[r.type] || r.token;
    // Находим первое вхождение оригинала (упрощённо — для UI достаточно).
    const idx = rawText.indexOf(r.original);
    if (idx >= 0) {
      entities.push({
        type: r.type,
        text: r.original,
        start: idx,
        end: idx + r.original.length,
        confidence: 0.85, // Фиксированная уверённость для regex-метода.
        replacement: token,
      });
    }
  }

  const processingTimeMs = Date.now() - startTime;

  if (entities.length > 0) {
    logger.info("ner-deidentify", "Локальная NER-де-идентификация завершена", {
      entityCount: entities.length,
      processingTimeMs,
      textLength: rawText.length,
      method: "regex_local",
    });
  }

  return {
    text: regexResult.text,
    entities,
    method: "regex_fallback",
    processingTimeMs,
    model: "regex-local-v2",
  };
}

/**
 * Комбинированная де-идентификация: один проход regex (раньше было два —
 * NER + regex fallback). Сохранена для обратной совместимости с вызывающим
 * кодом.
 */
export async function combinedDeidentify(
  rawText: string,
  lang: "ru" | "en" = "ru",
): Promise<
  NERDeidResult & {
    regexReplacements: Array<{
      type: string;
      original: string;
      token: string;
      count: number;
    }>;
  }
> {
  const result = await nerDeidentify(rawText, lang);
  const regexResult = deidentifyText(rawText);

  return {
    ...result,
    text: regexResult.text,
    regexReplacements: regexResult.replacements,
  };
}

/**
 * NER-сервис всегда доступен, т.к. работает локально (без внешних API).
 */
export async function isNERAvailable(): Promise<boolean> {
  return true;
}

/**
 * Быстрая проверка наличия PHI в тексте (для UI-индикаторов).
 */
export function textContainsPHI(text: string): boolean {
  return containsPHI(text);
}
