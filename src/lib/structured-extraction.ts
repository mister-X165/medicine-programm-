// СППВР — надёжная структуризация заключения ИИ
// ============================================================================
// Раньше структурированные данные (диф. диагноз, план обследования, терапия,
// мониторинг) извлекались ЭВРИСТИЧЕСКИМ разбором свободного текста модели
// (regex-парсеры в analyze/route.ts). Это было хрупко: малейшее отклонение
// модели от формата давало пустые/неверные поля — источник «некорректных
// рекомендаций».
//
// Теперь финальный текст заключения прогоняется через ОТДЕЛЬНЫЙ JSON-проход:
// модель-структуризатор читает готовый текст и возвращает строгий JSON,
// который валидируется zod и нормализуется к типам AnalysisStructured.
// При неудаче вызывающий код откатывается на прежний эвристический разбор.

import { llmChat, parseJSON } from "./ai-service";
import { logger } from "./logger";
import { aiStructuredSchema } from "./validation";
import type {
  AnalysisStructured,
  DifferentialDiagnosis,
  MonitoringMarker,
  TherapyOption,
  WorkupItem,
} from "./types";

// ---------------------------------------------------------------------------
// Промпт структуризатора
// ---------------------------------------------------------------------------

const STRUCTURING_SYSTEM = `Ты — модуль структурирования клинического заключения СППВР. Тебе дан ГОТОВЫЙ текст врачебного заключения (разделы «ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ», «НЕОБХОДИМОЕ ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ», «ТЕРАПЕВТИЧЕСКИЕ ОПЦИИ ПОСЛЕ ПОДТВЕРЖДЕНИЯ ДИАГНОЗА», «МАРКЕРЫ И МОНИТОРИНГ»). Преобразуй его в JSON строго следующей структуры:

{
  "differential": [
    {
      "diagnosis": "название гипотезы",
      "icd10": "код МКБ-10 (например E11.9)",
      "probability": 0.65,
      "argumentsFor": ["аргумент за (факт из данных)"],
      "argumentsAgainst": ["аргумент против"],
      "workup": ["обследование для подтверждения"],
      "redFlags": ["красный флаг"],
      "notes": "чем различить / тактика различения"
    }
  ],
  "workupPlan": [
    {
      "name": "название обследования",
      "priority": "urgent | high | routine",
      "purpose": "зачем (одна строка)",
      "targetDxConfirm": ["гипотеза, которую подтверждает при позитивном результате"],
      "targetDxRefute": ["гипотеза, которую исключает"],
      "expectedResult": "ожидаемый результат при целевой гипотезе",
      "normalRange": "норма / референсный диапазон",
      "confirmsIf": "подтверждает гипотезу, если",
      "refutesIf": "исключает гипотезу, если",
      "interpretation": "развёрнутое руководство по интерпретации результата",
      "timing": "срок/условия выполнения (напр. «в течение 1 часа», «натощак утром»)",
      "preparation": "подготовка к исследованию, если указана"
    }
  ],
  "therapyOptions": [
    {
      "name": "МНН препарата",
      "regimen": "доза, путь введения, кратность, длительность",
      "evidenceLevel": "A | B | C",
      "source": "источник (КР Минздрава РФ код / NICE / ESC / WHO ...)",
      "justification": "механизм действия и обоснование выбора",
      "targetDx": "для какой подтверждённой гипотезы",
      "caution": "предупреждения / какие обследования выполнить ДО старта терапии"
    }
  ],
  "monitoringPlan": [
    { "marker": "маркер или показатель", "frequency": "частота контроля", "target": "целевое значение", "purpose": "зачем контролировать" }
  ]
}

ЖЁСТКИЕ ПРАВИЛА:
1. Верни ТОЛЬКО валидный JSON, без markdown-обёртки и пояснений до/после.
2. Гипотез — ровно столько, сколько в тексте (3–5), НЕ выдумывай новые и не теряй существующие.
3. probability — число от 0 до 1 (65% → 0.65). Если в тексте проценты — подели на 100.
4. Обследований — все из текста, по ОДНОМУ на элемент, с полной «interpretation», если она есть в тексте.
5. Бери факты ТОЛЬКО из текста заключения. Если поля нет в тексте — не заполняй его.
6. Язык — русский.`;

const MAX_TOKENS = 5120;
const MAX_INPUT_CHARS = 16000;

// ---------------------------------------------------------------------------
// Нормализация
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function toProbability(v: number | string | undefined, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return clamp01(v > 1 ? v / 100 : v);
  }
  if (typeof v === "string") {
    const n = parseFloat(v.replace("%", "").replace(",", ".").trim());
    if (Number.isFinite(n)) return clamp01(n > 1 ? n / 100 : n);
  }
  return fallback;
}

function cleanStr(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function cleanArr(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeStructured(data: {
  differential: Array<Record<string, unknown>>;
  workupPlan: Array<Record<string, unknown>>;
  therapyOptions: Array<Record<string, unknown>>;
  monitoringPlan: Array<Record<string, unknown>>;
}): Partial<AnalysisStructured> {
  const differential: DifferentialDiagnosis[] = data.differential
    .map((d, i) => ({
      rank: i + 1,
      diagnosis: cleanStr(d.diagnosis),
      icd10: cleanStr(d.icd10) || undefined,
      probability: toProbability(
        d.probability as number | string | undefined,
        Math.max(0.1, 0.5 - i * 0.1),
      ),
      argumentsFor: cleanArr(d.argumentsFor),
      argumentsAgainst: cleanArr(d.argumentsAgainst),
      workup: cleanArr(d.workup),
      redFlags: cleanArr(d.redFlags),
      notes: cleanStr(d.notes) || undefined,
      sources: cleanArr(d.sources),
    }))
    .filter((d) => d.diagnosis.length > 0);

  const workupPlan: WorkupItem[] = data.workupPlan
    .map((w) => {
      const targetDxConfirm = cleanArr(w.targetDxConfirm);
      const targetDxRefute = cleanArr(w.targetDxRefute);
      return {
        name: cleanStr(w.name),
        priority: (w.priority === "urgent" || w.priority === "high" ? w.priority : "routine") as WorkupItem["priority"],
        purpose: cleanStr(w.purpose) || undefined,
        targetDxConfirm: targetDxConfirm.length ? targetDxConfirm : undefined,
        targetDxRefute: targetDxRefute.length ? targetDxRefute : undefined,
        expectedResult: cleanStr(w.expectedResult) || undefined,
        normalRange: cleanStr(w.normalRange) || undefined,
        cutoffs: cleanStr(w.cutoffs) || undefined,
        confirmsIf: cleanStr(w.confirmsIf) || undefined,
        refutesIf: cleanStr(w.refutesIf) || undefined,
        interpretation: cleanStr(w.interpretation) || undefined,
        timing: cleanStr(w.timing) || undefined,
        preparation: cleanStr(w.preparation) || undefined,
      };
    })
    .filter((w) => w.name.length > 0);

  const therapyOptions: TherapyOption[] = data.therapyOptions
    .map((t) => ({
      name: cleanStr(t.name),
      regimen: cleanStr(t.regimen) || undefined,
      evidenceLevel: cleanStr(t.evidenceLevel) || undefined,
      source: cleanStr(t.source) || undefined,
      justification: cleanStr(t.justification) || undefined,
      targetDx: cleanStr(t.targetDx) || undefined,
      caution: cleanStr(t.caution) || undefined,
    }))
    .filter((t) => t.name.length > 0);

  const monitoringPlan: MonitoringMarker[] = data.monitoringPlan
    .map((m) => ({
      marker: cleanStr(m.marker),
      frequency: cleanStr(m.frequency) || undefined,
      target: cleanStr(m.target) || undefined,
      purpose: cleanStr(m.purpose) || undefined,
    }))
    .filter((m) => m.marker.length > 0);

  return { differential, workupPlan, therapyOptions, monitoringPlan };
}

// ---------------------------------------------------------------------------
// Публичный API
// ---------------------------------------------------------------------------

/**
 * Извлекает структурированные данные из финального текста заключения через
 * отдельный JSON-проход LLM. Возвращает null при неудаче (тогда вызывающий
 * код откатывается на эвристический разбор).
 */
export async function extractStructuredJson(
  finalText: string,
): Promise<Partial<AnalysisStructured> | null> {
  if (!finalText || finalText.trim().length < 50) return null;

  try {
    const user = `ТЕКСТ ЗАКЛЮЧЕНИЯ:\n${finalText.slice(0, MAX_INPUT_CHARS)}`;
    const raw = await llmChat(STRUCTURING_SYSTEM, user, {
      json: true,
      temperature: 0.1,
      maxTokens: MAX_TOKENS,
    });
    if (!raw) return null;

    const parsed = parseJSON<unknown>(raw);
    if (!parsed || typeof parsed !== "object") {
      logger.warn("structured-extraction", "Структуризатор вернул не-JSON", {
        preview: raw.slice(0, 140),
      });
      return null;
    }

    const result = aiStructuredSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn("structured-extraction", "JSON не прошёл валидацию", {
        issues: result.error.issues.slice(0, 5).map((i) => i.message),
      });
      return null;
    }

    return normalizeStructured(
      result.data as {
        differential: Array<Record<string, unknown>>;
        workupPlan: Array<Record<string, unknown>>;
        therapyOptions: Array<Record<string, unknown>>;
        monitoringPlan: Array<Record<string, unknown>>;
      },
    );
  } catch (e) {
    logger.warn("structured-extraction", "Ошибка структуризации", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
