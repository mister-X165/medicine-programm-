// СППВР — учёт выполнения плана дообследования (клинический трекер)
// ============================================================================
// Раньше отметка «выполнено» по плану дообследования хранилась только в
// localStorage браузера и терялась при смене рабочего места, а результат
// исследования врач сопоставлял с референсами вручную по памяти. Для
// клинической эксплуатации это неприемлемо: назначение и его результат —
// часть медицинской документации, они должны переживать перезагрузку,
// фиксироваться за конкретным врачом и попадать в аудит.
//
// Здесь — чистые функции без побочных эффектов:
//   • стабильный ключ исследования (переживает повторный анализ, т.к.
//     считается от нормализованного названия, а не от индекса в массиве);
//   • разбор референсного диапазона и сравнение с ним введённого результата
//     (детерминированно, без ИИ — источник «подсказки» для врача);
//   • сводка прогресса выполнения плана;
//   • текстовый экспорт плана (вставка в карту/направление).
// ============================================================================

import type {
  WorkupItem,
  WorkupStatus,
  WorkupTracker,
  WorkupTrackerEntry,
} from "./types";

/** Порядок статусов в меню трекера (от «в плане» до «не выполнено»). */
export const WORKUP_STATUSES: WorkupStatus[] = [
  "planned",
  "ordered",
  "completed",
  "resulted",
  "cancelled",
];

export interface WorkupStatusMeta {
  /** Полная подпись для меню/бейджа. */
  label: string;
  /** Короткая подпись для компактной таблицы. */
  short: string;
  /** Классы бейджа (border+bg+text). */
  badgeCls: string;
  /** Класс точки-индикатора. */
  dotCls: string;
  /** Считается ли статус «закрытым» (исследование выполнено). */
  done: boolean;
}

export const WORKUP_STATUS_META: Record<WorkupStatus, WorkupStatusMeta> = {
  planned: {
    label: "В плане",
    short: "план",
    badgeCls: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    dotCls: "bg-slate-400",
    done: false,
  },
  ordered: {
    label: "Назначено",
    short: "назначено",
    badgeCls: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dotCls: "bg-sky-500",
    done: false,
  },
  completed: {
    label: "Выполнено",
    short: "выполнено",
    badgeCls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dotCls: "bg-emerald-500",
    done: true,
  },
  resulted: {
    label: "Результат получен",
    short: "результат",
    badgeCls: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    dotCls: "bg-teal-600",
    done: true,
  },
  cancelled: {
    label: "Не выполнено",
    short: "не выполнено",
    badgeCls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dotCls: "bg-rose-500",
    done: false,
  },
};

/** Метаданные статуса с безопасным fallback (данные могли прийти из старой версии). */
export function workupStatusMeta(status?: string): WorkupStatusMeta {
  const key = (status ?? "planned") as WorkupStatus;
  return WORKUP_STATUS_META[key] ?? WORKUP_STATUS_META.planned;
}

/**
 * Нормализованный ключ исследования.
 *
 * Считается от НАЗВАНИЯ, поэтому трекер переживает повторный анализ: новая
 * версия заключения даёт те же названия — те же ключи. Регистр, кавычки,
 * дефисы, «ё» и лишние пробелы не влияют.
 */
export function normalizeWorkupKey(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[^a-zа-я0-9.%]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 90);
}

/** Ключ элемента плана для трекера. `index` — только запасной вариант. */
export function workupKey(item: WorkupItem, index = 0): string {
  const key = normalizeWorkupKey(item.name);
  return key.length > 0 ? key : `item-${index}`;
}

export interface ParsedRange {
  min?: number;
  max?: number;
  unit?: string;
  raw: string;
}

const NUM = String.raw`(-?\d+(?:[.,]\d+)?)`;

function toNum(s: string): number {
  return parseFloat(s.replace(",", "."));
}

/**
 * Разбор референсного диапазона из свободного текста ИИ.
 *
 * Поддерживаются формы, которые реально встречаются в заключениях:
 *   «0,0–0,04 нг/мл», «3.5 - 5.5», «до 5 ммоль/л», «не более 30»,
 *   «≥ 40», «> 10», «5–10 ×10^9/л». Для составных строк берётся ПЕРВЫЙ
 * диапазон («норма 0–0.04; серая зона 0.04–0.4» → 0–0.04).
 */
export function parseReferenceRange(text?: string): ParsedRange | null {
  if (!text) return null;
  const src = text.replace(/\u00a0/g, " ").trim();
  if (!src) return null;

  const unitMatch = src.match(
    /(нг\/мл|мкг\/л|мг\/л|г\/л|ммоль\/л|мкмоль\/л|пмоль\/л|мЕд\/л|МЕ\/л|Ед\/л|%|мм\s?рт\.?\s?ст\.?|уд\/мин|×10\^?\d+\/?л|10\^\d+\/л)/i,
  );
  const unit = unitMatch?.[1];

  // Диапазон: 0,0–0,04 (тире любого вида либо слово «до»).
  const range = src.match(
    new RegExp(`${NUM}\\s*(?:[–—−-]|\\sдо\\s)\\s*${NUM}`, "i"),
  );
  if (range) {
    const a = toNum(range[1]);
    const b = toNum(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { min: Math.min(a, b), max: Math.max(a, b), unit, raw: src };
    }
  }

  const upper = src.match(
    new RegExp(`(?:до|менее|не\\s+более|не\\s+выше|≤|<)\\s*${NUM}`, "i"),
  );
  if (upper) {
    const max = toNum(upper[1]);
    if (Number.isFinite(max)) return { max, unit, raw: src };
  }

  const lower = src.match(
    new RegExp(`(?:более|не\\s+менее|не\\s+ниже|≥|>)\\s*${NUM}`, "i"),
  );
  if (lower) {
    const min = toNum(lower[1]);
    if (Number.isFinite(min)) return { min, unit, raw: src };
  }

  return null;
}

export type RangeVerdict = "below" | "within" | "above" | "unknown";

export interface RangeComparison {
  verdict: RangeVerdict;
  /** Числовое значение, извлечённое из введённого результата. */
  value?: number;
  /** Разобранный референс (null, если разобрать не удалось). */
  range: ParsedRange | null;
  /** Человекочитаемая подпись сравнения — для подсказки врачу. */
  label: string;
}

/**
 * Сравнение введённого врачом результата с референсным диапазоном.
 *
 * ВАЖНО: это арифметическая подсказка («0.12 выше нормы 0–0.04»), а НЕ
 * клиническое заключение. Интерпретацию (подтверждает/исключает гипотезу)
 * даёт только врач — поэтому в UI рядом всегда показывается критерий ИИ.
 */
export function compareValueToRange(
  value: string | undefined,
  rangeText: string | undefined,
): RangeComparison {
  const range = parseReferenceRange(rangeText);
  const cleaned = (value ?? "").replace(/\u00a0/g, " ").trim();
  if (!cleaned) {
    return { verdict: "unknown", range, label: "результат не введён" };
  }
  const numMatch = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  if (!numMatch) {
    return { verdict: "unknown", range, label: "числовое значение не распознано" };
  }
  const num = toNum(numMatch[0]);
  if (!Number.isFinite(num)) {
    return { verdict: "unknown", range, label: "числовое значение не распознано" };
  }
  if (!range) {
    return {
      verdict: "unknown",
      value: num,
      range: null,
      label: "референс не распознан — сверьте с критерием",
    };
  }
  const unit = range.unit ? ` ${range.unit}` : "";
  if (range.min !== undefined && num < range.min) {
    return {
      verdict: "below",
      value: num,
      range,
      label: `ниже нормы (норма от ${range.min}${unit})`,
    };
  }
  if (range.max !== undefined && num > range.max) {
    return {
      verdict: "above",
      value: num,
      range,
      label: `выше нормы (норма до ${range.max}${unit})`,
    };
  }
  const bounds =
    range.min !== undefined && range.max !== undefined
      ? `${range.min}–${range.max}${unit}`
      : range.min !== undefined
        ? `≥ ${range.min}${unit}`
        : `≤ ${range.max}${unit}`;
  return { verdict: "within", value: num, range, label: `в пределах нормы (${bounds})` };
}

/** Запись трекера по элементу плана (или null, если ещё не трогали). */
export function trackerEntryFor(
  tracker: WorkupTracker | undefined,
  item: WorkupItem,
  index = 0,
): WorkupTrackerEntry | null {
  if (!tracker) return null;
  const key = workupKey(item, index);
  return tracker[key] ?? null;
}

export interface WorkupProgress {
  total: number;
  /** Выполнено + результат получен. */
  done: number;
  /** Назначено (ещё не выполнено). */
  ordered: number;
  /** Есть результат. */
  withResult: number;
  /** Отменено/не выполнено. */
  cancelled: number;
  /** Процент закрытых пунктов, 0..100. */
  pct: number;
}

export function workupProgress(
  items: WorkupItem[],
  tracker?: WorkupTracker,
): WorkupProgress {
  let done = 0;
  let ordered = 0;
  let withResult = 0;
  let cancelled = 0;
  items.forEach((item, i) => {
    const entry = trackerEntryFor(tracker, item, i);
    const status = (entry?.status ?? "planned") as WorkupStatus;
    if (status === "completed" || status === "resulted") done += 1;
    if (status === "ordered") ordered += 1;
    if (status === "cancelled") cancelled += 1;
    if (entry?.resultValue && entry.resultValue.trim().length > 0) withResult += 1;
  });
  const total = items.length;
  return {
    total,
    done,
    ordered,
    withResult,
    cancelled,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

const PRIORITY_ORDER: Record<WorkupItem["priority"], number> = {
  urgent: 0,
  high: 1,
  routine: 2,
};

/** Сортировка: сначала по приоритету, затем по исходному порядку (стабильно). */
export function sortWorkupByPriority(items: WorkupItem[]): WorkupItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.item.priority ?? "routine"] ?? 2;
      const pb = PRIORITY_ORDER[b.item.priority ?? "routine"] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

export interface PlanExportOptions {
  /** Подпись версии анализа (например, «v3»). */
  versionLabel?: string;
  /** Код случая для шапки. */
  caseCode?: string;
  /** Включать развёрнутые подсказки по интерпретации. */
  includeHints?: boolean;
}

const PRIORITY_LABEL: Record<WorkupItem["priority"], string> = {
  urgent: "СРОЧНО",
  high: "ВЫСОКИЙ ПРИОРИТЕТ",
  routine: "плановое",
};

/**
 * Текстовый план дообследования для вставки в карту/направление.
 * Ничего не додумывает: только то, что уже есть в плане и в трекере.
 */
export function planToText(
  items: WorkupItem[],
  tracker?: WorkupTracker,
  opts: PlanExportOptions = {},
): string {
  if (items.length === 0) return "";
  const lines: string[] = [];
  const head = ["ПЛАН ДООБСЛЕДОВАНИЯ"];
  if (opts.caseCode) head.push(opts.caseCode);
  if (opts.versionLabel) head.push(opts.versionLabel);
  lines.push(head.join(" · "));
  lines.push("");

  sortWorkupByPriority(items).forEach((item, i) => {
    const originalIndex = items.indexOf(item);
    const entry = trackerEntryFor(tracker, item, originalIndex < 0 ? i : originalIndex);
    const status = workupStatusMeta(entry?.status);
    const parts = [`${i + 1}. [${PRIORITY_LABEL[item.priority ?? "routine"]}] ${item.name}`];
    if (item.timing) parts.push(`срок: ${item.timing}`);
    if (status.short !== "план") parts.push(`статус: ${status.label.toLowerCase()}`);
    if (entry?.resultValue) {
      const cmp = compareValueToRange(entry.resultValue, item.normalRange ?? item.cutoffs);
      parts.push(`результат: ${entry.resultValue}${cmp.verdict === "unknown" ? "" : ` (${cmp.label})`}`);
    }
    lines.push(parts.join(" — "));

    if (item.purpose) lines.push(`   Зачем: ${item.purpose}`);
    const confirm = item.targetDxConfirm?.length ? item.targetDxConfirm.join(", ") : item.targetDx;
    if (confirm) lines.push(`   Подтверждает: ${confirm}`);
    if (item.targetDxRefute?.length) lines.push(`   Исключает: ${item.targetDxRefute.join(", ")}`);
    if (opts.includeHints) {
      const norm = item.normalRange ?? item.cutoffs;
      if (norm) lines.push(`   Норма/пороги: ${norm}`);
      if (item.confirmsIf) lines.push(`   Подтверждает, если: ${item.confirmsIf}`);
      if (item.refutesIf) lines.push(`   Исключает, если: ${item.refutesIf}`);
      if (item.interpretation) lines.push(`   Интерпретация: ${item.interpretation}`);
    }
    if (entry?.comment) lines.push(`   Комментарий врача: ${entry.comment}`);
  });

  return lines.join("\n");
}
