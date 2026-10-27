// СППВР — детерминированная проверка клинических рекомендаций ИИ
// ============================================================================
// ПРОБЛЕМА, КОТОРУЮ РЕШАЕТ МОДУЛЬ
// «Частая некорректность рекомендаций» — это в большинстве случаев не
// ошибочная догадка модели, а нарушения ФОРМЫ, которые врач не видит за
// объёмом текста:
//   • в дифференциальном ряду одна гипотеза вместо трёх, вероятности не
//     согласованы, нет аргументов «против» (значит, гипотеза не
//     фальсифицируема и её нельзя опровергнуть обследованием);
//   • план дообследования не привязан к гипотезам — непонятно, зачем тест;
//   • один и тот же тест попал в план дважды с разным приоритетом;
//   • терапия назначена «для вообще», без целевого диагноза, без дозы или
//     без предупреждений — именно такие карточки врачи и воспринимают как
//     некорректную рекомендацию;
//   • препарат совпадает с аллергией из карты пациента, но модель об этом
//     не знает.
//
// ЧТО ДЕЛАЕТ МОДУЛЬ
// Считает формальные проверки БЕЗ участия ИИ (детерминированно, воспроизводимо,
// покрыто тестами) и отдаёт врачу список замечаний с severity + действием.
// Это не клиническая истина и не замена врачебному суждению: модуль проверяет
// полноту и внутреннюю согласованность набора рекомендаций, а не правильность
// медицинских утверждений. Формулировки в UI это явно оговаривают.
// ============================================================================

import type {
  AnalysisStructured,
  DifferentialDiagnosis,
  WorkupItem,
} from "./types";
import { normalizeWorkupKey } from "./workup";
import { hypothesesGenitive, pluralRu, studiesGenitive } from "./plural";

export type AuditSeverity = "critical" | "warning" | "info";

export type AuditCategory =
  | "diagnosis"
  | "workup"
  | "therapy"
  | "monitoring"
  | "evidence"
  | "safety";

export interface AuditFinding {
  /** Стабильный идентификатор правила (для тестов и аналитики). */
  id: string;
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  detail: string;
  /** Что конкретно сделать врачу. */
  action?: string;
}

export interface ClinicalAuditReport {
  findings: AuditFinding[];
  critical: number;
  warning: number;
  info: number;
  /** 100 минус штрафы; 0 — критических замечаний много. */
  score: number;
  readiness: "high" | "medium" | "low";
}

const WEIGHTS: Record<AuditSeverity, number> = {
  critical: 18,
  warning: 7,
  info: 2,
};

export const AUDIT_SEVERITY_LABEL: Record<AuditSeverity, string> = {
  critical: "Критично",
  warning: "Требует внимания",
  info: "Замечание",
};

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  diagnosis: "Дифференциальный диагноз",
  workup: "План дообследования",
  therapy: "Терапия",
  monitoring: "Мониторинг",
  evidence: "Обоснованность",
  safety: "Безопасность",
};

// ---------------------------------------------------------------------------
// Нормализация строк для сопоставлений
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Совпадает ли целевой диагноз терапии с одной из гипотез. */
export function therapyTargetMatchesDx(
  target: string | undefined,
  diagnoses: string[],
): boolean {
  const t = norm(target ?? "");
  if (t.length < 3) return false;
  return diagnoses.some((d) => {
    const n = norm(d);
    if (n.length < 3) return false;
    return n.includes(t) || t.includes(n);
  });
}

/**
 * Похоже ли название препарата на аллерген.
 *
 * Сравнение консервативное и намеренно «широкое»: ложное предупреждение об
 * аллергии безопаснее пропуска. Сравниваются нормализованные строки и корни
 * первых слов (пенициллин ↔ пенициллин G, амоксициллин ↔ амоксициллин).
 */
export function drugMatchesAllergen(drug: string, allergen: string): boolean {
  const d = norm(drug).replace(/[^a-zа-я0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(allergen).replace(/[^a-zа-я0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (d.length < 3 || a.length < 3) return false;
  if (d.includes(a) || a.includes(d)) return true;

  const stem = (s: string) => s.split(" ")[0].slice(0, 5);
  const ds = stem(d);
  const as = stem(a);
  if (ds.length >= 5 && as.length >= 5 && (ds === as || ds.startsWith(as) || as.startsWith(ds))) {
    return true;
  }
  return false;
}

/** Есть ли в строке дозировки хоть одна цифра (доза без числа — не доза). */
function hasNumber(s: string | undefined): boolean {
  return !!s && /\d/.test(s);
}

/**
 * Считаются ли два названия исследования одним и тем же тестом.
 *
 * Кроме точного совпадения нормализованных строк ловится вложенность
 * («СРБ» ⊂ «СРБ, количественно»), потому что модель регулярно выдаёт один
 * тест дважды — коротко и с уточнением. Минимальная длина для вложенности —
 * 4 символа, чтобы короткие аббревиатуры не склеивались с произвольной строкой.
 */
export function areWorkupNamesDuplicates(a: string, b: string): boolean {
  const na = workupDedupeSignature(a);
  const nb = workupDedupeSignature(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length < 4) return false;
  return long.startsWith(short) || long.includes(` ${short} `);
}

/**
 * Слова, которые не меняют суть исследования: модель добавляет их к одному
 * и тому же тесту в разных версиях заключения («СРБ» / «СРБ, количественно»).
 */
const WORKUP_QUALIFIERS = new Set([
  "количественно",
  "количественный",
  "качественно",
  "качественный",
  "кровь",
  "крови",
  "сыворотка",
  "сыворотки",
  "плазма",
  "плазмы",
  "венозная",
  "венозной",
  "капиллярная",
  "определение",
  "исследование",
  "анализ",
  "уровень",
  "концентрация",
  "и",
  "с",
  "в",
  "на",
  "по",
]);

/** Подпись для поиска дублей: нормализованное название без уточняющих слов. */
export function workupDedupeSignature(name: string): string {
  return normalizeWorkupKey(name)
    .split(" ")
    .filter((w) => w.length > 0 && !WORKUP_QUALIFIERS.has(w))
    .join(" ")
    .trim();
}

/** Похоже ли название исследования на лабораторный тест (для проверки референсов). */
const LAB_LIKE =
  /(кров|сыворот|плазм|анализ|определен|уровень|концентрац|пцр|ифа|посев|биохим|оак|оам|коагулограм|титр|антител|антиген|гормон|фермент|маркер|d-димер|срб|crp|ттг|т4|alt|аст|гемоглобин|креатинин|мочев|калий|натрий)/i;

/** Названия гипотез, к которым план привязывает исследование. */
function workupTargets(item: WorkupItem): string[] {
  const out: string[] = [];
  if (item.targetDx) out.push(item.targetDx);
  if (item.targetDxConfirm) out.push(...item.targetDxConfirm);
  if (item.targetDxRefute) out.push(...item.targetDxRefute);
  return out.filter(Boolean);
}

function listNames(names: string[], limit = 3): string {
  const uniq = Array.from(new Set(names.filter(Boolean)));
  if (uniq.length <= limit) return uniq.join("; ");
  return `${uniq.slice(0, limit).join("; ")} и ещё ${uniq.length - limit}`;
}

function sumProbabilities(list: DifferentialDiagnosis[]): number {
  return list.reduce((acc, dx) => {
    const p = typeof dx.probability === "number" && Number.isFinite(dx.probability)
      ? dx.probability
      : 0;
    return acc + Math.max(0, Math.min(1, p));
  }, 0);
}

// ---------------------------------------------------------------------------
// Главная проверка
// ---------------------------------------------------------------------------

export interface AuditInput {
  structured?: AnalysisStructured | null;
  /** Есть ли в анализе цитаты/источники (используется правилом обоснованности). */
  citationsCount?: number;
}

export function auditAnalysis(input: AuditInput): ClinicalAuditReport {
  const structured = input.structured ?? null;
  const findings: AuditFinding[] = [];

  const differential = structured?.differential ?? [];
  const workupPlan = structured?.workupPlan ?? [];
  const therapyOptions = structured?.therapyOptions ?? [];
  const monitoringPlan = structured?.monitoringPlan ?? [];
  const safety = structured?.patientSafety;
  const dxNames = differential.map((d) => d.diagnosis).filter(Boolean);

  // ─── Дифференциальный диагноз ──────────────────────────────────────────
  if (differential.length === 0) {
    findings.push({
      id: "dx-empty",
      severity: "critical",
      category: "diagnosis",
      title: "Дифференциальный ряд не сформирован",
      detail:
        "В структурированном блоке нет ни одной диагностической гипотезы. Дальше по такому заключению нельзя безопасно строить план обследования и терапию.",
      action: "Запустите анализ повторно или разберите случай вручную по тексту заключения.",
    });
  } else if (differential.length < 3) {
    findings.push({
      id: "dx-few",
      severity: "critical",
      category: "diagnosis",
      title: `В дифференциальном ряду ${differential.length} ${pluralRu(differential.length, ["гипотеза", "гипотезы", "гипотез"])} вместо 3–5`,
      detail:
        "Одна–две гипотезы создают иллюзию определённости: клиническая картина почти всегда допускает несколько объяснений, и без альтернатив обследование назначается под заранее выбранный диагноз.",
      action: "Добавьте альтернативы вручную или перезапустите анализ с уточнёнными данными.",
    });
  }

  if (differential.length > 1) {
    const probs = differential.map((d) =>
      typeof d.probability === "number" ? d.probability : 0,
    );
    const unordered = probs.some((p, i) => i > 0 && p > probs[i - 1] + 0.01);
    if (unordered) {
      findings.push({
        id: "dx-probability-order",
        severity: "warning",
        category: "diagnosis",
        title: "Вероятности гипотез не согласованы с их порядком",
        detail:
          "Гипотеза с меньшей вероятностью стоит выше более вероятной. Порядок карточек вводит врача в заблуждение относительно рабочего диагноза.",
        action: "Проверьте ранжирование гипотез перед принятием решения.",
      });
    }
    const sum = sumProbabilities(differential);
    if (sum > 1.05) {
      findings.push({
        id: "dx-probability-sum",
        severity: "warning",
        category: "diagnosis",
        title: `Сумма вероятностей гипотез ${Math.round(sum * 100)}%`,
        detail:
          "Гипотезы одного дифференциального ряда должны покрывать не более 100%: сумма выше означает, что модель оценивала их независимо, а не как взаимоисключающие.",
        action: "Считайте проценты ориентировочными и опирайтесь на аргументы, а не на цифры.",
      });
    }
    if (probs.every((p) => p <= 0)) {
      findings.push({
        id: "dx-probability-missing",
        severity: "warning",
        category: "diagnosis",
        title: "Вероятности гипотез не оценены",
        detail:
          "У всех гипотез вероятность 0 или отсутствует. Врач не может понять, какая версия рабочая, а какая — резервная.",
        action: "Оцените вероятность самостоятельно или запросите повторный анализ.",
      });
    }
  }

  const weakSupport = differential
    .filter((d) => (d.argumentsFor?.length ?? 0) < 2)
    .map((d) => d.diagnosis);
  if (weakSupport.length > 0) {
    findings.push({
      id: "dx-weak-support",
      severity: "warning",
      category: "diagnosis",
      title: `Мало аргументов «за» у ${hypothesesGenitive(weakSupport.length)}`,
      detail: `Меньше двух подтверждающих фактов: ${listNames(weakSupport)}. Гипотеза без опоры на данные — это догадка, а не дифференциально-диагностическая версия.`,
      action: "Сверьтесь с первичными документами: возможно, ключевые факты не распознаны.",
    });
  }

  const noCounter = differential
    .filter((d) => (d.argumentsAgainst?.length ?? 0) === 0)
    .map((d) => d.diagnosis);
  if (noCounter.length > 0) {
    findings.push({
      id: "dx-no-counter",
      severity: "warning",
      category: "diagnosis",
      title: `Нет аргументов «против» у ${hypothesesGenitive(noCounter.length)}`,
      detail: `Гипотезы без критериев исключения: ${listNames(noCounter)}. Если нет ни одного противоречащего признака, гипотезу невозможно опровергнуть — она будет «подтверждаться» всегда.`,
      action: "Сформулируйте, какой результат заставит вас отказаться от гипотезы.",
    });
  }

  const linkedDx = new Set<string>();
  for (const item of workupPlan) {
    for (const target of workupTargets(item)) linkedDx.add(norm(target));
  }
  const noWorkup = differential
    .filter((d) => {
      if ((d.workup?.length ?? 0) > 0) return false;
      const n = norm(d.diagnosis);
      return !Array.from(linkedDx).some((t) => t.includes(n) || n.includes(t));
    })
    .map((d) => d.diagnosis);
  if (noWorkup.length > 0) {
    findings.push({
      id: "dx-no-workup",
      severity: "warning",
      category: "diagnosis",
      title: `Для ${hypothesesGenitive(noWorkup.length)} не указано, чем их подтверждать`,
      detail: `Без исследования в плане: ${listNames(noWorkup)}. Такие гипотезы остаются висеть и не влияют на тактику.`,
      action: "Добавьте подтверждающий тест или уберите гипотезу из рабочего ряда.",
    });
  }

  const top = differential[0];
  if (top && (top.redFlags?.length ?? 0) === 0) {
    findings.push({
      id: "dx-no-redflags",
      severity: "info",
      category: "diagnosis",
      title: "Для ведущей гипотезы не указаны красные флаги",
      detail:
        "Отсутствуют признаки, при которых тактика меняется на неотложную. Для амбулаторного разбора это допустимо, но повышает риск пропустить тяжёлое течение.",
      action: "Проверьте вручную: признаки жизнеугрожающего состояния при ведущем диагнозе.",
    });
  }

  const dxHasSources = differential.some((d) => (d.sources?.length ?? 0) > 0);
  if (!dxHasSources && (input.citationsCount ?? 0) === 0) {
    findings.push({
      id: "dx-no-sources",
      severity: "info",
      category: "evidence",
      title: "Гипотезы не привязаны к источникам",
      detail:
        "Ни у одной гипотезы нет ссылки на клиническую рекомендацию, и в анализе нет цитат. Проверить утверждения по первоисточнику нельзя.",
      action: "Сверьтесь с КР Минздрава РФ по коду МКБ-10 рабочего диагноза.",
    });
  }

  // ─── План дообследования ───────────────────────────────────────────────
  if (differential.length > 0 && workupPlan.length === 0) {
    findings.push({
      id: "workup-empty",
      severity: "critical",
      category: "workup",
      title: "План дообследования пуст",
      detail:
        "Гипотезы есть, но ни одного исследования не предложено. Диагноз остаётся непроверенным, а терапия — преждевременной.",
      action: "Сформируйте план вручную или перезапустите анализ.",
    });
  }

  const noLink = workupPlan.filter(
    (w) => workupTargets(w).length === 0 && !w.purpose,
  );
  if (noLink.length > 0) {
    findings.push({
      id: "workup-no-link",
      severity: "warning",
      category: "workup",
      title: `У ${studiesGenitive(noLink.length)} не указано, какую гипотезу они проверяют`,
      detail: `Без цели и привязки к гипотезе: ${listNames(noLink.map((w) => w.name))}. Исследование «на всякий случай» — источник лишних затрат и ложных находок.`,
      action: "Для каждого теста определите: какую гипотезу он подтверждает или исключает.",
    });
  }

  const noPurpose = workupPlan.filter((w) => !w.purpose && workupTargets(w).length > 0);
  if (noPurpose.length > 0) {
    findings.push({
      id: "workup-no-purpose",
      severity: "info",
      category: "workup",
      title: `У ${studiesGenitive(noPurpose.length)} не описано «зачем»`,
      detail: `Привязка к гипотезе есть, обоснование — нет: ${listNames(noPurpose.map((w) => w.name))}.`,
      action: "Кратко зафиксируйте цель теста перед назначением.",
    });
  }

  const dupGroups: string[][] = [];
  for (const w of workupPlan) {
    if (!normalizeWorkupKey(w.name)) continue;
    const group = dupGroups.find((g) =>
      g.some((existing) => areWorkupNamesDuplicates(existing, w.name)),
    );
    if (group) group.push(w.name);
    else dupGroups.push([w.name]);
  }
  const dups = dupGroups.filter((arr) => arr.length > 1);
  if (dups.length > 0) {
    findings.push({
      id: "workup-duplicates",
      severity: "warning",
      category: "workup",
      title: `Дубли в плане обследования: ${dups.length}`,
      detail: `Повторяются: ${listNames(dups.map((d) => d.join(" / ")), 2)}. Дубли раздувают план и могут привести к повторному направлению на то же исследование.`,
      action: "Оставьте один пункт с наиболее полным описанием и приоритетом.",
    });
  }

  const labNoRef = workupPlan.filter(
    (w) =>
      LAB_LIKE.test(w.name) &&
      !w.normalRange &&
      !w.cutoffs &&
      !w.confirmsIf &&
      !w.refutesIf &&
      !w.expectedResult,
  );
  if (labNoRef.length > 0) {
    findings.push({
      id: "workup-no-reference",
      severity: "info",
      category: "workup",
      title: `У ${labNoRef.length} лабораторных ${pluralRu(labNoRef.length, ["теста", "тестов", "тестов"])} нет референса или критерия`,
      detail: `Без нормы и критерия оценки: ${listNames(labNoRef.map((w) => w.name))}. Врачу придётся вспоминать диапазоны, что повышает риск ошибки трактовки.`,
      action: "Дозаполните «Норма/пороги» и «Подтверждает, если».",
    });
  }

  const hasUrgent = workupPlan.some((w) => w.priority === "urgent");
  if (
    !hasUrgent &&
    workupPlan.length > 0 &&
    top &&
    (top.probability ?? 0) >= 0.6
  ) {
    findings.push({
      id: "workup-no-urgent",
      severity: "info",
      category: "workup",
      title: "Среди исследований нет срочных",
      detail:
        "Ведущая гипотеза оценена как высоковероятная, но план не содержит ни одного срочного пункта — очерёдность выполнения не задана.",
      action: "Определите, что нужно выполнить в первые часы/сутки.",
    });
  }

  // ─── Терапия ───────────────────────────────────────────────────────────
  const orphan = therapyOptions.filter(
    (t) => t.targetDx && !therapyTargetMatchesDx(t.targetDx, dxNames),
  );
  if (orphan.length > 0) {
    findings.push({
      id: "therapy-orphan",
      severity: "critical",
      category: "therapy",
      title: `Терапия привязана к диагнозу вне дифференциального ряда: ${orphan.length}`,
      detail: `Целевой диагноз не совпадает ни с одной гипотезой: ${listNames(orphan.map((t) => `${t.name} → ${t.targetDx}`))}. Такая рекомендация не может быть разблокирована подтверждением и висит «сама по себе».`,
      action: "Сопоставьте препарат с гипотезой или удалите опцию из рабочего плана.",
    });
  }

  const noTarget = therapyOptions.filter((t) => !t.targetDx);
  if (noTarget.length > 0) {
    findings.push({
      id: "therapy-no-target",
      severity: "critical",
      category: "therapy",
      title: `Терапия без целевого диагноза: ${noTarget.length}`,
      detail: `Препараты без указания, при каком подтверждённом диагнозе они применяются: ${listNames(noTarget.map((t) => t.name))}. Это назначение «вслепую» до верификации диагноза.`,
      action: "Не применяйте эти опции до определения диагноза.",
    });
  }

  const noDose = therapyOptions.filter((t) => !hasNumber(t.regimen));
  if (noDose.length > 0) {
    findings.push({
      id: "therapy-no-dose",
      severity: "warning",
      category: "therapy",
      title: `Не указана дозировка: ${noDose.length}`,
      detail: `Без числовой дозы/режима: ${listNames(noDose.map((t) => t.name))}. Рекомендация без дозы неприменима в назначении и опасна при копировании в карту.`,
      action: "Уточните дозу, путь, кратность и длительность по КР перед назначением.",
    });
  }

  const noCaution = therapyOptions.filter((t) => !t.caution);
  if (noCaution.length > 0) {
    findings.push({
      id: "therapy-no-caution",
      severity: "warning",
      category: "therapy",
      title: `Не указаны предупреждения: ${noCaution.length}`,
      detail: `Без противопоказаний и контроля до старта: ${listNames(noCaution.map((t) => t.name))}.`,
      action: "Проверьте противопоказания, взаимодействия и контроль до начала терапии.",
    });
  }

  const noSource = therapyOptions.filter((t) => !t.source);
  if (noSource.length > 0) {
    findings.push({
      id: "therapy-no-source",
      severity: "warning",
      category: "therapy",
      title: `Не указан источник рекомендации: ${noSource.length}`,
      detail: `Без ссылки на КР/гайдлайн: ${listNames(noSource.map((t) => t.name))}. Проверить уровень доказательности невозможно.`,
      action: "Сверьте схему с КР Минздрава РФ или международным гайдлайном.",
    });
  }

  const noEvidence = therapyOptions.filter((t) => !t.evidenceLevel);
  if (noEvidence.length > 0) {
    findings.push({
      id: "therapy-no-evidence",
      severity: "info",
      category: "therapy",
      title: `Не указан уровень доказательности: ${noEvidence.length}`,
      detail: `Без уровня A/B/C: ${listNames(noEvidence.map((t) => t.name))}.`,
    });
  }

  // ─── Мониторинг ────────────────────────────────────────────────────────
  if (therapyOptions.length > 0 && monitoringPlan.length === 0) {
    findings.push({
      id: "monitoring-empty",
      severity: "warning",
      category: "monitoring",
      title: "Терапия предложена без плана контроля",
      detail:
        "Нет ни одного маркера эффективности/безопасности. Для препаратов с узким терапевтическим окном и нефро-/гепатотоксичностью это самостоятельный риск.",
      action: "Определите минимум: что контролировать, когда и какая цель.",
    });
  }

  const looseMonitoring = monitoringPlan.filter((m) => !m.frequency || !m.target);
  if (looseMonitoring.length > 0) {
    findings.push({
      id: "monitoring-incomplete",
      severity: "info",
      category: "monitoring",
      title: `Неполное описание контроля: ${looseMonitoring.length}`,
      detail: `Без частоты или целевого значения: ${listNames(looseMonitoring.map((m) => m.marker))}.`,
      action: "Дозаполните частоту и цель контроля.",
    });
  }

  // ─── Безопасность: аллергии из карты пациента ──────────────────────────
  if (safety?.allergies?.length) {
    const hits: string[] = [];
    for (const t of therapyOptions) {
      for (const allergen of safety.allergies) {
        if (drugMatchesAllergen(t.name, allergen)) {
          hits.push(`${t.name} ↔ аллергия «${allergen}»`);
        }
      }
    }
    if (hits.length > 0) {
      findings.push({
        id: "safety-allergy",
        severity: "critical",
        category: "safety",
        title: "Предложенный препарат совпадает с аллергией пациента",
        detail: `Совпадения по данным карты: ${listNames(hits, 4)}. Модель не гарантирует учёт аллергоанамнеза — проверка выполнена детерминированно по снапшоту карты.`,
        action: "Исключите препарат и подберите альтернативу из другой группы.",
      });
    }
  }

  if (!structured?.verification?.performed) {
    findings.push({
      id: "verification-not-run",
      severity: "info",
      category: "evidence",
      title: "Самопроверка ИИ не выполнялась",
      detail:
        "Заключение получено без прохода верификации (AI_SELF_VERIFY_PASSES=0 или ошибка прохода). Качество фактов не перепроверялось.",
      action: "Запустите анализ повторно с включённой самопроверкой.",
    });
  }

  // ─── Итог ──────────────────────────────────────────────────────────────
  const order: Record<AuditSeverity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  const penalty = findings.reduce((acc, f) => acc + WEIGHTS[f.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const readiness: ClinicalAuditReport["readiness"] =
    differential.length === 0
      ? "low"
      : score >= 85
        ? "high"
        : score >= 65
          ? "medium"
          : "low";

  return { findings, critical, warning, info, score, readiness };
}

/** Короткая сводка для шапки/логов. */
export function auditSummary(report: ClinicalAuditReport): string {
  if (report.findings.length === 0) return "Формальных замечаний нет";
  const parts: string[] = [];
  if (report.critical) parts.push(`критичных: ${report.critical}`);
  if (report.warning) parts.push(`на внимание: ${report.warning}`);
  if (report.info) parts.push(`замечаний: ${report.info}`);
  return parts.join(", ");
}
