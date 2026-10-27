// СППВР — нормализация структурированного заключения ИИ перед сохранением
// ============================================================================
// Даже после JSON-прохода модель отдаёт структуру с дефектами, которые ломают
// клинический workflow:
//   • один и тот же тест дважды («СРБ» и «СРБ, количественно») — врач видит
//     два направления на одно исследование;
//   • целевой диагноз терапии написан иначе, чем гипотеза («пневмония» против
//     «Внебольничная пневмония, средней тяжести») — карточка терапии не
//     разблокируется подтверждением диагноза;
//   • ранги гипотез идут 1, 1, 3 или отсутствуют;
//   • вероятность 65 вместо 0.65.
//
// Все исправления детерминированные, перечисляются в `normalizationFixes` и
// показываются врачу: система не правит клинический смысл молча.
// ============================================================================

import type {
  AnalysisStructured,
  DifferentialDiagnosis,
  TherapyOption,
  WorkupItem,
  WorkupStatus,
  WorkupTracker,
  WorkupTrackerEntry,
} from "./types";
import {
  areWorkupNamesDuplicates,
} from "./clinical-audit";
import { normalizeWorkupKey } from "./workup";

const PRIORITY_RANK: Record<WorkupItem["priority"], number> = {
  urgent: 0,
  high: 1,
  routine: 2,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function fixProbability(p: unknown): { value: number; fixed: boolean } {
  if (typeof p === "number" && Number.isFinite(p)) {
    if (p > 1 && p <= 100) return { value: clamp01(p / 100), fixed: true };
    if (p < 0 || p > 100) return { value: clamp01(p), fixed: true };
    return { value: p, fixed: false };
  }
  if (typeof p === "string") {
    const n = parseFloat(p.replace("%", "").replace(",", ".").trim());
    if (Number.isFinite(n)) {
      return { value: clamp01(n > 1 ? n / 100 : n), fixed: true };
    }
  }
  return { value: 0, fixed: true };
}

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/ё/g, "е").replace(/[«»"'`]/g, "").trim();
}

/**
 * Приводит целевой диагноз терапии к точному названию гипотезы, если модель
 * написала его короче/длиннее. Возвращает null, если сопоставить не удалось
 * (тогда остаётся как есть — проверка `clinical-audit` покажет «осиротевшую»
 * терапию).
 */
function snapToDxName(target: string, dxNames: string[]): string | null {
  const t = norm(target);
  if (t.length < 3) return null;
  const exact = dxNames.find((d) => norm(d) === t);
  if (exact) return exact;
  const contained = dxNames.filter((d) => {
    const n = norm(d);
    return n.includes(t) || t.includes(n);
  });
  if (contained.length === 1) return contained[0];
  // Несколько подходящих — берём самую длинную (обычно самую специфичную).
  if (contained.length > 1) {
    return contained.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}

function mergeWorkup(base: WorkupItem, dup: WorkupItem): WorkupItem {
  const pick = (a?: string, b?: string) => a ?? b;
  const union = (a?: string[], b?: string[]) => {
    const out = Array.from(new Set([...(a ?? []), ...(b ?? [])]));
    return out.length > 0 ? out : undefined;
  };
  return {
    ...base,
    priority:
      PRIORITY_RANK[dup.priority] < PRIORITY_RANK[base.priority] ? dup.priority : base.priority,
    purpose: pick(base.purpose, dup.purpose),
    targetDx: pick(base.targetDx, dup.targetDx),
    targetDxConfirm: union(base.targetDxConfirm, dup.targetDxConfirm),
    targetDxRefute: union(base.targetDxRefute, dup.targetDxRefute),
    expectedResult: pick(base.expectedResult, dup.expectedResult),
    normalRange: pick(base.normalRange, dup.normalRange),
    cutoffs: pick(base.cutoffs, dup.cutoffs),
    confirmsIf: pick(base.confirmsIf, dup.confirmsIf),
    refutesIf: pick(base.refutesIf, dup.refutesIf),
    interpretation: pick(base.interpretation, dup.interpretation),
    timing: pick(base.timing, dup.timing),
    preparation: pick(base.preparation, dup.preparation),
  };
}

function hasDose(regimen?: string): boolean {
  return !!regimen && /\d/.test(regimen);
}

export interface SanitizeResult {
  structured: AnalysisStructured;
  /** Человекочитаемые исправления — попадают в structured.normalizationFixes. */
  fixes: string[];
}

/**
 * Нормализует структуру перед сохранением. Не удаляет гипотезы и не меняет
 * клинические утверждения — только форму: ранги, вероятности, дубли,
 * сопоставление терапии с гипотезами.
 */
export function sanitizeClinicalStructure(
  input: AnalysisStructured,
  dxNamesFromText: string[] = [],
): SanitizeResult {
  const fixes: string[] = [];
  const dxNames = Array.from(
    new Set(
      [...(input.differential ?? []).map((d) => d.diagnosis), ...dxNamesFromText].filter(
        (d) => d && d.trim().length > 0,
      ),
    ),
  );

  // ─── Гипотезы: чистка, ранги, вероятности ────────────────────────────
  const differential: DifferentialDiagnosis[] = [];
  for (const raw of input.differential ?? []) {
    const diagnosis = (raw.diagnosis ?? "").trim();
    if (diagnosis.length === 0) {
      fixes.push("Удалена гипотеза без названия");
      continue;
    }
    if (differential.some((d) => norm(d.diagnosis) === norm(diagnosis))) {
      fixes.push(`Удалён дубль гипотезы: ${diagnosis}`);
      continue;
    }
    const { value, fixed } = fixProbability(raw.probability);
    if (fixed) {
      fixes.push(`Вероятность гипотезы «${diagnosis}» приведена к доле (${value})`);
    }
    differential.push({
      ...raw,
      diagnosis,
      rank: differential.length + 1,
      probability: value,
      argumentsFor: (raw.argumentsFor ?? []).filter(Boolean),
      argumentsAgainst: (raw.argumentsAgainst ?? []).filter(Boolean),
      workup: (raw.workup ?? []).filter(Boolean),
      redFlags: (raw.redFlags ?? []).filter(Boolean),
      sources: (raw.sources ?? []).filter(Boolean),
    });
  }
  if (differential.length !== (input.differential ?? []).length) {
    // ранги могли сместиться — фиксируем отдельной строкой
    fixes.push("Ранги гипотез перенумерованы по порядку вероятности");
  }

  // ─── План дообследования: дубли и пустые названия ────────────────────
  const workupPlan: WorkupItem[] = [];
  for (const raw of input.workupPlan ?? []) {
    const name = (raw.name ?? "").trim();
    if (!name) {
      fixes.push("Удалено исследование без названия");
      continue;
    }
    const idx = workupPlan.findIndex((w) => areWorkupNamesDuplicates(w.name, name));
    if (idx >= 0) {
      const merged = mergeWorkup(workupPlan[idx], { ...raw, name });
      workupPlan[idx] = merged;
      fixes.push(`Объединён дубль исследования: «${workupPlan[idx].name}» + «${name}»`);
      continue;
    }
    workupPlan.push({
      ...raw,
      name,
      priority:
        raw.priority === "urgent" || raw.priority === "high" ? raw.priority : "routine",
    });
  }

  // ─── Терапия: привязка к точному названию гипотезы ───────────────────
  const therapyOptions: TherapyOption[] = [];
  for (const raw of input.therapyOptions ?? []) {
    const name = (raw.name ?? "").trim();
    if (!name) {
      fixes.push("Удалена терапевтическая опция без названия препарата");
      continue;
    }
    let targetDx = raw.targetDx?.trim();
    if (targetDx) {
      const snapped = snapToDxName(targetDx, dxNames);
      if (snapped && snapped !== targetDx) {
        fixes.push(`Целевой диагноз «${targetDx}» сопоставлен с гипотезой «${snapped}»`);
        targetDx = snapped;
      }
    }
    if (!hasDose(raw.regimen)) {
      // Не выдумываем дозу — только помечаем в отчёте исправлений.
      fixes.push(`У опции «${name}» не указана числовая доза — требуется проверка врачом`);
    }
    therapyOptions.push({ ...raw, name, targetDx });
  }

  // ─── Мониторинг ──────────────────────────────────────────────────────
  const monitoringPlan = (input.monitoringPlan ?? [])
    .map((m) => ({ ...m, marker: (m.marker ?? "").trim() }))
    .filter((m) => {
      if (!m.marker) {
        fixes.push("Удалён маркер мониторинга без названия");
        return false;
      }
      return true;
    });

  // ─── Дубли терапии (одинаковый препарат + одинаковый целевой диагноз) ─
  const dedupedTherapy: TherapyOption[] = [];
  for (const t of therapyOptions) {
    const dup = dedupedTherapy.find(
      (x) =>
        normalizeWorkupKey(x.name) === normalizeWorkupKey(t.name) &&
        norm(x.targetDx ?? "") === norm(t.targetDx ?? ""),
    );
    if (dup) {
      fixes.push(`Удалён дубль терапевтической опции: ${t.name}`);
      continue;
    }
    dedupedTherapy.push(t);
  }

  const merged: AnalysisStructured = {
    ...input,
    differential,
    workupPlan,
    therapyOptions: dedupedTherapy,
    monitoringPlan,
    // Сохраняем то, что не является выводом модели.
    verification: input.verification ?? { performed: false, passes: 0, corrections: [] },
    confirmedDx: input.confirmedDx,
    workupTracker: input.workupTracker,
    patientSafety: input.patientSafety,
    normalizationFixes: Array.from(new Set(fixes)),
  };

  return { structured: merged, fixes: Array.from(new Set(fixes)) };
}

/**
 * Применяет изменение трекера к структуре анализа.
 *
 * Вынесено из API-маршрута, чтобы поведение (сохранение результата, очистка
 * записи, автор и время) было покрыто тестами, а не проверялось только руками.
 * Возвращает НОВЫЙ объект структуры; исходный не мутируется.
 */
export interface WorkupUpdateInput {
  /** Название исследования (ключ считается из него). */
  name: string;
  status: WorkupStatus;
  resultValue?: string;
  comment?: string;
  /** Код/ФИО врача, сделавшего изменение. */
  updatedBy?: string;
}

export function applyWorkupUpdate(
  structured: Record<string, unknown> | null | undefined,
  input: WorkupUpdateInput,
  now: string = new Date().toISOString(),
): Record<string, unknown> {
  const base = structured ?? {};
  const key = normalizeWorkupKey(input.name);
  if (!key) return base;

  const tracker: WorkupTracker = {
    ...((base.workupTracker as WorkupTracker | undefined) ?? {}),
  };
  const previous = tracker[key];
  const resultValue = input.resultValue?.trim() || undefined;
  const comment = input.comment?.trim() || undefined;

  const entry: WorkupTrackerEntry = {
    status: input.status,
    resultValue,
    comment,
    // Время результата не перезаписывается, если результат не меняли.
    resultAt: resultValue ? now : previous?.resultAt,
    updatedBy: input.updatedBy,
    updatedAt: now,
  };

  // Возврат в «В плане» без результата и комментария — очистка записи.
  if (entry.status === "planned" && !resultValue && !comment) {
    delete tracker[key];
  } else {
    tracker[key] = entry;
  }

  return { ...base, workupTracker: tracker };
}

/**
 * Переносит решения врача (подтверждённые диагнозы и отметки трекера) в новую
 * версию анализа. Без этого повторный запуск молча стирал бы клиническую
 * работу врача — недопустимо для медицинской системы.
 */
export function carryOverDoctorState(
  previous: AnalysisStructured | null | undefined,
  next: AnalysisStructured,
): { structured: AnalysisStructured; carried: { confirmedDx: number; workup: number } } {
  if (!previous) return { structured: next, carried: { confirmedDx: 0, workup: 0 } };

  const nextDx = next.differential.map((d) => norm(d.diagnosis));
  const confirmedDx = (previous.confirmedDx ?? []).filter((d) =>
    nextDx.includes(norm(d)),
  );

  // Трекер: оставляем только записи по исследованиям, которые есть в новом плане.
  const nextKeys = new Set(next.workupPlan.map((w) => normalizeWorkupKey(w.name)));
  const workupTracker = Object.fromEntries(
    Object.entries(previous.workupTracker ?? {}).filter(([key]) => nextKeys.has(key)),
  );

  return {
    structured: {
      ...next,
      confirmedDx: confirmedDx.length > 0 ? confirmedDx : undefined,
      workupTracker: Object.keys(workupTracker).length > 0 ? workupTracker : undefined,
    },
    carried: { confirmedDx: confirmedDx.length, workup: Object.keys(workupTracker).length },
  };
}
