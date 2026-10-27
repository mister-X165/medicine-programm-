// СППВР v4.2 — RAG: ПРЯМОЙ РАЗБОР РЕПОЗИТОРИЯ КР МИНЗДРАВА РФ ПО ТЕМЕ
// ============================================================================
// v4.2 REWORK: RAG переписан под требование прямого подключения ИИ к
// официальному репозиторию клинических рекомендаций Минздрава РФ
// (cr.minzdrav.gov.ru / apicr.minzdrav.gov.ru). Поиск рекомендаций теперь
// работает так:
//
//   тема (диагноз/выписка + гены) → parseClinrecsByTopic() из minzdrav-rag
//     [ПОИСК КР в репозитории → ПОЛНЫЕ ТЕКСТЫ → ПАРСИНГ ВСЕХ РАЗДЕЛОВ →
//      РАНЖИРОВАНИЕ ФРАГМЕНТОВ ПО ТЕМЕ] → Recommendation[]
//
// Локальная таблица ClinicalRecommendation (демо-данные) используется ТОЛЬКО
// как офлайн-фолбэк, когда репозиторий Минздрава недоступен и персистентный
// кэш пуст. DDI-проверка, сопоставление клинических путей и ICD-10-суггестия
// сохранены без изменений.
// ============================================================================

import { db } from "./db";
import { llmChat, parseJSON } from "./ai-service";
import { logger } from "./logger";
import { checkNetwork } from "./network-health";
import { parseClinrecsByTopic, SECTION_KIND_LABELS } from "./minzdrav-rag";
import { checkDDIOnline, checkLocalInteractions, normalizeMedications } from "./ddi-online";
import { sanitizeCaseForQuery } from "./query-sanitizer";
import type { Mutation, Recommendation, Entity, ICD10CodeMatch, DDIAlert, ClinicalPathwayMatch } from "./types";

/**
 * ГЛАВНАЯ функция RAG: ИИ напрямую подключается к репозиторию КР Минздрава
 * и разбирает его по теме (диагноз из выписки/подсказки + гены из мутаций).
 *
 * Возвращает рекомендации, собранные из официальных КР Минздрава РФ:
 *   • title     — название КР (напр. «Артериальная гипертензия у взрослых»)
 *   • id        — код/версия КР в репозитории (напр. «62_3»)
 *   • content   — фрагменты КР, отобранные ИИ по теме (диагностика/лечение/…)
 *   • source    — официальная ссылка cr.minzdrav.gov.ru/view-cr/{code}
 *   • evidence  — «A» (одобрена НПС Минздрава) / «B»
 *
 * Офлайн-фолбэк: если репозиторий недоступен и кэш пуст — локальная база.
 */
export async function searchRecommendations(
  mutations: Mutation[],
  queryText?: string,
): Promise<Recommendation[]> {
  // 1. Санитизация запроса (PHI исключается ДО выхода в сеть) — затем
  // формируем тему для разбора репозитория Минздрава. См. web-rag.ts.
  // v4.2.1 FIX (audit 6-c / C-1): previously the raw queryText was
  // forwarded straight to apicr.minzdrav.gov.ru, leaking patient PHI.
  const sanitized = sanitizeCaseForQuery({
    dischargeSummary: queryText,
    mutations,
  });
  if (sanitized.removedPHI.length > 0) {
    logger.warn("rag", "PHI stripped before Минздрав repository search", {
      removed: sanitized.removedPHI.length,
    });
  }

  const genes = mutations
    .map((m) => m.gene?.trim())
    .filter((g): g is string => Boolean(g && g.length >= 2))
    .slice(0, 3);

  // Тема: санитизированный запрос (клинические термины, гены, МКБ-коды).
  // Если санитизация ничего не извлекла — fallback на локальную базу
  // (searchRecommendationsLocal) ниже по потоку.
  const sanitizedBase = sanitized.query.slice(0, 300);
  const topic = genes.length > 0
    ? `${sanitizedBase} ${genes.join(" ")}`.trim()
    : sanitizedBase;

  // 2. Прямой разбор репозитория Минздрава по теме
  if (topic.length >= 3) {
    try {
      // МКБ-коды в тексте темы — точный путь к КР
      const icd10InTopic = (topic.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,2})?/g) ?? []).slice(0, 3);

      const rag = await parseClinrecsByTopic(topic, {
        icd10Codes: icd10InTopic,
        maxClinrecs: 4,
        maxFragmentsPerClinrec: 5,
        maxTotalChars: 14000,
      });

      if (rag.matches.length > 0) {
        const recommendations: Recommendation[] = rag.matches.map((m) => {
          const content =
            m.fragments.length > 0
              ? m.fragments
                  .map(
                    (f) =>
                      `【${f.sectionTitle} — ${SECTION_KIND_LABELS[f.sectionKind]}】\n${f.text}`,
                  )
                  .join("\n\n")
              : `Клиническая рекомендация Минздрава РФ (код ${m.codeVersion}). ` +
                `МКБ-10: ${m.mkbString || "—"}. Полный текст: ${m.url}`;
          return {
            id: m.codeVersion,
            title: `${m.name} (КР Минздрава ${m.codeVersion})`,
            category: "КР Минздрава РФ",
            content,
            source: m.url,
            evidenceLevel: m.npcApproved ? "A" : "B",
            relevanceScore: m.relevanceScore,
          };
        });

        logger.info("rag", "RAG: рекомендации разобраны ИИ напрямую из репозитория Минздрава", {
          topic: topic.slice(0, 60),
          clinrecs: rag.matches.map((m) => m.codeVersion).join(", "),
          fragments: rag.matches.reduce((s, m) => s + m.fragments.length, 0),
        });
        return recommendations;
      }

      // 3. По теме ничего не найдено — проверяем, был ли это офлайн-сбой
      //    (тогда фолбэк на локальную базу уместен) или действительно «нет КР»
      const online = await checkNetwork();
      if (online && !rag.error?.includes("не найдено")) {
        // Сеть есть, но разбор не удался по другой причине — пробуем фолбэк
        logger.warn("rag", "Прямой разбор Минздрава не дал результата, фолбэк на локальную базу", {
          error: rag.error,
        });
      } else if (online) {
        // В репозитории действительно нет КР по теме — локальная база может
        // знать смежные демо-рекомендации (напр., фармакогеномика)
        logger.info("rag", "В репозитории Минздрава нет КР по теме — проверяем локальную базу", {
          topic: topic.slice(0, 60),
        });
      }
    } catch (e) {
      logger.warn("rag", "Ошибка прямого разбора Минздрава, фолбэк на локальную базу", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 4. Офлайн-фолбэк: локальная таблица ClinicalRecommendation (демо-данные)
  return searchRecommendationsLocal(mutations, queryText);
}

/**
 * Локальный (офлайн) подбор рекомендаций по таблице ClinicalRecommendation.
 * Используется ТОЛЬКО когда репозиторий Минздрава недоступен и кэш пуст.
 */
async function searchRecommendationsLocal(
  mutations: Mutation[],
  queryText?: string,
): Promise<Recommendation[]> {
  const allRecs = await db.clinicalRecommendation.findMany();
  const results: Recommendation[] = [];

  for (const rec of allRecs) {
    let score = 0;
    let matched = false;

    // 1. Точное совпадение по гену
    if (rec.gene) {
      const recGene = rec.gene.toUpperCase();
      for (const m of mutations) {
        // v2.3.1 FIX: guard against null/undefined gene/variant/interpretation
        // (LLM-extracted mutations may have missing fields)
        const mGene = m.gene?.trim()?.toUpperCase();
        if (!mGene) continue;
        if (mGene === recGene) {
          score += 0.6;
          matched = true;
          // Бонус за совпадение мутации
          if (rec.mutation && m.variant) {
            const recMut = rec.mutation.toLowerCase();
            const varLower = (m.variant ?? "").toLowerCase();
            if (recMut.includes(varLower) || varLower.includes(recMut)) {
              score += 0.3;
            }
          }
        }
      }
    }

    // 2. Совпадение по ключевым словам в тексте запроса
    if (queryText) {
      const qLower = queryText.toLowerCase();
      const keywords = rec.keywords
        .split(/[,;]/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      for (const kw of keywords) {
        if (kw && qLower.includes(kw)) {
          score += 0.15;
          matched = true;
        }
      }
      // Также ищем ген в тексте запроса
      if (rec.gene) {
        const geneLower = rec.gene.toLowerCase();
        if (geneLower.length <= 4) {
          const geneRegex = new RegExp(
            `(?<![a-zа-яё0-9])${geneLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zа-яё0-9])`,
            "i",
          );
          if (geneRegex.test(queryText)) {
            score += 0.2;
            matched = true;
          }
        } else {
          if (qLower.includes(geneLower)) {
            score += 0.2;
            matched = true;
          }
        }
      }
    }

    // 2b. v2.4.3: Если ключевые слова не сматчились, попробуем найти слова из
    // заголовка рекомендации в тексте запроса. Это помогает, когда диагноз
    // в выписке не точно совпадает с ключевыми словами, но содержит те же
    // термины (напр. "сахарный диабет" в заголовке и выписке).
    if (!matched && queryText && rec.title) {
      const qLower = queryText.toLowerCase();
      const titleWords = rec.title.toLowerCase()
        .split(/[\s,;:.\-()\/]+/)
        .filter((w) => w.length >= 4 && !["тип", "при", "для", "или", "and", "the", "with"].includes(w));
      let titleMatchCount = 0;
      for (const w of titleWords) {
        if (qLower.includes(w)) {
          titleMatchCount++;
        }
      }
      if (titleMatchCount >= 2) {
        score += Math.min(titleMatchCount * 0.1, 0.3);
        matched = true;
      }
    }

    // 2c. v2.4.3: Если до сих пор не сматчилось, попробуем найти слова из
    // запроса в содержании рекомендации (обратный поиск).
    if (!matched && queryText && rec.content) {
      const qLower = queryText.toLowerCase();
      const contentLower = rec.content.toLowerCase();
      // Извлекаем значимые слова из запроса (длиной >= 5 символов)
      const queryWords = qLower
        .split(/[\s,;:.\-()\/]+/)
        .filter((w) => w.length >= 5 && !["пациент", "назнач", "терапия", "лечение"].includes(w));
      let contentMatchCount = 0;
      for (const w of queryWords) {
        if (contentLower.includes(w)) {
          contentMatchCount++;
        }
      }
      if (contentMatchCount >= 2) {
        score += Math.min(contentMatchCount * 0.08, 0.25);
        matched = true;
      }
    }

    // 3. Совпадение по гену в mutation.interpretation
    // v2.3.1 FIX: для коротких генов используем word-boundary match (как в п.2),
    // чтобы "AR" не матчило "cardiac" в interpretation тексте.
    if (!matched && rec.gene) {
      const recGeneUpper = rec.gene.toUpperCase();
      const recGeneLower = rec.gene.toLowerCase();
      for (const m of mutations) {
        const interp = m.interpretation;
        if (!interp) continue; // guard against null/undefined
        let geneFound = false;
        if (recGeneLower.length <= 4) {
          // Word-boundary match для коротких генов
          const geneRegex = new RegExp(
            `(?<![a-zа-яё0-9])${recGeneLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zа-яё0-9])`,
            "i",
          );
          geneFound = geneRegex.test(interp);
        } else {
          // Substring match для длинных генов
          geneFound = interp.toUpperCase().includes(recGeneUpper);
        }
        if (geneFound) {
          score += 0.3;
          matched = true;
          break; // достаточно одного совпадения
        }
      }
    }

    if (matched && score > 0) {
      results.push({
        id: rec.id,
        title: rec.title,
        category: rec.category,
        gene: rec.gene ?? undefined,
        mutation: rec.mutation ?? undefined,
        content: rec.content,
        source: rec.source,
        evidenceLevel: rec.evidenceLevel ?? undefined,
        relevanceScore: Math.min(score, 1),
      });
    }
  }

  // Сортировка по релевантности
  return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Кросс-проверка противопоказаний к таргетной терапии (ТЗ п. 2.2).
 * Выявляет потенциальные конфликты между мутациями и рекомендациями.
 */
export async function crossCheckTherapy(
  mutations: Mutation[],
  recommendations: Recommendation[],
): Promise<
  Array<{
    type: "warning" | "contraindication" | "adjustment";
    gene: string;
    message: string;
    recommendationId?: string;
  }>
> {
  const warnings: Array<{
    type: "warning" | "contraindication" | "adjustment";
    gene: string;
    message: string;
    recommendationId?: string;
  }> = [];

  // Примеры правил кросс-проверки
  // v2.3.1 FIX: guard against null/undefined gene/variant/interpretation
  // (LLM-extracted mutations may have missing fields)
  for (const m of mutations) {
    const gene = m.gene?.trim()?.toUpperCase();
    if (!gene) continue;
    const interp = m.interpretation ?? "";
    const clinSig = m.clinicalSignificance ?? "";
    const variant = m.variant ?? "";
    // CYP2D6 poor metabolizer + тамоксифен
    if (
      gene === "CYP2D6" &&
      /poor|плохой|низк/i.test(interp)
    ) {
      warnings.push({
        type: "contraindication",
        gene: m.gene,
        message:
          "CYP2D6 poor metabolizer: снижена активация тамоксифена. Рассмотреть альтернативную эндокринную терапию (ингибиторы ароматазы).",
      });
    }
    // DPYD variant + 5-FU
    if (gene === "DPYD" && /pathogen|патоген/i.test(clinSig)) {
      warnings.push({
        type: "contraindication",
        gene: m.gene,
        message:
          "DPYD вариант: высокий риск тяжёлой токсичности при назначении 5-фторурацила/капецитабина. Снижение дозы или отмена.",
      });
    }
    // HLA-B*57:01 + абакавир
    if (gene === "HLA-B" && /57:01|5701/i.test(variant)) {
      warnings.push({
        type: "contraindication",
        gene: m.gene,
        message:
          "HLA-B*57:01 позитивный: АБСОЛЮТНО противопоказан абакавир (риск тяжёлой реакции гиперчувствительности).",
      });
    }
    // TPMT variant + тиопурины
    if (
      (gene === "TPMT" || gene === "NUDT15") &&
      /pathogen|патоген|low|низк/i.test(clinSig + " " + interp)
    ) {
      warnings.push({
        type: "adjustment",
        gene: m.gene,
        message:
          "TPMT/NUDT15 вариант: риск миелосупрессии при назначении тиопуринов. Значительное снижение стартовой дозы.",
      });
    }
  }

  // Связать с рекомендациями
  for (const w of warnings) {
    const rec = recommendations.find((r) => r.gene?.toUpperCase() === w.gene.toUpperCase());
    if (rec) w.recommendationId = rec.id;
  }

  return warnings;
}

// ============================================================================
// NEW v2.0: Drug-Drug Interaction (DDI) Check
// v5.0: ПЕРЕСМОТР ОЦЕНКИ — парная проверка выполняется движком ПОТОКОВОГО
// ОНЛАЙН-ПОИСКА в базах данных РФ (ddi-online.ts): нормализация МНН →
// локальная таблица → веб-поиск РЛС/Видаль/ГРЛС/КР Минздрава → LLM-извлечение
// → кэш 7 дней. Фармакогеномные проверки (мутации + препараты) сохранены.
// ============================================================================

/**
 * Проверка лекарственных взаимодействий (DDI).
 * v5.0: пары препаратов проверяются ПОТОКОВЫМ ОНЛАЙН-ПОИСКОМ в базах РФ
 * (РЛС, Видаль, ГРЛС, КР Минздрава) через движок ddi-online с кэшированием;
 * фармакогеномные мутации учитываются локальными правилами.
 *
 * Возвращает массив DDIAlert для обнаруженных взаимодействий.
 */
export async function checkDrugInteractions(
  medications: string[],
  mutations: Mutation[],
): Promise<DDIAlert[]> {
  const alerts: DDIAlert[] = [];

  if (medications.length < 2 && mutations.length === 0) {
    return alerts;
  }

  // 1. v5.0: ПОТОКОВЫЙ ОНЛАЙН-ПОИСК парных взаимодействий в базах РФ
  //    (внутри: нормализация МНН + локальная таблица + онлайн + кэш).
  //    Не-потоковый режим движка — для JSON-ответа анализа.
  try {
    const onlineResult = await checkDDIOnline(
      medications,
      medications.length >= 2,
    );
    for (const a of onlineResult.alerts) {
      // Источник: база + ссылки, без дублирования названий
      const labels = (a.sourceUrls ?? [])
        .map((s) => s.label)
        .filter((label) => !a.source.includes(label));
      const sourceLabel = labels.length > 0
        ? `${a.source} (${labels.join(", ")})`
        : a.source;
      alerts.push({
        drug1: a.drug1,
        drug2: a.drug2,
        severity: a.severity,
        description: a.description,
        mechanism: a.mechanism,
        management: a.management,
        evidenceLevel: a.evidenceLevel,
        source: sourceLabel,
      });
    }
  } catch (e) {
    logger.warn("analysis", "DDI check: онлайн-движок недоступен, фолбэк на локальную базу", {
      error: e instanceof Error ? e.message : String(e),
    });
    try {
      const localOnly = await checkLocalInteractions(normalizeMedications(medications));
      alerts.push(...localOnly);
    } catch (e2) {
      logger.warn("analysis", "DDI check: не удалось прочитать базу взаимодействий", {
        error: e2 instanceof Error ? e2.message : String(e2),
      });
    }
  }

  // 2. Фармакогеномные взаимодействия (мутации + препараты)
  // v2.3.1 FIX: guard against null/undefined fields
  for (const m of mutations) {
    const gene = m.gene?.trim()?.toUpperCase();
    if (!gene) continue;
    const interp = m.interpretation ?? "";
    const clinSig = m.clinicalSignificance ?? "";

    // CYP2D6 + тамоксифен
    if (gene === "CYP2D6" && /poor|плохой|низк/i.test(interp)) {
      const tamoxifenPresent = medications.some((med) =>
        /тамоксифен|tamoxifen/i.test(med ?? ""),
      );
      if (tamoxifenPresent) {
        alerts.push({
          drug1: "Тамоксифен",
          drug2: "CYP2D6 (фенотип PM)",
          severity: "major",
          description: "Сниженная активация тамоксифена у бедных метаболизаторов CYP2D6. Образование активного метаболита эндоксифена значительно снижено.",
          mechanism: "CYP2D6 катализирует превращение тамоксифена в эндоксифен. При фенотипе PM образование активного метаболита снижено на 50-75%.",
          management: "Рассмотреть замену тамоксифена на ингибитор ароматазы (летрозол, анастрозол) с подавлением функции яичников. При невозможности — усиленный мониторинг.",
          evidenceLevel: "A",
          source: "CPIC Guideline for CYP2D6 and Tamoxifen (2019)",
        });
      }
    }

    // DPYD + фторпиримидины
    if (gene === "DPYD" && /pathogen|патоген/i.test(clinSig)) {
      const fluoropyrimidinePresent = medications.some((med) =>
        /фторурацил|5-FU|капецитабин|тегафур|capecitabine|fluorouracil/i.test(med ?? ""),
      );
      if (fluoropyrimidinePresent) {
        alerts.push({
          drug1: "Фторпиримидин",
          drug2: "DPYD (патогенный вариант)",
          severity: "contraindication",
          description: "Абсолютное противопоказание: DPYD вариант ассоциирован с 4-25-кратным увеличением риска тяжёлой токсичности, в т.ч. летальной.",
          mechanism: "DPD (фермент продукта гена DPYD) метаболизирует фторпиримидины. При недостаточности — накопление токсичных метаболитов.",
          management: "Полная недостаточность — отмена фторпиримидинов, альтернативный режим. Частичная — снижение дозы на 25-50% с титрованием.",
          evidenceLevel: "A",
          source: "CPIC Guideline for DPYD and Fluoropyrimidines (2022); EMA 2020",
        });
      }
    }

    // CYP2C19 + клопидогрел
    if (gene === "CYP2C19" && /poor|плохой|низк/i.test(interp)) {
      const clopidogrelPresent = medications.some((med) =>
        /клопидогрел|clopidogrel|плавикс/i.test(med ?? ""),
      );
      if (clopidogrelPresent) {
        alerts.push({
          drug1: "Клопидогрел",
          drug2: "CYP2C19 (фенотип PM)",
          severity: "major",
          description: "Сниженная активация клопидогрела у бедных метаболизаторов CYP2C19. Высокий риск тромбоза стента.",
          mechanism: "CYP2C19 необходим для превращения клопидогрела в активный метаболит. При фенотипе PM активация снижена.",
          management: "Замена на тикагрелор (60 мг 2 раза/сутки) или празугрел. У IM — усиленный мониторинг.",
          evidenceLevel: "A",
          source: "CPIC Guideline for CYP2C19 and Clopidogrel (2022)",
        });
      }
    }
  }

  // Сортировка по severity
  const severityOrder: Record<string, number> = {
    contraindication: 4,
    major: 3,
    moderate: 2,
    minor: 1,
  };
  alerts.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0));

  return alerts;
}

// ============================================================================
// NEW v2.0: Clinical Pathway Matching
// ============================================================================

/**
 * Сопоставление клинических путей (clinical pathways) с диагнозом и мутациями.
 * Ищет в базе данных пути, соответствующие:
 *   - ICD-10 кодам
 *   - Диагнозу (по ключевым словам)
 *   - Генетическим мутациям
 *
 * Возвращает массив ClinicalPathwayMatch с оценкой совпадения.
 */
export async function matchClinicalPathways(
  diagnosis: string,
  icd10Codes: ICD10CodeMatch[],
  mutations: Mutation[],
): Promise<ClinicalPathwayMatch[]> {
  const results: ClinicalPathwayMatch[] = [];

  try {
    const allPathways = await db.clinicalPathway.findMany({
      where: { isActive: true },
    });

    for (const pathway of allPathways) {
      let matchScore = 0;
      let matched = false;

      // 1. Точное совпадение по ICD-10 коду
      if (pathway.icd10Code && icd10Codes.length > 0) {
        const pathwayCode = pathway.icd10Code.toUpperCase();
        for (const icd of icd10Codes) {
          const icdCode = icd.code.toUpperCase();
          if (pathwayCode === icdCode) {
            matchScore += 0.7 * icd.confidence;
            matched = true;
          } else if (
            pathwayCode.startsWith(icdCode.slice(0, 3)) ||
            icdCode.startsWith(pathwayCode.slice(0, 3))
          ) {
            // Совпадение по главе/блоку МКБ-10
            matchScore += 0.3 * icd.confidence;
            matched = true;
          }
        }
      }

      // 2. Совпадение по ключевым словам диагноза
      if (diagnosis) {
        const diagLower = diagnosis.toLowerCase();
        const nameLower = pathway.name.toLowerCase();
        const descLower = pathway.description.toLowerCase();

        // Проверяем совпадение слов в названии/описании пути
        const diagWords = diagLower.split(/\s+/).filter((w) => w.length > 3);
        for (const word of diagWords) {
          if (nameLower.includes(word) || descLower.includes(word)) {
            matchScore += 0.15;
            matched = true;
          }
        }
      }

      // 3. Совпадение по мутациям
      // v2.3.1 FIX: guard against null/undefined gene
      if (pathway.name && mutations.length > 0) {
        const pathwayNameLower = pathway.name.toLowerCase();
        const pathwayDescLower = (pathway.description ?? "").toLowerCase();
        for (const m of mutations) {
          const gene = m.gene?.trim()?.toLowerCase();
          if (!gene) continue;
          if (pathwayNameLower.includes(gene) || pathwayDescLower.includes(gene)) {
            matchScore += 0.3;
            matched = true;
          }
        }
      }

      if (matched && matchScore > 0) {
        // Парсим JSON-поля из базы
        let steps: Array<{ order: number; title: string; description: string; duration: string; criteria: string }> = [];
        let medications: string[] = [];
        let monitoring: string[] = [];

        try {
          if (typeof pathway.steps === "string") {
            steps = JSON.parse(pathway.steps);
          } else if (Array.isArray(pathway.steps)) {
            steps = pathway.steps as unknown as typeof steps;
          }
        } catch { /* ignore parse errors */ }

        try {
          if (typeof pathway.medications === "string") {
            medications = JSON.parse(pathway.medications);
          } else if (Array.isArray(pathway.medications)) {
            medications = pathway.medications as unknown as string[];
          }
        } catch { /* ignore parse errors */ }

        try {
          if (typeof pathway.monitoring === "string") {
            monitoring = JSON.parse(pathway.monitoring);
          } else if (Array.isArray(pathway.monitoring)) {
            monitoring = pathway.monitoring as unknown as string[];
          }
        } catch { /* ignore parse errors */ }

        results.push({
          id: pathway.id,
          name: pathway.name,
          icd10Code: pathway.icd10Code,
          category: pathway.category,
          matchScore: Math.min(matchScore, 1),
          steps,
          medications,
          monitoring,
        });
      }
    }
  } catch (e) {
    logger.warn("analysis", "Clinical pathway matching: не удалось прочитать базу путей", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Сортировка по релевантности
  return results.sort((a, b) => b.matchScore - a.matchScore);
}

// ============================================================================
// NEW v2.0: ICD-10 Code Suggestion via LLM
// ============================================================================

/**
 * Суггестия ICD-10 кодов на основе диагноза и извлечённых сущностей.
 * Использует LLM для анализа текста и подборки подходящих кодов МКБ-10.
 * Дополнительно проверяет локальную базу ICD-10 кодов для валидации.
 *
 * Возвращает массив ICD10CodeMatch с оценкой уверенности.
 */
export async function suggestICD10Codes(
  diagnosisText: string,
  entities: Entity[],
): Promise<ICD10CodeMatch[]> {
  if (!diagnosisText && entities.length === 0) {
    return [];
  }

  // Собираем диагнозы из сущностей
  const diagnosisEntities = entities.filter((e) => e.type === "diagnosis");
  const allDiagnoses = [
    diagnosisText,
    ...diagnosisEntities.map((e) => e.value),
  ].filter(Boolean);

  if (allDiagnoses.length === 0) {
    return [];
  }

  const combinedDiagnoses = allDiagnoses.join("; ");

  // 1. LLM-суггестия ICD-10 кодов
  const system = `Ты — медицинский кодировщик МКБ-10. Проанализируй диагноз и подбери подходящие коды МКБ-10 (российская версия).

ПРАВИЛА:
- Указывай коды МКБ-10 в формате буква + 2 цифры + точка + цифры (например, C50.1, I10, E11.9).
- Для каждого кода укажи описание на русском языке.
- Указывай уверенность (confidence) от 0 до 1.
- Не придумывай несуществующие коды.
- Если диагноз неясен — укажи коды с низкой уверенностью.

Верни JSON-массив: [{"code":"C50.1","description":"Рак молочной железы центральной части","confidence":0.9}]`;

  const user = `Диагноз: ${combinedDiagnoses}`;

  let llmSuggestions: ICD10CodeMatch[] = [];

  try {
    const raw = await llmChat(system, user, { json: true, maxTokens: 2048 });
    const parsed = parseJSON<ICD10CodeMatch[]>(raw);
    if (Array.isArray(parsed)) {
      llmSuggestions = parsed
        .filter((s) => s.code && s.description)
        .map((s) => ({
          code: s.code,
          description: s.description,
          confidence: typeof s.confidence === "number" ? Math.min(Math.max(s.confidence, 0), 1) : 0.5,
          source: "ai" as const,
        }));
    }
  } catch (e) {
    logger.warn("analysis", "ICD-10 LLM suggestion error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. Валидация через локальную базу ICD-10 кодов
  let validatedCodes: ICD10CodeMatch[] = [];

  try {
    const allICD10 = await db.iCD10Code.findMany();
    const icd10Map = new Map(allICD10.map((c) => [c.code.toUpperCase(), c]));

    for (const suggestion of llmSuggestions) {
      const codeKey = suggestion.code.toUpperCase();
      const dbRecord = icd10Map.get(codeKey);

      if (dbRecord) {
        // Код найден в базе — обновляем описание на каноническое
        validatedCodes.push({
          ...suggestion,
          description: dbRecord.description || suggestion.description,
        });
      } else {
        // Код не найден в базе — понижаем уверенность
        validatedCodes.push({
          ...suggestion,
          confidence: Math.min(suggestion.confidence, 0.5),
        });
      }
    }

    // 3. Поиск по ключевым словам в базе ICD-10 (для полноты)
    if (allDiagnoses.length > 0) {
      const diagLower = combinedDiagnoses.toLowerCase();
      const diagWords = diagLower.split(/[\s,;]+/).filter((w) => w.length > 3);

      for (const dbCode of allICD10) {
        // Пропускаем, если уже найден через LLM
        if (validatedCodes.some((c) => c.code.toUpperCase() === dbCode.code.toUpperCase())) {
          continue;
        }

        const descLower = dbCode.description.toLowerCase();
        let matchCount = 0;
        for (const word of diagWords) {
          if (descLower.includes(word)) {
            matchCount++;
          }
        }

        if (matchCount >= 2 || (matchCount >= 1 && diagWords.length <= 2)) {
          validatedCodes.push({
            code: dbCode.code,
            description: dbCode.description,
            confidence: Math.min(0.3 + matchCount * 0.1, 0.7),
            source: "manual",
          });
        }
      }
    }
  } catch (e) {
    logger.warn("analysis", "ICD-10 DB validation error", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Если база недоступна — используем LLM-результаты как есть
    validatedCodes = llmSuggestions;
  }

  // Сортировка по уверенности
  return validatedCodes.sort((a, b) => b.confidence - a.confidence);
}
