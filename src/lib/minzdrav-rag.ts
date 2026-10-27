// СППВР v4.2 — ПРЯМОЙ РАЗБОР РЕПОЗИТОРИЯ КР МИНЗДРАВА РФ ПО ТЕМЕ (RAG-ядро)
// ============================================================================
// НАЗНАЧЕНИЕ: ИИ НАПРЯМУЮ подключается к официальному репозиторию клинических
// рекомендаций Минздрава РФ (cr.minzdrav.gov.ru, API — apicr.minzdrav.gov.ru)
// и ПАРСИТ его по требуемой теме:
//
//   тема («артериальная гипертензия», «сахарный диабет 2 типа», «лечение ХСН»)
//     │
//     ▼
//   1. ПОИСК в репозитории (GetJsonClinrecsFilterV2 — многошаговая стратегия:
//      полный запрос → отдельные термины → фильтр по МКБ-10)
//   2. ЗАГРУЗКА ПОЛНЫХ ТЕКСТОВ топ-N КР (GetClinrec2 — ВСЕ разделы:
//      краткая информация, диагностика, лечение, реабилитация, профилактика,
//      критерии качества, алгоритмы действий врача (Прил. Б), шкалы (Прил. Г))
//   3. ПАРСИНГ: HTML → текст → фрагменты (чанки) по ~800-1000 символов
//   4. РАНЖИРОВАНИЕ фрагментов по релевантности ТЕМЕ (покрытие терминов +
//      буст типа раздела под фокус запроса: диагностика/лечение)
//   5. КОНТЕКСТ ДЛЯ LLM: топ-фрагменты с точными ссылками на официальный
//      источник — укладывается в бюджет контекстного окна модели
//
// ОТЛИЧИЕ от v4.1 (minzdrav-cr.ts findClinrecs): ранее выдержки брались из
// ФИКСИРОВАННЫХ разделов (doc_diag_2*, doc_3) с жёстким обрезанием. Теперь
// парсятся ВСЕ разделы полного текста КР (включая огромные «Лечение» ~158 КБ,
// «Алгоритмы действий врача» ~1.9 МБ, «Шкалы» ~2.2 МБ) и отбираются ИМЕННО
// ТЕ фрагменты, которые релевантны запрошенной теме — настоящий topic-driven RAG.
//
// ПРИВАТНОСТЬ (ФЗ-152, ФЗ-323 ст. 13):
//   Наружу уходят ТОЛЬКО клинические термины темы (названия заболеваний,
//   коды МКБ-10). Тема проходит санитизацию до выхода в сеть.
//
// НАДЁЖНОСТЬ: функции не бросают исключений; при офлайне работает
// персистентный кэш MinzdravCache (см. minzdrav-cr.ts).
// ============================================================================

import { logger } from "./logger";
import {
  MINZDRAV_ENABLED,
  searchClinrecs,
  getClinrecFull,
  clinrecUrl,
  clinrecPdfUrl,
  htmlToText,
  type ClinrecListItem,
  type ClinrecFull,
  type ClinrecSection,
} from "./minzdrav-cr";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

/** Классификация раздела полного текста КР (по id раздела). */
export type SectionKind =
  | "brief" // 1. Краткая информация (определение, эпидемиология, классификация)
  | "diagnostics" // 2. Диагностика (жалобы, анализы, инструментальные)
  | "therapy" // 3. Лечение (включая под разделы 3.1..3.17: немедикаментозное, ЛС, хирургия…)
  | "rehabilitation" // 4. Реабилитация
  | "prevention" // 5. Профилактика
  | "organization" // 6. Организация помощи + 7. Доп. информация
  | "criteria" // Критерии оценки качества медицинской помощи
  | "algorithms" // Приложение Б — алгоритмы действий врача (текстовые описания)
  | "scales" // Приложение Г — шкалы оценки, вопросники
  | "other"; // прочее (термины, сокращения, приложения А)

/** Отобранный по теме фрагмент полного текста КР. */
export interface RagFragment {
  sectionId: string; // "doc_3_1_2"
  sectionTitle: string; // "3.1.2 Немедикаментозное лечение"
  sectionKind: SectionKind;
  text: string; // парсированный текст фрагмента (~800-1000 символов)
  score: number; // релевантность теме 0..1
}

/** КР Минздрава, разобранная по теме. */
export interface ClinrecRagMatch {
  codeVersion: string; // "62_3"
  name: string;
  mkbCodes: string[];
  mkbString: string;
  developers: string[];
  ageCategory: string;
  publishDate: string | null;
  npcApproved: boolean;
  url: string; // cr.minzdrav.gov.ru/view-cr/62_3
  pdfUrl: string;
  relevanceScore: number; // релевантность КР теме 0..1
  sectionsCount: number; // всего разделов в полном тексте
  fragmentsScanned: number; // сколько фрагментов просмотрено при разборе
  fragments: RagFragment[]; // отобранные релевантные теме фрагменты
}

/** Полный результат разбора репозитория по теме. */
export interface TopicRagResult {
  topic: string; // нормализованная тема
  terms: string[]; // термины темы, по которым шёл поиск и скоринг
  matches: ClinrecRagMatch[]; // разобранные КР (топ-N)
  context: string; // готовый контекст для промпта LLM
  error?: string;
  fromCache: boolean; // хотя бы одна КР отдана кэшем
  fetchedAt: string;
}

/** Опции разбора по теме. */
export interface TopicParseOptions {
  /** Коды МКБ-10 для уточнения поиска КР (напр. ["I10", "E11.9"]). */
  icd10Codes?: string[];
  /** Фокус запроса: усиливает релевантные разделы. */
  focus?: "diagnostics" | "therapy" | "general";
  /** Сколько КР разбирать полностью (по умолчанию 3). */
  maxClinrecs?: number;
  /** Максимум фрагментов на КР (по умолчанию 5). */
  maxFragmentsPerClinrec?: number;
  /** Общий бюджет символов контекста для LLM (по умолчанию 12000). */
  maxTotalChars?: number;
  /** Возрастная категория: 1 дети | 2 взрослые | null не фильтровать. */
  ageCategory?: number | null;
}

// ---------------------------------------------------------------------------
// Нормализация темы и стоп-слова
// ---------------------------------------------------------------------------

/** Русские стоп-слова, не несущие клинической смысловой нагрузки. */
const STOP_WORDS = new Set([
  "и", "или", "не", "с", "у", "в", "на", "о", "об", "по", "для", "при", "как",
  "что", "это", "the", "and", "for", "with", "какой", "какая", "какие",
  "пациент", "пациента", "пациенту", "пациентом", "больной", "больного",
  "скажите", "пожалуйста", "подскажите", "расскажите", "объясните", "нужно",
  "можно", "надо", "стоит", "следует", "является", "являются", "был", "была",
  "были", "будет", "есть", "также", "такой", "такая", "такие", "мой", "моя",
  "его", "её", "их", "этот", "эта", "эти", "того", "тому", "всё", "все",
  "очень", "более", "менее", "most", "очень", "когда", "где", "почему",
  "лет", "года", "год", "мужчина", "женщина", "муж", "жен",
]);

/** Слова-маркеры фокуса запроса (для авто-определения diagnostics/therapy). */
const DIAG_FOCUS_WORDS = ["диагностик", "диагноз", "обследован", "анализ", "лаборатор", "инструментальн", "дифференц", "как выявить", "скрининг", "биомаркер"];
const THERAPY_FOCUS_WORDS = ["лечен", "терапи", "терапию", "препарат", "назначить", "назначен", "доз", "схема", "медикамент", "хирург", "тактик", "вести", "ведение", "курирован"];

/**
 * Нормализует тему: убирает пунктуацию, выделяет значимые термины.
 * Возвращает { topic, terms, focus }.
 */
export function normalizeTopic(rawTopic: string): {
  topic: string;
  terms: string[];
  focus: "diagnostics" | "therapy" | "general";
  ageHint: 0 | 1 | 2; // 0 — не определён, 1 — дети, 2 — взрослые
} {
  const cleaned = rawTopic
    .replace(/[«»"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Универсальные слова-маркеры запроса: несут фокус (диагностика/лечение),
  // но почти никогда не входят в НАЗВАНИЕ КР как отличительный термин —
  // исключаем из терминов поиска (фокус сохраняется отдельно).
  const GENERIC_QUERY_WORDS = /^((диагностик|лечен|терап|тактик|профилактик|реабилитаци|обследован|симптом|ведени|курир|назначен|помощ))/;

  const words = cleaned
    .toLowerCase()
    .split(/[^a-zа-яё0-9-]+/i)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length >= 3 &&
        !STOP_WORDS.has(w) &&
        !/^\d+$/.test(w) &&
        !GENERIC_QUERY_WORDS.test(w),
    );

  // Дедупликация с сохранением порядка
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      terms.push(w);
    }
  }

  // Авто-фокус по маркерам в исходной теме
  const lower = cleaned.toLowerCase();
  const hasDiag = DIAG_FOCUS_WORDS.some((p) => lower.includes(p));
  const hasTherapy = THERAPY_FOCUS_WORDS.some((p) => lower.includes(p));
  let focus: "diagnostics" | "therapy" | "general" = "general";
  if (hasDiag && !hasTherapy) focus = "diagnostics";
  else if (hasTherapy && !hasDiag) focus = "therapy";

  // Возрастной контекст темы: «у взрослых» → 2, «у детей/детей» → 1
  let ageHint: 0 | 1 | 2 = 0;
  if (/взросл/i.test(lower)) ageHint = 2;
  else if (/дет(?:ей|и|ям|ский)|педиатр|новорожд/i.test(lower)) ageHint = 1;

  return { topic: cleaned, terms: terms.slice(0, 12), focus, ageHint };
}

// ---------------------------------------------------------------------------
// Классификация разделов КР
// ---------------------------------------------------------------------------

/** Определяет тип раздела по его id (структура GetClinrec2). */
export function classifySection(id: string): SectionKind {
  if (id.startsWith("doc_diag_2")) return "diagnostics";
  if (id === "doc_3" || /^doc_3(_|$)/.test(id)) return "therapy";
  if (id.startsWith("doc_crat_info_1")) return "brief";
  if (id === "doc_1") return "brief";
  if (id === "doc_4" || id.startsWith("doc_4_")) return "rehabilitation";
  if (id === "doc_5" || id.startsWith("doc_5_")) return "prevention";
  if (id === "doc_6" || id === "doc_7" || id.startsWith("doc_6_") || id.startsWith("doc_7_")) return "organization";
  if (id === "doc_criteria" || id.startsWith("doc_criteria")) return "criteria";
  if (id === "doc_b" || id.startsWith("doc_b")) return "algorithms";
  if (id === "doc_g" || /^doc_g\d/.test(id) || id.startsWith("doc_g")) return "scales";
  return "other";
}

/** Разделы, которые не несут клинической пользы для RAG. */
function isSkippableSection(s: ClinrecSection): boolean {
  // doc_whole — дубликат ВСЕХ разделов одним куском (до 200+ КБ)
  if (s.id === "doc_whole") return true;
  // Список литературы — ссылки на публикации, не рекомендации
  if (s.id === "doc_bible") return true;
  // Пустые служебные разделы
  if (s.id === "doc_title" || s.id === "doc_key_words") return true;
  return false;
}

/** Буст типа раздела под фокус запроса. */
function sectionKindBoost(kind: SectionKind, focus: "diagnostics" | "therapy" | "general"): number {
  switch (kind) {
    case "diagnostics":
      return focus === "diagnostics" ? 0.30 : focus === "general" ? 0.12 : 0.04;
    case "therapy":
      return focus === "therapy" ? 0.30 : focus === "general" ? 0.12 : 0.04;
    case "brief":
      return 0.10;
    case "algorithms":
      return 0.08;
    case "scales":
      return 0.06;
    case "criteria":
      return 0.05;
    case "rehabilitation":
    case "prevention":
      return 0.04;
    case "organization":
    case "other":
      return 0.0;
  }
}

/** Человекочитаемая метка типа раздела (для UI). */
export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  brief: "Краткая информация",
  diagnostics: "Диагностика",
  therapy: "Лечение",
  rehabilitation: "Реабилитация",
  prevention: "Профилактика",
  organization: "Организация помощи",
  criteria: "Критерии качества",
  algorithms: "Алгоритмы (Прил. Б)",
  scales: "Шкалы (Прил. Г)",
  other: "Прочее",
};

// ---------------------------------------------------------------------------
// Чанкинг раздела на фрагменты
// ---------------------------------------------------------------------------

const FRAGMENT_TARGET_CHARS = 900;
const FRAGMENT_MAX_CHARS = 1200;

/**
 * Разбивает текст раздела на фрагменты по абзацам (~900 символов).
 * Возвращает массив фрагментов текста.
 */
export function chunkSectionText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter((p) => p.length >= 30);

  const fragments: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length + 1 <= FRAGMENT_TARGET_CHARS) {
      current = current ? `${current}\n${p}` : p;
    } else {
      if (current) fragments.push(current);
      // Слишком длинный абзац (напр. таблица) — режем жёстко
      if (p.length > FRAGMENT_MAX_CHARS) {
        for (let i = 0; i < p.length; i += FRAGMENT_TARGET_CHARS) {
          fragments.push(p.slice(i, i + FRAGMENT_TARGET_CHARS).trim());
        }
        current = "";
      } else {
        current = p;
      }
    }
  }
  if (current) fragments.push(current);
  return fragments.filter((f) => f.length >= 40);
}

// ---------------------------------------------------------------------------
// Скоринг фрагментов по теме
// ---------------------------------------------------------------------------

/** Склоняемая основа слова (грубая нормализация для русского). */
function stemLite(word: string): string {
  let w = word.toLowerCase();
  // Отрезаем частые русские окончания (достаточно для поиска вхождений).
  // Порядок важен: сначала длинные окончания, затем короткие.
  const endings = [
    "иями", "ями", "ами", "иях", "ему", "ого", "его", "ыми", "ими", "ием",
    "ией", "ется", "аться", "ешь",
    "ях", "ах", "ов", "ев", "ей", "ой", "ая", "ое", "ые", "ий", "ия", "ии",
    "ам", "ом", "ем", "ым", "им", "ых", "их", "ую", "юю", "утся", "ются", "ся",
    "а", "я", "о", "е", "у", "ю", "ы", "и", "ь",
  ];
  for (const suf of endings) {
    if (w.length > suf.length + 4 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

/**
 * Оценивает релевантность фрагмента теме (0..1).
 * Учитывает покрытие терминов, попадание терминов в заголовок раздела,
 * плотность вхождений и буст типа раздела.
 */
function scoreFragment(
  fragmentText: string,
  sectionTitle: string,
  kind: SectionKind,
  terms: string[],
  focus: "diagnostics" | "therapy" | "general",
): number {
  if (terms.length === 0) return 0.25 + sectionKindBoost(kind, focus);

  const textLower = fragmentText.toLowerCase();
  const titleLower = sectionTitle.toLowerCase();

  let termHits = 0;
  let occurrenceWeight = 0;

  for (const term of terms) {
    const t = term.toLowerCase();
    if (t.length < 3) continue;

    // Варианты: полное слово и основа (для русских окончаний)
    const stem = stemLite(t);
    const inTitle = titleLower.includes(t) || titleLower.includes(stem);
    const inText = textLower.includes(t) || textLower.includes(stem);

    if (inTitle && inText) {
      termHits += 1.4; // термин в заголовке раздела И в тексте — сильный сигнал
    } else if (inText) {
      // Плотность: сколько раз термин встретился в фрагменте
      let count = 0;
      let idx = textLower.indexOf(stem.length >= 4 ? stem : t);
      while (idx !== -1 && count < 6) {
        count++;
        idx = textLower.indexOf(stem.length >= 4 ? stem : t, idx + stem.length);
      }
      termHits += 1;
      occurrenceWeight += Math.min(count, 4) * 0.08;
    } else if (inTitle) {
      termHits += 0.5;
    }
  }

  const coverage = termHits / terms.length;
  // Лёгкий штраф за очень длинные фрагменты (таблицы) — они разбавляют контекст
  const lengthPenalty = fragmentText.length > FRAGMENT_MAX_CHARS ? -0.05 : 0;

  const base = Math.min(coverage, 1) * 0.55 + Math.min(occurrenceWeight, 0.3);
  const boost = sectionKindBoost(kind, focus);
  return Math.max(0, Math.min(1, base + boost + lengthPenalty));
}

// ---------------------------------------------------------------------------
// Разбор одной КР по теме
// ---------------------------------------------------------------------------

/**
 * Разбирает полный текст КР: все разделы → текст → фрагменты → скоринг по
 * теме → топ-фрагменты. Возвращает фрагменты, отсортированные по релевантности
 * (с приоритетом разнообразия разделов).
 */
async function parseClinrecByTopic(
  item: ClinrecListItem,
  terms: string[],
  focus: "diagnostics" | "therapy" | "general",
  maxFragments: number,
): Promise<ClinrecRagMatch | null> {
  // Режим только метаданных (maxFragments = 0): полные тексты не грузим
  if (maxFragments <= 0) {
    return {
      codeVersion: item.CodeVersion,
      name: item.Name,
      mkbCodes: (item.Mkbs ?? []).map((m) => m.MkbCode),
      mkbString: (item.Mkbs ?? []).map((m) => m.MkbCode).join(", "),
      developers: (item.Developers ?? []).map((d) => d.NkoName).filter(Boolean),
      ageCategory: item.AgeCategoryStr,
      publishDate: item.PublishDateStr,
      npcApproved: Boolean(item.NPC_approved),
      url: clinrecUrl(item.CodeVersion),
      pdfUrl: clinrecPdfUrl(item.CodeVersion),
      relevanceScore: scoreListItem(item, terms),
      sectionsCount: 0,
      fragmentsScanned: 0,
      fragments: [],
    };
  }

  const full: ClinrecFull | null = await getClinrecFull(item.CodeVersion);
  if (!full || !full.obj?.sections) return null;

  const sections = full.obj.sections;
  const allFragments: Array<RagFragment & { _scoreRaw: number }> = [];
  let scanned = 0;

  for (const section of sections) {
    if (isSkippableSection(section)) continue;
    const rawText = htmlToText(section.content ?? "").trim();
    if (rawText.length < 40) continue;

    const kind = classifySection(section.id);
    const fragments = chunkSectionText(rawText);

    for (const text of fragments) {
      scanned++;
      const score = scoreFragment(text, section.title, kind, terms, focus);
      allFragments.push({
        sectionId: section.id,
        sectionTitle: section.title,
        sectionKind: kind,
        text,
        score,
        _scoreRaw: score,
      });
    }
  }

  // Сортировка по релевантности
  allFragments.sort((a, b) => b._scoreRaw - a._scoreRaw);

  // Отбор с разнообразием: не более 2 фрагментов из одного раздела,
  // стремимся покрыть разные типы разделов
  const selected: Array<RagFragment & { _scoreRaw: number }> = [];
  const perSectionCount = new Map<string, number>();
  const usedKinds = new Map<SectionKind, number>();

  for (const f of allFragments) {
    if (selected.length >= maxFragments) break;
    if (f._scoreRaw < 0.18) break; // ниже порога — не берём шум

    const secCount = perSectionCount.get(f.sectionId) ?? 0;
    if (secCount >= 2) continue;

    // После 3 фрагментов требуем разнообразие типов разделов
    const kindCount = usedKinds.get(f.sectionKind) ?? 0;
    if (selected.length >= 3 && kindCount >= 2) continue;

    selected.push(f);
    perSectionCount.set(f.sectionId, secCount + 1);
    usedKinds.set(f.sectionKind, kindCount + 1);
  }

  // Fallback: если тема дала мало фрагментов — берём топ разделов
  // краткой информации и лечения (базовая клиническая канва)
  if (selected.length < Math.min(2, maxFragments)) {
    const fallbackKinds: SectionKind[] = ["brief", "diagnostics", "therapy"];
    for (const kind of fallbackKinds) {
      if (selected.length >= Math.min(2, maxFragments)) break;
      const candidate = allFragments.find(
        (f) => f.sectionKind === kind && !selected.includes(f),
      );
      if (candidate) {
        selected.push(candidate);
        perSectionCount.set(candidate.sectionId, (perSectionCount.get(candidate.sectionId) ?? 0) + 1);
      }
    }
  }

  return {
    codeVersion: item.CodeVersion,
    name: item.Name,
    mkbCodes: (item.Mkbs ?? []).map((m) => m.MkbCode),
    mkbString: (item.Mkbs ?? []).map((m) => m.MkbCode).join(", "),
    developers: (item.Developers ?? []).map((d) => d.NkoName).filter(Boolean),
    ageCategory: item.AgeCategoryStr,
    publishDate: item.PublishDateStr,
    npcApproved: Boolean(item.NPC_approved),
    url: clinrecUrl(item.CodeVersion),
    pdfUrl: clinrecPdfUrl(item.CodeVersion),
    relevanceScore: selected.length > 0
      ? Math.min(1, 0.4 + (selected[0]._scoreRaw ?? 0.3) * 0.5 + (item.NPC_approved ? 0.05 : 0))
      : 0.4,
    sectionsCount: sections.length,
    fragmentsScanned: scanned,
    fragments: selected.map(({ _scoreRaw, ...f }) => {
      void _scoreRaw;
      return f;
    }),
  };
}

// ---------------------------------------------------------------------------
// Поиск КР по теме (многошаговая стратегия)
// ---------------------------------------------------------------------------

/** Оценивает релевантность карточки КР терминам темы (для сортировки карточек). */
function scoreListItem(
  item: ClinrecListItem,
  terms: string[],
  ageHint: 0 | 1 | 2 = 0,
  topicDigits: string[] = [],
): number {
  const nameLower = item.Name.toLowerCase();
  const haystack = `${item.Name} ${(item.Mkbs ?? []).map((m) => `${m.MkbCode} ${m.MkbName}`).join(" ")}`.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    const term = t.toLowerCase();
    if (term.length < 3) continue;
    // Морфология: «гипертензии» → основа «гипертенз» матчит «гипертензия»
    const stem = stemLite(term);
    if (haystack.includes(term) || (stem.length >= 4 && haystack.includes(stem))) hits++;
  }
  const base = terms.length > 0 ? hits / terms.length : 0.5;
  // Возрастной контекст темы: «…у взрослых» поднимает взрослые КР и
  // опускает детские (и наоборот)
  let ageBoost = 0;
  if (ageHint === 2) {
    if (nameLower.includes("взросл")) ageBoost = 0.2;
    else if (nameLower.includes("дет")) ageBoost = -0.25;
  } else if (ageHint === 1) {
    if (nameLower.includes("дет") || nameLower.includes("новорожд")) ageBoost = 0.2;
    else if (nameLower.includes("взросл")) ageBoost = -0.25;
  }
  // Числовой контекст: «диабет 2 типа» ≠ «диабет 1 типа». Если в теме есть
  // число и в названии КР — другое число, это ДРУГАЯ нозология → штраф.
  let digitBoost = 0;
  if (topicDigits.length > 0) {
    const nameDigits = nameLower.match(/\d+/g) ?? [];
    if (nameDigits.length > 0) {
      if (nameDigits.some((nd) => topicDigits.includes(nd))) digitBoost = 0.1;
      else digitBoost = -0.18;
    }
  }
  return Math.max(0.05, Math.min(1, 0.4 + base * 0.55 + ageBoost + digitBoost + (item.NPC_approved ? 0.05 : 0)));
}
/**
 * Ищет КР в репозитории по теме с учётом русской морфологии.
 *
 * API Минздрава ищет ПОДСТРОКУ в названии КР, а тема приходит в произвольной
 * грамматической форме («тактика лечения артериальной гипертензии» ≠ название
 * «Артериальная гипертензия у взрослых»). Поэтому стратегия многошаговая:
 *   Шаг 1: полная тема (если встречается в названии дословно)
 *   Шаг 2: отдельные термины целиком (до 4, начиная с самых длинных)
 *   Шаг 3: основы терминов (стемы: «гипертензии» → «гипертенз» — совпадает
 *          с «гипертензия» как подстрока в названии КР)
 *   Шаг 4: фильтр по МКБ-10 (если задан)
 * Результаты объединяются с дедупликацией по CodeVersion.
 */
/**
 * Синонимы основ: тема может использовать разговорный термин, а КР —
 * официальный («гипертония» в вопросе vs «гипертензия» в названии КР).
 * Ключ — основа слова после stemLite.
 */
const STEM_SYNONYMS: Record<string, string[]> = {
  гипертенз: ["гипертон"],
  гипертон: ["гипертенз"],
  хсн: ["сердечная недостаточность"],
  недостаточност: ["хсн"],
};

async function searchClinrecsByTopic(
  topic: string,
  terms: string[],
  icd10Codes: string[],
  ageCategory: number | null | undefined,
  maxResults: number,
  ageHint: 0 | 1 | 2 = 0,
  topicDigits: string[] = [],
): Promise<ClinrecListItem[]> {
  const merged = new Map<string, ClinrecListItem>();

  // Термины по убыванию длины — самые специфичные в первую очередь
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

  const runSearch = async (query: string, pageSize?: number) => {
    const r = await searchClinrecs({
      query,
      mkbCodes: icd10Codes.length > 0 ? icd10Codes : undefined,
      ageCategory: ageCategory ?? undefined,
      pageSize: pageSize ?? maxResults,
    });
    if (!r.error) {
      for (const item of r.items) {
        if (!merged.has(item.CodeVersion)) merged.set(item.CodeVersion, item);
      }
    }
    return !r.error && r.items.length > 0;
  };

  // Шаг 1: полная тема (дословное вхождение в название КР)
  if (topic.trim().length >= 4) {
    await runSearch(topic.trim().slice(0, 120));
  }

  // Шаг 2+3: для каждого значимого термина (самые длинные = самые
  // специфичные первыми) пробуем ЦЕЛОЕ СЛОВО, а затем его ОСНОВУ (стем).
  // Морфология: «гипертензии» не совпадает с «гипертензия» как подстрока,
  // но основа «гипертенз» — совпадает. Пробуем все топ-термины (не
  // останавливаемся на первом совпадении): скоринг scoreListItem ниже
  // отдаст приоритет КР, в названии которой совпало БОЛЬШЕ терминов темы.
  if (merged.size === 0) {
    const significant = sortedTerms.filter((t) => t.length >= 4).slice(0, 5);
    for (const t of significant) {
      // 2а. Целое слово
      const foundFull = await runSearch(t, Math.max(3, Math.ceil(maxResults / 2)));
      // 2б. Основа слова (если целое не нашло совпадений)
      if (!foundFull) {
        const stem = stemLite(t);
        if (stem.length >= 4 && stem !== t) {
          // Основ может быть много совпадений («артериальн…» — десятки КР):
          // берём широкую страницу, финальный отбор сделает скоринг
          await runSearch(stem, Math.max(8, maxResults * 2));
          // Синонимы («гипертония» в теме → «гипертензия» в названии КР)
          for (const syn of STEM_SYNONYMS[stem] ?? []) {
            await runSearch(syn, Math.max(6, maxResults));
          }
        }
      }
    }
  }

  // Шаг 4: фильтр по МКБ-10 (если задан)
  if (merged.size === 0 && icd10Codes.length > 0) {
    await runSearch("");
  }

  const items = [...merged.values()];
  // Сортировка: релевантность терминам (+возрастной и числовой контекст) → свежесть
  items.sort((a, b) => {
    const s =
      scoreListItem(b, terms, ageHint, topicDigits) -
      scoreListItem(a, terms, ageHint, topicDigits);
    if (Math.abs(s) > 0.001) return s;
    return (b.PublishDateStr ?? "").localeCompare(a.PublishDateStr ?? "");
  });
  return items.slice(0, Math.max(maxResults, 6));
}

// ---------------------------------------------------------------------------
// ГЛАВНАЯ ФУНКЦИЯ: прямой разбор репозитория по теме
// ---------------------------------------------------------------------------

/**
 * ИИ НАПРЯМУЮ подключается к репозиторию КР Минздрава и разбирает его по теме.
 *
 * @param topic       тема (диагноз/вопрос), напр. «тактика лечения артериальной гипертензии»
 * @param opts.icd10Codes  коды МКБ-10 для уточнения
 * @param opts.focus  фокус (diagnostics/therapy/general; auto если не задан)
 */
export async function parseClinrecsByTopic(
  topic: string,
  opts: TopicParseOptions = {},
): Promise<TopicRagResult> {
  const {
    icd10Codes = [],
    focus: focusOpt,
    maxClinrecs = 3,
    maxFragmentsPerClinrec = 5,
    maxTotalChars = 12000,
    ageCategory = null,
  } = opts;

  const fetchedAt = new Date().toISOString();

  if (!MINZDRAV_ENABLED) {
    return {
      topic,
      terms: [],
      matches: [],
      context: "",
      error: "Поиск в репозитории Минздрава отключён (MINZDRAV_CR_ENABLED=false).",
      fromCache: false,
      fetchedAt,
    };
  }

  const { topic: normalized, terms, focus: autoFocus, ageHint } = normalizeTopic(topic);
  const focus = focusOpt ?? autoFocus;

  if (terms.length === 0 && icd10Codes.length === 0) {
    return {
      topic: normalized,
      terms: [],
      matches: [],
      context: "",
      error: "Не извлечено клинических терминов из темы запроса.",
      fromCache: false,
      fetchedAt,
    };
  }

  // Валидные МКБ-10 коды (буква + 2 цифры)
  const mkbFilter = icd10Codes
    .filter((c) => /^[A-TV-Z][0-9]{2}/i.test(c.trim()))
    .map((c) => c.trim().toUpperCase())
    .slice(0, 5);

  logger.info("minzdrav-rag", "Прямой разбор репозитория КР Минздрава по теме", {
    topic: normalized.slice(0, 80),
    terms: terms.slice(0, 8),
    focus,
    mkbFilter,
    maxClinrecs,
  });

  // 1. Поиск КР в репозитории (возрастной и числовой контекст темы —
  //    в скоринге: «диабет 2 типа» ≠ «диабет 1 типа»)
  const topicDigits = (normalized.match(/\d+/g) ?? []).slice(0, 3);
  const items = await searchClinrecsByTopic(
    normalized,
    terms,
    mkbFilter,
    ageCategory,
    Math.max(maxClinrecs, 4),
    ageHint,
    topicDigits,
  );

  if (items.length === 0) {
    return {
      topic: normalized,
      terms,
      matches: [],
      context: "",
      error:
        "В официальном репозитории Минздрава РФ (cr.minzdrav.gov.ru) не найдено клинических рекомендаций по данной теме.",
      fromCache: false,
      fetchedAt,
    };
  }

  // 2-4. Полный разбор топ-N КР (параллельно)
  const top = items.slice(0, maxClinrecs);
  const parsed = await Promise.all(
    top.map((item) =>
      parseClinrecByTopic(item, terms, focus, maxFragmentsPerClinrec).catch(() => null),
    ),
  );
  const matches = parsed.filter((m): m is ClinrecRagMatch => m !== null);

  if (matches.length === 0) {
    return {
      topic: normalized,
      terms,
      matches: [],
      context: "",
      error: "Не удалось загрузить и разобрать полные тексты КР из репозитория Минздрава.",
      fromCache: false,
      fetchedAt,
    };
  }

  // 5. Контекст для LLM с соблюдением общего бюджета символов
  const context = buildTopicContext(matches, terms, focus, maxTotalChars);

  const totalFragments = matches.reduce((s, m) => s + m.fragments.length, 0);
  logger.info("minzdrav-rag", "Разбор репозитория по теме завершён", {
    topic: normalized.slice(0, 60),
    clinrecs: matches.map((m) => m.codeVersion).join(", "),
    fragments: totalFragments,
    contextChars: context.length,
  });

  return {
    topic: normalized,
    terms,
    matches,
    context,
    fromCache: false, // персистентный кэш прозрачен — данные всегда актуальны в пределах TTL
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Построение контекста для LLM
// ---------------------------------------------------------------------------

/**
 * Строит компактный контекст для промпта LLM из разобранных КР.
 * Каждый фрагмент маркирован типом раздела и ссылкой на официальный источник.
 */
export function buildTopicContext(
  matches: ClinrecRagMatch[],
  terms: string[],
  focus: "diagnostics" | "therapy" | "general",
  maxTotalChars = 12000,
): string {
  if (matches.length === 0) return "";

  const parts: string[] = [];
  parts.push("=== ОФИЦИАЛЬНЫЕ КЛИНИЧЕСКИЕ РЕКОМЕНДАЦИИ МИНЗДРАВА РФ (ПО ТЕМЕ ЗАПРОСА) ===");
  parts.push(
    `Тема запроса: ${terms.length > 0 ? terms.join(", ") : "—"} (фокус: ${
      focus === "diagnostics" ? "диагностика" : focus === "therapy" ? "лечение" : "общий"
    }).`,
  );
  parts.push("Источник: репозиторий клинических рекомендаций Минздрава России — cr.minzdrav.gov.ru.");
  parts.push("ВНИМАНИЕ: ниже — УТВЕРЖДЁННЫЕ клинические рекомендации Минздрава РФ, разобранные");
  parts.push("ИИ напрямую из официального репозитория по теме запроса. Формулируя диагностику и");
  parts.push("лечение, ОБЯЗАТЕЛЬНО опирайся на эти фрагменты; указывай код КР (например, 62_3).");
  parts.push("");

  let used = parts.join("\n").length;
  const PER_CLINREC_BUDGET = Math.floor(maxTotalChars / Math.max(matches.length, 1));

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const header: string[] = [];
    header.push(`[КР Минздрава РФ #${i + 1}] ${m.name}`);
    header.push(
      `Код/версия: ${m.codeVersion}; МКБ-10: ${m.mkbString || "—"}; ` +
        `Возрастная категория: ${m.ageCategory}; Утверждена НПС: ${m.npcApproved ? "да" : "нет"}` +
        (m.publishDate ? `; Дата размещения: ${m.publishDate.slice(0, 10)}` : ""),
    );
    if (m.developers.length > 0) {
      header.push(`Разработчики: ${m.developers.slice(0, 3).join("; ")}`);
    }
    header.push(`Официальный источник: ${m.url}`);
    header.push("");

    let block = header.join("\n");
    const fragmentsTexts: string[] = [];
    let fragBudget = Math.max(PER_CLINREC_BUDGET - block.length, 800);

    for (const f of m.fragments) {
      const label = SECTION_KIND_LABELS[f.sectionKind];
      const piece = `— Из раздела «${f.sectionTitle}» (${label}; релевантность ${(f.score * 100).toFixed(0)}%):\n${f.text}`;
      if (fragmentsTexts.join("\n\n").length + piece.length > fragBudget) break;
      fragmentsTexts.push(piece);
    }
    block += fragmentsTexts.join("\n\n");

    if (used + block.length > maxTotalChars + 1500) break; // жёсткий предел
    parts.push(block);
    used += block.length;
  }

  parts.push("=== КОНЕЦ ОФИЦИАЛЬНЫХ КР МИНЗДРАВА РФ ===");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Экспорт-хелперы для UI и маршрутов
// ---------------------------------------------------------------------------

/** Сводка разобранных КР для отображения в UI (чат, анализ). */
export function ragMatchesToSummary(
  matches: ClinrecRagMatch[],
): Array<{ codeVersion: string; name: string; url: string; fragmentsCount: number; mkbString: string }> {
  return matches.map((m) => ({
    codeVersion: m.codeVersion,
    name: m.name,
    url: m.url,
    fragmentsCount: m.fragments.length,
    mkbString: m.mkbString,
  }));
}
