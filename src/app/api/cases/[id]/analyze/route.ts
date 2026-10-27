// СППВР v2.0 — Multimodal Analysis Pipeline API
// POST /api/cases/[id]/analyze
// Enhanced 10-step pipeline:
//   0. NEW (v2.1): Consent gate — refuse to run AI analysis unless the case
//      has an active `ai_analysis` consent (ФЗ-152 ст. 5 / ст. 9).
//   1. NER from discharge summaries
//   2. Genetic variant interpretation
//   3. Medical image analysis (VLM)
//   4. RAG recommendation matching
//   5. Pharmacogenomic contraindication cross-check
//   6. DDI check (drug-drug interactions)
//   7. ICD-10 code suggestions
//   8. Clinical pathway matching
//   9. Structured conclusion generation
//  10. Save all results (increment version, save previous to AnalysisVersion)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  llmChat,
  parseJSON,
  getActiveProvider,
} from "@/lib/ai-service";
import {
  extractEntitiesFromDischarge,
  interpretGeneticVariants,
  analyzeMedicalImage,
} from "@/lib/file-parsers";
import { searchRecommendations, crossCheckTherapy, checkDrugInteractions, matchClinicalPathways, suggestICD10Codes } from "@/lib/rag";
import { readFileSync, fileToBase64DataUrl } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { safeJsonParse } from "@/lib/utils";
import { requireAuth } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { findClinrecByMkb } from "@/lib/minzdrav-cr";
import { extractStructuredJson } from "@/lib/structured-extraction";
import { sanitizeClinicalStructure, carryOverDoctorState } from "@/lib/clinical-normalize";
import { auditAnalysis } from "@/lib/clinical-audit";
import type {
  Entity,
  Mutation,
  Citation,
  ConclusionSection,
  DDIAlert,
  ICD10CodeMatch,
  ClinicalPathwayMatch,
  AnalysisStructured,
  DifferentialDiagnosis,
  WorkupItem,
  TherapyOption,
  MonitoringMarker,
  VerificationReport,
  PatientSafetyContext,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// v2.7.2 (audit fix): LLM возвращает clinicalSignificance произвольной строкой —
// нормализуем к строгому union типа Mutation.
const SIGNIFICANCE_VALUES: ReadonlySet<string> = new Set([
  "pathogenic", "likely_pathogenic", "vus", "likely_benign", "benign",
]);
function normalizeSignificance(value: string): Mutation["clinicalSignificance"] {
  const v = (value || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (SIGNIFICANCE_VALUES.has(v)) return v as Mutation["clinicalSignificance"];
  if (v.includes("pathogen")) return "likely_pathogenic";
  if (v.includes("benign")) return "likely_benign";
  return "vus";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  // ─── OUTER TRY/CATCH ──────────────────────────────────────────────────
  // The analysis pipeline has many steps (NER, genetic interpretation, VLM,
  // RAG, DDI, ICD-10, pathways, LLM conclusion). Each step is individually
  // wrapped in try/catch, but this OUTER handler is the last line of defense:
  // if ANY uncaught error bubbles up, we:
  //   1. Reset the case status from "analyzing" back to its previous state
  //      (so it's not stuck in "analyzing" forever).
  //   2. Return a clear 500 error with the error message (not a bare crash).
  //   3. Log the full error + stack for debugging.
  try {
    return await analyzeCase(req, caseId);
  } catch (error) {
    logger.error("analysis", "Unhandled error in analyze pipeline", {
      caseId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Reset case status so it's not stuck in "analyzing"
    try {
      await db.case.update({
        where: { id: caseId },
        data: { status: "uploaded" },
      });
    } catch {
      // ignore — the case might not exist anymore
    }
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      {
        error: `Анализ не удалось завершить: ${msg}. Система восстановлена — случай доступен для повторного анализа.`,
        caseId,
      },
      { status: 500 },
    );
  }
}

async function analyzeCase(req: Request, caseId: string) {
  // ─── Step 0: Authentication + Consent gate (ФЗ-152) ───────────────────
  let session;
  try {
    session = await requireAuth(req);
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const forceManual = body?.manual === true;

  const found = await db.case.findUnique({
    where: { id: caseId },
    include: { documents: true, doctor: true, consents: true },
  });
  if (!found) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Authorization: only the case's owner or an admin may analyze it
  if (found.doctorId !== session.doctorId && session.role !== "admin") {
    return NextResponse.json(
      { error: "You are not authorized to analyze this case" },
      { status: 403 },
    );
  }

  // Consent gate — `ai_analysis` consent must be present, granted, and not
  // expired. In manual mode we still log the attempt but allow it, because
  // no AI processing of PHI occurs.
  const aiConsent = found.consents.find(
    (c) => c.consentType === "ai_analysis" && c.granted,
  );
  const consentExpired =
    aiConsent?.validUntil != null && new Date(aiConsent.validUntil) < new Date();

  if (!aiConsent) {
    return NextResponse.json(
      {
        error:
          "Patient consent for AI analysis is missing. Obtain and record the `ai_analysis` consent before running the analysis pipeline.",
        errorCode: "CONSENT_MISSING",
        consentType: "ai_analysis",
      },
      { status: 403 },
    );
  }
  if (consentExpired) {
    return NextResponse.json(
      {
        error:
          "Patient consent for AI analysis has expired. Re-obtain consent before running the analysis pipeline.",
        errorCode: "CONSENT_EXPIRED",
        consentType: "ai_analysis",
        expiredAt: aiConsent.validUntil,
      },
      { status: 403 },
    );
  }

  const provider = await getActiveProvider();
  const aiAvailable = provider !== "none" && !forceManual;

  await db.case.update({ where: { id: caseId }, data: { status: "analyzing" } });

  const entities: Entity[] = [];
  const mutations: Mutation[] = [];
  const citations: Citation[] = [];
  const imageFindings: Array<{
    documentId: string;
    description: string;
    regionOfInterest?: string;
    measurements?: string;
    suspicion: string;
  }> = [];
  let dischargeSummary = "";
  // v5.2: снапшот данных карты, значимых для детерминированной проверки
  // безопасности назначений (аллергии, активная терапия, почки, беременность).
  let patientSafety: PatientSafetyContext | undefined;

  const discharges = found.documents.filter((d) => d.fileType === "discharge");
  const genetics = found.documents.filter((d) => d.fileType === "genetic");
  const images = found.documents.filter((d) => d.fileType === "image");

  // ─── Step 1: NER from discharge summaries ─────────────────────────────
  for (const doc of discharges) {
    if (aiAvailable) {
      const result = await extractEntitiesFromDischarge(doc.deidContent);
      if (result) {
        for (const e of result.entities) {
          entities.push({ type: e.type as Entity["type"], value: e.value, context: e.context });
          citations.push({
            claim: e.value,
            source: "discharge",
            documentId: doc.id,
            fragment: e.context || doc.deidContent.slice(0, 200),
            location: `Document: ${doc.fileName}`,
          });
        }
        for (const m of result.mutations) {
          mutations.push({
            gene: m.gene,
            variant: m.variant,
            interpretation: m.interpretation,
            clinicalSignificance: normalizeSignificance(m.clinicalSignificance),
          });
        }
        if (result.summary) dischargeSummary += result.summary + "\n\n";
      }
    } else {
      citations.push({
        claim: "Document loaded in manual mode (AI unavailable)",
        source: "discharge",
        documentId: doc.id,
        fragment: doc.deidContent.slice(0, 200),
        location: `Document: ${doc.fileName}`,
      });
    }
  }

  // ─── Step 2: Genetic variant interpretation ───────────────────────────
  for (const doc of genetics) {
    if (aiAvailable) {
      const interp = await interpretGeneticVariants(doc.deidContent);
      if (interp) {
        for (const m of interp) {
          mutations.push(m);
          citations.push({
            claim: `${m.gene}: ${m.variant}`,
            source: "genetic",
            documentId: doc.id,
            fragment: `${m.interpretation} (${m.clinicalSignificance})`,
            location: `Document: ${doc.fileName}`,
          });
        }
      }
    } else {
      try {
        const meta = JSON.parse(doc.extractedMeta);
        if (meta.variants) {
          for (const v of meta.variants) {
            mutations.push({
              gene: v.id || v.chrom || "—",
              variant: `${v.ref}>${v.alt} (pos ${v.pos})`,
              interpretation: "Variant from genetic report (requires manual interpretation)",
              clinicalSignificance: "vus",
            });
          }
        }
      } catch { /* ignore */ }
    }
  }

  // ─── Step 3: Medical image analysis (VLM) ────────────────────────────
  for (const doc of images) {
    if (aiAvailable && doc.storagePath) {
      try {
        const imgBuffer = readFileSync(doc.storagePath);
        if (imgBuffer) {
          const dataUrl = fileToBase64DataUrl(imgBuffer, doc.mimeType);
          const finding = await analyzeMedicalImage(
            dataUrl,
            `${found.diagnosisHint || ""} ${dischargeSummary}`.trim(),
          );
          if (finding) {
            imageFindings.push({
              documentId: doc.id,
              description: finding.findings,
              regionOfInterest: finding.regionOfInterest,
              measurements: finding.measurements,
              suspicion: finding.suspicion,
            });
            citations.push({
              claim: finding.findings.slice(0, 120),
              source: "image",
              documentId: doc.id,
              fragment: `${finding.regionOfInterest}. ${finding.measurements}. Suspicion: ${finding.suspicion}`,
              location: `Image: ${doc.fileName}`,
            });
          }
        }
      } catch (e) {
        logger.error("analysis", "Image analysis error", { error: e instanceof Error ? e.message : String(e) });
      }
    } else if (doc.storagePath) {
      imageFindings.push({
        documentId: doc.id,
        description: "Image loaded (analysis unavailable in manual mode)",
        suspicion: "low",
      });
    }
  }

  // ─── Step 4: RAG — ПРЯМОЙ РАЗБОР РЕПОЗИТОРИЯ КР МИНЗДРАВА ПО ТЕМЕ ────
  // v4.2: searchRecommendations подключается НАПРЯМУЮ к репозиторию КР
  // Минздрава РФ (cr.minzdrav.gov.ru) и разбирает его по теме кейса
  // (диагноз + выписка + гены): поиск КР → полные тексты → парсинг всех
  // разделов → фрагменты, релевантные теме. Локальная база — только офлайн-фолбэк.
  const recommendations = await searchRecommendations(
    mutations,
    `${found.diagnosisHint || ""} ${dischargeSummary}`.trim(),
  );
  for (const r of recommendations.slice(0, 5)) {
    citations.push({
      claim: r.title,
      source: "recommendation",
      documentId: undefined,
      fragment: r.content,
      location: `${r.source} (evidence: ${r.evidenceLevel || "—"})`,
    });
  }

  // ─── Step 4.5: Web RAG — ПРЯМОЙ РАЗБОР КР МИНЗДРАВА ПО ТЕМЕ КЕЙСА ──
  // v4.2: ИИ напрямую подключается к официальному репозиторию КР Минздрава
  // РФ (cr.minzdrav.gov.ru) и разбирает его по теме кейса: поиск КР →
  // полные тексты → парсинг ВСЕХ разделов (диагностика, лечение, алгоритмы
  // Прил. Б, шкалы Прил. Г) → отбор фрагментов, релевантных теме. Запрос
  // санитизируется (PHI исключается) ДО выхода в сеть. Найденные фрагменты
  // подаются LLM в Step 9 и добавляются в цитаты. BEST-EFFORT: при офлайне
  // анализ продолжается с локальной базой (персистентный кэш сохраняет тексты).
  let webRagContext = "";
  let webRagResults: Array<{
    title: string;
    url: string;
    source: string;
    snippet: string;
    relevanceScore: number;
  }> = [];
  try {
    const { runWebRag, buildWebRagContext } = await import("@/lib/web-rag");
    const medicationsForWeb = entities
      .filter((e) => e.type === "medication")
      .map((e) => e.value);
    // ICD-10 подсказки для поиска КР: коды МКБ из сущностей-диагнозов
    // (формат вида E11.9 в значении сущности)
    const icd10Hints = entities
      .filter((e) => e.type === "diagnosis" || e.type === "other")
      .map((e) => e.value)
      .flatMap((v) => (v.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,2})?/g) ?? []))
      .slice(0, 3);
    const webRagResponse = await runWebRag({
      diagnosisHint: found.diagnosisHint,
      dischargeSummary: dischargeSummary.slice(0, 3000),
      mutations,
      medications: medicationsForWeb,
      entities,
      maxResults: 6,
      enableContentFetch: true,
      icd10Codes: icd10Hints,
    });
    webRagResults = webRagResponse.results;
    webRagContext = buildWebRagContext(webRagResponse.results, webRagResponse.sanitizedQuery);

    // Add web RAG results as citations so they appear in the analysis UI.
    // v4.2: дедупликация — рекомендации (Step 4) теперь тоже приходят из
    // репозитория Минздрава; не дублируем цитату уже процитированной КР
    for (const wr of webRagResponse.results) {
      const alreadyCited = citations.some(
        (c) => wr.url && (c.location?.includes(wr.url) || c.claim === wr.title),
      );
      if (alreadyCited) continue;
      citations.push({
        claim: wr.title,
        source: "web_rag",
        documentId: undefined,
        fragment: wr.contentExcerpt || wr.snippet || "",
        location: `${wr.source}: ${wr.url}`,
      });
    }

    logger.info("analysis", "Минздрав КР web RAG completed", {
      caseId,
      resultCount: webRagResponse.results.length,
      termsUsed: webRagResponse.sanitizedQuery.terms,
      removedPHI: webRagResponse.sanitizedQuery.removedPHI.length,
    });
  } catch (e) {
    logger.warn("analysis", "Web RAG failed (non-blocking)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ─── Step 5: Pharmacogenomic contraindication cross-check ─────────────
  const therapyWarnings = await crossCheckTherapy(mutations, recommendations);
  for (const w of therapyWarnings) {
    citations.push({
      claim: w.message,
      source: "recommendation",
      documentId: undefined,
      fragment: `Type: ${w.type === "contraindication" ? "Contraindication" : w.type === "adjustment" ? "Dose adjustment" : "Warning"}`,
      location: `Cross-check: ${w.gene}`,
    });
  }

  // ─── Step 6: NEW — DDI check ──────────────────────────────────────────
  let ddiAlerts: DDIAlert[] = [];
  try {
    // Extract medication names from entities
    const medications = entities
      .filter((e) => e.type === "medication")
      .map((e) => e.value);

    // Also get from discharge summary
    if (dischargeSummary && medications.length === 0) {
      medications.push(...extractMedNamesFromText(dischargeSummary));
    }

    ddiAlerts = await checkDrugInteractions(medications, mutations);
  } catch (e) {
    logger.warn("analysis", "DDI check error", { error: e instanceof Error ? e.message : String(e) });
  }

  // ─── Step 7: NEW — ICD-10 code suggestions ────────────────────────────
  let icd10Suggestions: ICD10CodeMatch[] = [];
  try {
    icd10Suggestions = await suggestICD10Codes(
      found.diagnosisHint || dischargeSummary,
      entities,
    );
  } catch (e) {
    logger.warn("analysis", "ICD-10 suggestion error", { error: e instanceof Error ? e.message : String(e) });
  }

  // ─── Step 8: NEW — Clinical pathway matching ──────────────────────────
  let pathwayMatches: ClinicalPathwayMatch[] = [];
  try {
    pathwayMatches = await matchClinicalPathways(
      found.diagnosisHint || dischargeSummary,
      icd10Suggestions,
      mutations,
    );
  } catch (e) {
    logger.warn("analysis", "Pathway matching error", { error: e instanceof Error ? e.message : String(e) });
  }

  // ─── Step 9: Structured conclusion generation (v5.0) ───────────────────
  // v5.0 REWORK (жалобы пользователя):
  //   • Раньше промпт требовал ОДИН «конкретный диагноз» → модель ставила
  //     единственный диагноз без альтернатив и тут же назначала лечение.
  //   • Теперь: ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ (3-5 гипотез с аргументами ЗА/ПРОТИВ
  //     и вероятностями) → ПЛАН ДООБСЛЕДОВАНИЯ → терапия ТОЛЬКО как опции
  //     «после подтверждения» каждой гипотезы, с развёрнутым обоснованием.
  //   • Вырезаны цензурные блоки («не назначай лечение», «все рекомендации
  //     консультативные» и т.п.) — адресат заключения — ВРАЧ; запрещены лишь
  //     уклончивость и вода.
  //   • ЖЁСТКИЙ запрет домысливать анамнез (курение/алкоголь/аллергии и пр.,
  //     которых нет в документах) — причина ошибки «додумал курение».
  //   • ГЛУБОКИЙ АНАЛИЗ: черновик → САМОПРОВЕРКА ИИ (verification pass,
  //     AI_SELF_VERIFY_PASSES) с аудитом фактов, полноты гипотез и
  //     преждевременной терапии → финальная версия + отчёт исправлений.
  let sections: ConclusionSection[] = [];
  let conclusion = "";
  let confidence: Record<string, number> = {};
  let structured: AnalysisStructured = {
    differential: [],
    workupPlan: [],
    therapyOptions: [],
    monitoringPlan: [],
    verification: { performed: false, passes: 0, corrections: [] },
  };

  if (aiAvailable) {
    const system = `Ты — виртуальный врачебный консилиум СППВР: терапевт, кардиолог, пульмонолог, онколог, фармаколог, эндокринолог, невролог, инфекционист, клинический генетик, лабораторный диагност, рентгенолог и специалист клинических путей. Адресат заключения — ЛЕЧАЩИЙ ВРАЧ. Отвечай развёрнуто, конкретно и профессионально, без водянистых фраз, отказов и общих рассуждений вместо клиники.

ЖЁСТКИЕ ПРАВИЛА ФАКТОВ (нарушение = брак заключения):
1. Используй ТОЛЬКО факты из предоставленных данных. ЗАПРЕЩЕНО ДОМЫШЛИВАТЬ анамнез: курение, алкоголь, аллергии, профессию, наследственность, прививки, образ жизни и любые сведения, которых НЕТ в документах. Если что-то неизвестно — пиши дословно «данных нет в предоставленных материалах».
2. Не приписывай пациенту симптомы, значения анализов и события, которых нет в тексте выписки/клинической картины.
3. Все цифры (дозы, значения, даты) бери только из данных; свои — явно помечай как «ориентировочно».

ПРИНЦИПЫ КЛИНИЧЕСКОГО РАЗБОРА:
- СНАЧАЛА дифференциальный диагноз: 3–5 гипотез, каждая с аргументами ЗА и ПРОТИВ из данных, оценкой вероятности и планом подтверждения. Ставить ЕДИНСТВЕННЫЙ диагноз ДО обследования — ошибка.
- ЗАТЕМ сводный план дообследования, закрывающий каждую гипотезу: конкретные лабораторные и инструментальные исследования с приоритетами (срочно/высокий/плановый), сроком выполнения и критерием оценки.
- ЛЕЧЕНИЕ НЕ НАЗНАЧАТЬ ДО ПОДТВЕРЖДЕНИЯ ДИАГНОЗА. Терапия подаётся ТОЛЬКО как опции в привязке к гипотезам: «если подтвердится [диагноз] — [препарат]», с полным обоснованием: механизм действия, почему предпочтительно именно это, доза/путь/кратность/длительность, уровень доказательности, источник. Для препаратов с серьёзным профилем риска обязательно перечисли, какие обследования/контроли нужны ДО старта терапии.
- Опирайся на предоставленные фрагменты клинических рекомендаций: КР Минздрава РФ — приоритет №1 (указывай код, напр. «КР Минздрава РФ 601_2»); международные источники (PubMed, ВОЗ, NICE, Cochrane, CDC, ESC, EMA, NCCN) — для сопоставления и доп. доказательств (указывай источник). Не выдумывай коды и названия источников, которых нет в контексте.
- Учитывай DDI и фармакогеномные предупреждения из контекста; старые анализы (>3 мес) помечай «повторить».
- Язык — русский. Без markdown-обёртки. Начинай сразу с "### КЛИНИЧЕСКАЯ КАРТИНА".

ТРЕБОВАНИЯ К КАЧЕСТВУ (проверяются автоматически; нарушение = брак заключения):
1. Гипотез ровно 3–5. Вероятности СТРОГО убывают от первой к последней, сумма всех вероятностей ≤ 100%. Одна гипотеза с 90% и ещё две по 70% — ошибка.
2. У каждой гипотезы минимум ДВА аргумента «за», каждый привязан к конкретному факту из данных, и минимум ОДИН аргумент «против» (или прямая фраза, какого признака не хватает для исключения).
3. Каждая гипотеза должна быть проверяема: назови тест/признак, который её ПОДТВЕРДИТ, и тест/признак, который её ИСКЛЮЧИТ.
4. Один тест — один пункт плана. Не дублируй исследование с уточнениями: «СРБ» и «СРБ, количественно» — это ОДИН пункт.
5. Не включай исследования, которые не изменят тактику: скрининги «на всякий случай», повтор уже выполненных тестов без срока, панели «всё подряд». Если тест не нужен — не пиши его вовсе; в разделе обследования укажи только то, что реально будет назначено.
6. Для каждого препарата обязательны: МНН, доза с ЕДИНИЦАМИ, путь введения, кратность, длительность. Доза без числа недопустима. Если доза зависит от веса/функции почек — формула и пороговое значение.
7. Сверь препараты с блоком EMR PATIENT DATA: аллергии и постоянная терапия. При совпадении класса препарата с аллергией — предложи альтернативу и явно напиши это в «Предупреждения». При почечной недостаточности (eGFR/креатинин в контексте) — скорректируй дозу или укажи запрет.
8. Для каждого красного флага укажи, что делать немедленно (а не только «исключить»).
9. Не выдумывай коды КР и МКБ-10. Код МКБ-10 указывай только если он корректен для данной гипотезы; иначе не указывай.

ФОРМАТ ОТВЕТА — разделы, каждый начинается строкой "### НАЗВАНИЕ" (заглавными, ровно эти названия):

### КЛИНИЧЕСКАЯ КАРТИНА
Только факты из документов: жалобы, анамнез (что указано — не больше), объективные данные, ключевые даты. Отдельно перечисли «Данных не хватает: …».

### ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ
3–5 гипотез по убыванию вероятности. Каждая строго в таком каркасе:
Гипотеза 1: [название] ([код МКБ-10]) — вероятность ~NN%
Аргументы за:
- [пункт, привязанный к данным]
Аргументы против:
- [пункт]
Для подтверждения:
- [обследование]
Красные флаги:
- [что исключить в первую очередь, если применимо]
Чем различить: [тест/признак, различающий гипотезы; опора на КР — указывай код КР]
После гипотез: одна строка «Предварительный рабочий диагноз: [название] ([МКБ-10]) — вероятность ~NN%».

### НЕОБХОДИМОЕ ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ
Каждое исследование — отдельный буллит, СТРОГО в этом каркасе (однострочная разметка через « — » или « | », не считая многострочного поля «Интерпретация»):
- [Название исследования] — [приоритет: срочно|высокий|плановый] — [зачем: какую гипотезу подтверждает/исключает] — срок: [когда выполнить: «в течение 1 часа», «в течение 24 ч», «планово, до 7 дней»] — подготовка: [натощак/отмена препарата/без подготовки] — подтверждает гипотезу [названия, через запятую] — исключает гипотезу [названия, через запятую] — ожидаемый результат: [конкретные значения/паттерн при целевой гипотезе] — норма: [референсный диапазон с единицами] — подтверждает, если: [критерий позитивного результата для целевой гипотезы] — исключает, если: [критерий негативного/альтернативного результата]
На следующей строке под этим буллитом — «Интерпретация: [развёрнутое руководство по интерпретации результата: какие значения/паттерны значимы, на что обратить внимание при росте/снижении, что считается ложно-положительным/ложно-отрицательным, как дифференцировать пограничные значения]».
ОДНО исследование = ОДИН буллит с полями + одна строка «Интерпретация: …». НЕ объединяй несколько тестов в один буллит и НЕ дублируй один тест в нескольких буллитах. Если поле не применимо (например, нет явного референса) — пиши «—».

### ТЕРАПЕВТИЧЕСКИЕ ОПЦИИ ПОСЛЕ ПОДТВЕРЖДЕНИЯ ДИАГНОЗА
Для каждой гипотезы заголовок: «Если подтверждён [диагноз]:» и под ним строки:
- [МНН] [доза] [путь введения] [кратность] [длительность] — обоснование: [механизм, почему этот препарат, клинический эффект] (доказательность: [A/B/C], источник: [КР Минздрава РФ …/NICE/ESC/WHO/…])
Предупреждения: [противопоказания/риски; какие обследования ДО старта терапии]
Если терапия конкретной гипотезы требует решений после обследования — так и напиши, что именно определит выбор.

### МАРКЕРЫ И МОНИТОРИНГ
Строки: - [маркер/показатель] — [целевое значение/интерпретация] — [частота контроля]

### ЛЕКАРСТВЕННЫЕ ВЗАИМОДЕЙСТВИЯ (DDI) И ПРЕДУПРЕЖДЕНИЯ
Выявленные взаимодействия с тактикой ведения. Если нет — «Выявленных взаимодействий нет.»

### КЛИНИЧЕСКИЕ ПУТИ
Соответствие клиническим протоколам/путям.

### РЕЗЮМЕ
4–6 предложений. Первая строка: «Предварительный диагноз: [название] ([МКБ-10]) — вероятность ~NN%; дифференциальный ряд включает [перечень]. До подтверждения диагноза терапия не инициируется; план дообследования: [ключевые 3–4 пункта].» Далее — опции терапии после подтверждения и прогноз.

### УВЕРЕННОСТЬ
diagnosis: 0.X
therapy: 0.X
prognosis: 0.X
overall: 0.X`;

    const contextParts: string[] = [];


    // -- Patient EMR context enrichment --
    // If the case is linked to a patient record, include the patient's
    // medical data (allergies, medications, problems, vitals, labs) as
    // additional context for the AI.
    if (found.patientId) {
      try {
        const patientRecord = await db.patient.findUnique({
          where: { id: found.patientId },
          include: {
            vitalSigns: { orderBy: { recordedAt: 'desc' }, take: 10 },
            medications: { where: { status: 'active' }, take: 20 },
            problems: { where: { status: { in: ['active', 'chronic', 'uncontrolled'] } } },
            labResults: { orderBy: { collectedAt: 'desc' }, take: 30 },
            visits: { orderBy: { scheduledAt: 'desc' }, take: 5 },
          },
        });
        if (patientRecord) {
          const emrParts: string[] = [];
          emrParts.push('Patient: ' + patientRecord.patientToken + ', sex: ' + (patientRecord.sex || 'N/A') + ', blood: ' + (patientRecord.bloodType || 'N/A'));
          if (patientRecord.birthYear && patientRecord.birthYear > 1850) {
            emrParts.push('Age: ' + (new Date().getFullYear() - patientRecord.birthYear));
          }
          const allergiesArr = safeJsonParse<Array<{ allergen?: string; reaction?: string }>>(patientRecord.allergies, []);
          if (allergiesArr.length > 0) {
            emrParts.push('Allergies: ' + allergiesArr.map((a) => a.allergen + (a.reaction ? ' (' + a.reaction + ')' : '')).join(', '));
          }
          const activeMeds = patientRecord.medications;
          if (activeMeds.length > 0) {
            emrParts.push('Active meds: ' + activeMeds.map((m) => m.drugName + ' ' + m.dosage + ' ' + m.route + ' ' + m.frequency).join(', '));
          }
          if (patientRecord.problems.length > 0) {
            emrParts.push('Problems: ' + patientRecord.problems.map((p) => p.title + (p.icd10 ? ' (' + p.icd10 + ')' : '') + ' [' + p.severity + ']').join(', '));
          }
          const latestVitals = patientRecord.vitalSigns[0];
          if (latestVitals) {
            const vParts: string[] = [];
            if (latestVitals.systolicBP) vParts.push('BP ' + latestVitals.systolicBP + '/' + latestVitals.diastolicBP);
            if (latestVitals.heartRate) vParts.push('HR ' + latestVitals.heartRate);
            if (latestVitals.temperature) vParts.push('T ' + latestVitals.temperature);
            if (latestVitals.oxygenSaturation) vParts.push('SpO2 ' + latestVitals.oxygenSaturation + '%');
            if (vParts.length > 0) emrParts.push('Vitals: ' + vParts.join(', '));
          }
          const recentLabs = patientRecord.labResults.filter((l) => l.flag !== 'normal').slice(0, 10);
          if (recentLabs.length > 0) {
            emrParts.push('Abnormal labs: ' + recentLabs.map((l) => l.testName + ': ' + l.value + ' ' + l.unit + ' [' + l.flag + ']').join(', '));
          }
          // v5.2: снапшот безопасности — считается ДО обращения к модели, чтобы
          // формальная проверка рекомендаций (clinical-audit) могла сверить
          // препараты с аллергиями/почечной функцией без участия ИИ.
          const labForSafety = patientRecord.labResults.slice(0, 30);
          const egfrLab = labForSafety.find((l) => /egfr|скф|клубочков/i.test(l.testName));
          const creatLab = labForSafety.find((l) => /креатинин|creatinine/i.test(l.testName));
          const age =
            patientRecord.birthYear && patientRecord.birthYear > 1850
              ? new Date().getFullYear() - patientRecord.birthYear
              : undefined;
          patientSafety = {
            allergies: allergiesArr.map((a) => a.allergen ?? '').filter(Boolean),
            activeMedications: activeMeds.map((m) => m.drugName).filter(Boolean),
            age,
            sex: patientRecord.sex || undefined,
            renal: egfrLab
              ? `${egfrLab.testName}: ${egfrLab.value} ${egfrLab.unit}`
              : creatLab
                ? `${creatLab.testName}: ${creatLab.value} ${creatLab.unit}`
                : undefined,
            capturedAt: new Date().toISOString(),
          };
          if (patientSafety.allergies && patientSafety.allergies.length > 0) {
            emrParts.push('ALLERGIES (safety snapshot): ' + patientSafety.allergies.join(', '));
          }
          contextParts.push('=== EMR PATIENT DATA ===\n' + emrParts.join('\n') + '\n=== END EMR DATA ===');
        }
      } catch (e) {
        logger.warn('analysis', 'Failed to load patient EMR context', { patientId: found.patientId, error: e instanceof Error ? e.message : String(e) });
      }
    }

if (mutations.length > 0) {
      contextParts.push(`Выявленные мутации:\n${mutations.slice(0, 10).map((m) => `- ${m.gene}: ${m.variant} (${m.clinicalSignificance}) — ${m.interpretation}`).join("\n")}`);
    }
    if (recommendations.length > 0) {
      contextParts.push(`Клинические рекомендации (RAG из локальной БД):\n${recommendations.slice(0, 5).map((r) => `- ${r.title}: ${r.content.slice(0, 300)} (источник: ${r.source}, доказательность: ${r.evidenceLevel || "—"})`).join("\n")}`);
    }
    if (therapyWarnings.length > 0) {
      contextParts.push(`Предупреждения:\n${therapyWarnings.map((w) => `- ${w.gene}: ${w.message}`).join("\n")}`);
    }
    if (ddiAlerts.length > 0) {
      contextParts.push(`Лекарственные взаимодействия (DDI):\n${ddiAlerts.map((a) => `- ${a.drug1} + ${a.drug2} (${a.severity}): ${a.description}\n  Механизм: ${a.mechanism}\n  Рекомендация: ${a.management}`).join("\n")}`);
    }
    if (icd10Suggestions.length > 0) {
      contextParts.push(`Коды МКБ-10 (предварительно):\n${icd10Suggestions.slice(0, 5).map((c) => `- ${c.code} — ${c.description} (уверенность: ${Math.round(c.confidence * 100)}%)`).join("\n")}`);
    }
    if (pathwayMatches.length > 0) {
      contextParts.push(`Клинические пути:\n${pathwayMatches.slice(0, 3).map((p) => `- ${p.name} (совпадение: ${Math.round(p.matchScore * 100)}%)`).join("\n")}`);
    }
    if (imageFindings.length > 0) {
      contextParts.push(`Данные визуализации:\n${imageFindings.map((f) => `- ${f.description}${f.measurements ? ` (размеры: ${f.measurements})` : ""}`).join("\n")}`);
    }
    if (entities.length > 0) {
      const diagnoses = entities.filter((e) => e.type === "diagnosis");
      const medications = entities.filter((e) => e.type === "medication");
      if (diagnoses.length > 0) {
        contextParts.push(`Диагнозы из выписки: ${diagnoses.map((e) => e.value).join(", ")}`);
      }
      if (medications.length > 0) {
        contextParts.push(`Препараты из выписки: ${medications.map((e) => e.value).join(", ")}`);
      }
    }

    const dischargeText = discharges.map((d) => d.deidContent).join("\n\n").slice(0, 4000);

    // Include web RAG context (КР Минздрава РФ + международные источники)
    // as additional knowledge for the LLM. Clearly delimited so the model
    // treats it as external evidence, not patient data.
    if (webRagContext) {
      contextParts.push(webRagContext);
    }

    const userMsg = dischargeText
      ? `ТЕКСТ ВЫПИСКИ (де-идентифицированный):\n${dischargeText}\n\nДАННЫЕ АНАЛИЗА:\n${contextParts.join("\n\n")}`
      : `ДАННЫЕ АНАЛИЗА:\n${contextParts.join("\n\n")}`;

    const maxTokens = Math.max(
      4096,
      parseInt(process.env.AI_MAX_TOKENS_ANALYSIS ?? "8192", 10) || 8192,
    );
    const temperature = parseFloat(process.env.AI_TEMPERATURE_ANALYSIS ?? "0.2") || 0.2;

    const t0 = Date.now();
    let raw = await llmChat(system, userMsg, { json: false, maxTokens, temperature });

    // ─── v5.0: ГЛУБОКИЙ АНАЛИЗ — САМОПРОВЕРКА (verification pass) ────────
    // Черновик аудируется отдельным проходом: факты против исходных данных,
    // полнота дифференциального ряда, преждевременность терапии, дозы,
    // источники, вода/цензура. Результат — исправленная финальная версия
    // + отчёт исправлений (попадает в analysis.structured.verification).
    const verifyPasses = process.env.AI_DEEP_ANALYSIS === "false"
      ? 0
      : Math.max(0, parseInt(process.env.AI_SELF_VERIFY_PASSES ?? "1", 10) || 1);

    const verification: VerificationReport = {
      performed: false,
      passes: 0,
      corrections: [],
    };

    if (raw && raw.trim().length >= 50 && verifyPasses > 0) {
      const verifySystem = `Ты — клинический аудитор СППВР (виртуальный консилиум проверки заключения). Тебе даны (A) исходные данные пациента и (B) ЧЕРНОВИК заключения ИИ. Проверь черновик и верни ИСПРАВЛЕННУЮ ФИНАЛЬНУЮ ВЕРСИЮ того же формата ("### РАЗДЕЛЫ", русский язык).

ПРОВЕРКИ (применить каждую):
1. ФАКТЫ: каждый факт должен следовать из (A). Особо — анамнез: курение, алкоголь, аллергии, наследственность, профессия, образ жизни. Если этого НЕТ в (A) — УДАЛИ утверждение, замени на «данных нет в предоставленных материалах». Никаких домысленных симптомов и значений.
2. ДИФФЕРЕНЦИАЛЬНЫЙ РЯД: должно быть 3–5 гипотез, у каждой — аргументы ЗА и ПРОТИВ, вероятность ~NN%, план подтверждения. Единственный диагноз без альтернатив — исправь (дополни гипотезами).
3. ТЕРАПИЯ: не должна назначаться до подтверждения диагноза — только как опции «если подтверждён [диагноз]». У каждого препарата — МНН, доза, путь, кратность, длительность, обоснование (механизм), доказательность, источник; предупреждения и обследования ДО старта терапии. Исправь неверные/опасные дозы.
4. ОБСЛЕДОВАНИЕ: сводный план должен закрывать все гипотезы, быть конкретным, приоритеты расставлены.
5. ИСТОЧНИКИ: ссылки на КР Минздрава (коды вида 601_2) и международные источники — только те, что реально есть в контексте (A). Вымышленные коды/источники — удалить.
6. КОНКРЕТНОСТЬ: удали водянистые фразы, отказы и общие слова вместо клиники; заключение адресовано врачу и обязано быть конкретным и развёрнутым.
7. Сохрани формат разделов и каркас гипотез («Гипотеза N: … / Аргументы за: / Аргументы против: / Для подтверждения: / Красные флаги: / Чем различить:»).

В самом конце добавь раздел:
### ОТЧЁТ САМОПРОВЕРКИ
Строки:
- Исправлено: [что именно исправлено]
- Подтверждено: [какие блоки проверены и оставлены без изменений]
Если серьёзных правок нет — строка «- Исправлено: существенных расхождений с исходными данными не выявлено».

Верни ТОЛЬКО финальный текст (разделы + ОТЧЁТ САМОПРОВЕРКИ), без каких-либо пояснений.`;

      let corrected = raw;
      for (let pass = 1; pass <= verifyPasses; pass++) {
        const verifyInput = `ИСХОДНЫЕ ДАННЫЕ (A):\n${userMsg}\n\nЧЕРНОВИК (B):\n${corrected}`;
        const verified = await llmChat(verifySystem, verifyInput, {
          json: false,
          maxTokens,
          temperature: 0.1,
        });
        if (verified && verified.trim().length >= 50) {
          corrected = verified;
          verification.passes = pass;
        } else {
          logger.warn("analysis", "Verification pass вернул пустой ответ", { pass });
          break;
        }
      }

      // Отчёт самопроверки: извлекаем и удаляем из финального текста
      const { report, corrections, cleaned } = extractVerificationReport(corrected);
      verification.corrections = corrections;
      verification.performed = verification.passes > 0;
      verification.factsGrounded = !report.toLowerCase().includes("выявлено") || corrections.length === 0;
      verification.verifiedAt = new Date().toISOString();
      corrected = cleaned;
      raw = corrected;

      logger.info("analysis", "Глубокий анализ: самопроверка завершена", {
        caseId,
        passes: verification.passes,
        corrections: corrections.length,
        elapsedMs: Date.now() - t0,
      });
    }

    if (raw && raw.trim().length > 0) {
      const parsedJson = parseJSON<{ sections?: ConclusionSection[]; conclusion?: string; confidence?: Record<string, number> }>(raw);
      if (parsedJson && Array.isArray(parsedJson.sections) && parsedJson.sections.length > 0) {
        sections = parsedJson.sections;
        conclusion = parsedJson.conclusion ?? "";
        confidence = parsedJson.confidence ?? {};
      } else {
        const parsed = parsePlainTextConclusion(raw);
        sections = parsed.sections;
        conclusion = parsed.conclusion;
        confidence = parsed.confidence;
      }
    }

    if (sections.length === 0 && !conclusion) {
      conclusion = buildFallbackConclusion(found, mutations, recommendations, therapyWarnings, ddiAlerts);
      sections = buildFallbackSections(mutations, recommendations, therapyWarnings, ddiAlerts, icd10Suggestions, pathwayMatches, citations);
    }

    // ─── v5.0: СТРУКТУРИРОВАННЫЙ РАЗБОР финального текста ─────────────────
    // Основной путь — надёжный JSON-проход (structured-extraction.ts):
    // отдельный вызов модели-структуризатора читает готовый текст заключения
    // и возвращает строгий JSON, валидируемый zod. Это устраняет хрупкость
    // regex-разбора. При неудаче — откат на прежний эвристический разбор.
    const structuredJson = aiAvailable ? await extractStructuredJson(raw ?? "") : null;
    if (structuredJson && (structuredJson.differential?.length || structuredJson.workupPlan?.length)) {
      structured = {
        differential: structuredJson.differential ?? [],
        workupPlan: structuredJson.workupPlan ?? [],
        therapyOptions: structuredJson.therapyOptions ?? [],
        monitoringPlan: structuredJson.monitoringPlan ?? [],
        verification,
      };
      logger.info("analysis", "Структуризация выполнена JSON-проходом", {
        caseId,
        differential: structured.differential.length,
        workup: structured.workupPlan.length,
        therapy: structured.therapyOptions.length,
        monitoring: structured.monitoringPlan.length,
      });
    } else {
      structured = await parseStructuredFromText(raw ?? "", sections, {
        differentialText: findSectionText(sections, ["ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ"]),
        workupText: findSectionText(sections, ["НЕОБХОДИМОЕ ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ", "ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ"]),
        therapyText: findSectionText(sections, ["ТЕРАПЕВТИЧЕСКИЕ ОПЦИИ"]),
        monitoringText: findSectionText(sections, ["МАРКЕРЫ И МОНИТОРИНГ", "МАРКЕРЫ", "МОНИТОРИНГ"]),
      }, verification);
    }
    // v5.2: ДЕТЕРМИНИРОВАННАЯ НОРМАЛИЗАЦИЯ структуры до сохранения.
    // Устраняем дубли исследований, восстанавливаем ранги/вероятности,
    // приводим targetDx терапии к точному названию гипотезы. Все правки
    // перечисляются в normalizationFixes и видны врачу в разделе «Проверка».
    const sanitized = sanitizeClinicalStructure(structured);
    structured = { ...sanitized.structured, patientSafety };
    if (sanitized.fixes.length > 0) {
      logger.info("analysis", "Структура рекомендаций нормализована", {
        caseId,
        fixes: sanitized.fixes.slice(0, 10),
      });
    }
    // Best-effort: сверка гипотез с репозиторием КР Минздрава по МКБ-10
    await attachClinrecsToDifferential(structured.differential);

  } else {
    conclusion = `Manual mode (AI core unavailable). Documents loaded: ${found.documents.length}. Variants found: ${mutations.length}. Manual analysis required.`;
    sections = buildFallbackSections(mutations, recommendations, therapyWarnings, ddiAlerts, icd10Suggestions, pathwayMatches, citations);
    confidence = { diagnosis: 0, therapy: 0, prognosis: 0 };
  }

  // ─── Step 10: Save all results (versioned) ────────────────────────────
  // Get existing analysis to check version
  const existingAnalysis = await db.analysisResult.findUnique({ where: { caseId } });
  let newVersion = 1;

  // v5.2: ПЕРЕНОС РЕШЕНИЙ ВРАЧА. Повторный анализ не должен молча стирать
  // подтверждённые диагнозы и отметки трекера: это клиническая работа врача,
  // а не вывод модели. Переносим только то, что осталось в новой структуре.
  let carriedInfo = { confirmedDx: 0, workup: 0 };
  if (existingAnalysis?.structured) {
    try {
      const prev = JSON.parse(existingAnalysis.structured) as AnalysisStructured;
      const carried = carryOverDoctorState(prev, structured);
      structured = carried.structured;
      carriedInfo = carried.carried;
    } catch {
      // Битый JSON старой версии — не блокируем анализ.
    }
  }

  // v5.2: формальная проверка набора рекомендаций (детерминированная,
  // без ИИ). Результат пишется в аудит-журнал — это метрика качества,
  // которую можно отслеживать по клинике.
  const auditReport = auditAnalysis({
    structured,
    citationsCount: citations.length,
  });

  if (existingAnalysis) {
    // Save current state as a version snapshot before overwriting
    const currentVersion = existingAnalysis.version || 1;
    newVersion = currentVersion + 1;

    await db.analysisVersion.create({
      data: {
        analysisId: existingAnalysis.id,
        version: currentVersion,
        snapshot: JSON.stringify({
          entities: existingAnalysis.entities,
          mutations: existingAnalysis.mutations,
          recommendations: existingAnalysis.recommendations,
          conclusion: existingAnalysis.conclusion,
          sections: existingAnalysis.sections,
          confidence: existingAnalysis.confidence,
          citations: existingAnalysis.citations,
          imageFindings: existingAnalysis.imageFindings,
          ddiAlerts: existingAnalysis.ddiAlerts,
          icd10Suggestions: existingAnalysis.icd10Suggestions,
          pathwayMatches: existingAnalysis.pathwayMatches,
          // v5.0: структурированные клинические данные в снапшоте
          structured: existingAnalysis.structured ?? "{}",
        }),
        changeNote: `Re-analysis (v${currentVersion} → v${newVersion})`,
        doctorId: session.doctorId,
      },
    });
  }

  // Update case ICD-10 codes
  if (icd10Suggestions.length > 0) {
    await db.case.update({
      where: { id: caseId },
      data: { icd10Codes: JSON.stringify(icd10Suggestions) },
    });
  }

  const analysis = await db.analysisResult.upsert({
    where: { caseId },
    create: {
      caseId,
      entities: JSON.stringify(entities),
      mutations: JSON.stringify(mutations),
      recommendations: JSON.stringify(recommendations),
      conclusion,
      sections: JSON.stringify(sections),
      confidence: JSON.stringify(confidence),
      citations: JSON.stringify(citations),
      imageFindings: JSON.stringify(imageFindings),
      ddiAlerts: JSON.stringify(ddiAlerts),
      icd10Suggestions: JSON.stringify(icd10Suggestions),
      pathwayMatches: JSON.stringify(pathwayMatches),
      structured: JSON.stringify(structured),
      version: newVersion,
    },
    update: {
      entities: JSON.stringify(entities),
      mutations: JSON.stringify(mutations),
      recommendations: JSON.stringify(recommendations),
      conclusion,
      sections: JSON.stringify(sections),
      confidence: JSON.stringify(confidence),
      citations: JSON.stringify(citations),
      imageFindings: JSON.stringify(imageFindings),
      ddiAlerts: JSON.stringify(ddiAlerts),
      icd10Suggestions: JSON.stringify(icd10Suggestions),
      pathwayMatches: JSON.stringify(pathwayMatches),
      structured: JSON.stringify(structured),
      version: newVersion,
    },
  });

  await db.case.update({ where: { id: caseId }, data: { status: "analyzed" } });

  await appendAudit({
    caseId,
    doctorId: session.doctorId,
    action: "analyze",
    details: JSON.stringify({
      aiAvailable,
      aiProvider: provider,
      entityCount: entities.length,
      mutationCount: mutations.length,
      recommendationCount: recommendations.length,
      warningCount: therapyWarnings.length,
      ddiAlertCount: ddiAlerts.length,
      icd10Count: icd10Suggestions.length,
      pathwayCount: pathwayMatches.length,
      webRagResultCount: webRagResults.length,
      differentialCount: structured.differential.length,
      workupCount: structured.workupPlan.length,
      therapyOptionCount: structured.therapyOptions.length,
      verificationPerformed: structured.verification.performed,
      verificationPasses: structured.verification.passes,
      auditScore: auditReport.score,
      auditCritical: auditReport.critical,
      auditWarnings: auditReport.warning,
      carriedConfirmedDx: carriedInfo.confirmedDx,
      carriedWorkupNotes: carriedInfo.workup,
      version: newVersion,
      consentId: aiConsent?.id,
    }),
  });

  return NextResponse.json({
    analysis: {
      id: analysis.id,
      caseId,
      entities,
      mutations,
      recommendations,
      conclusion,
      sections,
      confidence,
      citations,
      imageFindings,
      therapyWarnings,
      ddiAlerts,
      icd10Suggestions,
      pathwayMatches,
      webRagResults,
      structured,
      version: newVersion,
      aiAvailable,
      audit: auditReport,
      createdAt: analysis.createdAt.toISOString(),
      updatedAt: analysis.updatedAt.toISOString(),
    },
  });
}

// ─── Helper functions ────────────────────────────────────────────────────

function extractMedNamesFromText(text: string): string[] {
  const meds: string[] = [];
  const medPattern = /(?:препарат|лекарство|мнн|назначен|терапия|приём|инфузия)[:\s]+([А-ЯЁа-яёA-Z][А-ЯЁа-яёA-Z0-9\s\-]{2,40})/gi;
  let match;
  while ((match = medPattern.exec(text)) !== null) {
    meds.push(match[1].trim());
  }
  return meds;
}

function buildFallbackConclusion(
  found: { caseCode: string; diagnosisHint: string | null },
  mutations: Mutation[],
  recommendations: Array<{ title: string }>,
  warnings: Array<{ gene: string; message: string }>,
  ddiAlerts: DDIAlert[],
): string {
  const parts: string[] = [];
  parts.push(`Case ${found.caseCode}.`);
  if (found.diagnosisHint) parts.push(`Preliminary diagnosis: ${found.diagnosisHint}.`);
  parts.push(`Genetic variants found: ${mutations.length}.`);
  if (recommendations.length > 0) parts.push(`Clinical recommendations matched: ${recommendations.length}.`);
  if (warnings.length > 0) parts.push(`Contraindications/warnings: ${warnings.length}.`);
  if (ddiAlerts.length > 0) parts.push(`Drug interactions: ${ddiAlerts.length}.`);
  return parts.join(" ");
}

function buildFallbackSections(
  mutations: Mutation[],
  recommendations: Array<{ id: string; title: string; gene?: string; content: string; source: string; evidenceLevel?: string }>,
  warnings: Array<{ gene: string; message: string; type: string }>,
  ddiAlerts: DDIAlert[],
  icd10Suggestions: ICD10CodeMatch[],
  pathwayMatches: ClinicalPathwayMatch[],
  citations: Citation[],
): ConclusionSection[] {
  const sections: ConclusionSection[] = [];

  sections.push({
    title: "Genetic Profile",
    content: mutations.length > 0
      ? mutations.map((m) => `• ${m.gene}: ${m.variant} — ${m.interpretation} [${m.clinicalSignificance}]`).join("\n")
      : "No genetic variants identified.",
    confidence: mutations.length > 0 ? 0.7 : 0.3,
    citations: citations.filter((c) => c.source === "genetic"),
  });

  sections.push({
    title: "Clinical Recommendations (RAG)",
    content: recommendations.length > 0
      ? recommendations.slice(0, 5).map((r, i) => `${i + 1}. ${r.title} (${r.source})`).join("\n")
      : "No relevant recommendations found.",
    confidence: recommendations.length > 0 ? 0.8 : 0.2,
    citations: citations.filter((c) => c.source === "recommendation"),
  });

  sections.push({
    title: "Contraindications and Warnings",
    content: warnings.length > 0
      ? warnings.map((w) => `⚠ ${w.gene}: ${w.message}`).join("\n\n")
      : "No contraindications identified.",
    confidence: warnings.length > 0 ? 0.85 : 0.5,
    citations: [],
  });

  if (ddiAlerts.length > 0) {
    sections.push({
      title: "Drug-Drug Interactions (DDI)",
      content: ddiAlerts.map((a) => `⚠ ${a.drug1} + ${a.drug2} (${a.severity}): ${a.description.slice(0, 200)}`).join("\n\n"),
      confidence: 0.8,
      citations: [],
    });
  }

  if (icd10Suggestions.length > 0) {
    sections.push({
      title: "ICD-10 Codes",
      content: icd10Suggestions.slice(0, 10).map((c) => `${c.code} — ${c.description} (confidence: ${Math.round(c.confidence * 100)}%)`).join("\n"),
      confidence: icd10Suggestions[0]?.confidence ?? 0.5,
      citations: [],
    });
  }

  if (pathwayMatches.length > 0) {
    sections.push({
      title: "Clinical Pathways",
      content: pathwayMatches.slice(0, 5).map((p) => `• ${p.name} (match: ${Math.round(p.matchScore * 100)}%)`).join("\n"),
      confidence: pathwayMatches[0]?.matchScore ?? 0.5,
      citations: [],
    });
  }

  return sections;
}

function parsePlainTextConclusion(raw: string): {
  sections: ConclusionSection[];
  conclusion: string;
  confidence: Record<string, number>;
} {
  const sections: ConclusionSection[] = [];
  let conclusion = "";
  const confidence: Record<string, number> = {};

  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json|markdown)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();

  const lines = cleaned.split(/\r?\n/);
  let currentTitle = "";
  let currentBody: string[] = [];

  const flush = () => {
    const content = currentBody.join("\n").trim();
    if (currentTitle && content) {
      const titleUpper = currentTitle.toUpperCase();
      if (titleUpper.includes("РЕЗЮМЕ") || titleUpper.includes("SUMMARY") || titleUpper.includes("SUMMERY")) {
        // v2.3.2: Если ещё не нашли раздел ДИАГНОЗ — используем РЕЗЮМЕ как conclusion.
        // Если ДИАГНОЗ уже найден — conclusion уже установлен, оставляем его.
        if (!conclusion) {
          conclusion = content;
        }
        sections.push({
          title: currentTitle,
          content,
          confidence: 0.7,
          citations: [],
        });
      } else if (titleUpper.includes("ДИАГНОЗ") || titleUpper.includes("DIAGNOSIS")) {
        // v2.3.2: ПРИОРИТЕТ — раздел ДИАГНОЗ — это и есть конкретный диагноз,
        // который показывается в "Заключении" в UI.
        // v5.0: «ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ» не перезаписывает заключение —
        // он слишком длинный и рендерится отдельным структурированным блоком.
        const isDifferential = titleUpper.includes("ДИФФЕРЕНЦИАЛЬНЫЙ") || titleUpper.includes("DIFFERENTIAL");
        if (!isDifferential) {
          conclusion = content;
        }
        sections.push({
          title: currentTitle,
          content,
          confidence: 0.85,
          citations: [],
        });
      } else if (titleUpper.includes("УВЕРЕННОСТ") || titleUpper.includes("CONFIDENCE") || titleUpper.includes("УВЕРЕННОСТЬ")) {
        parseConfidenceBlock(content, confidence);
        sections.push({
          title: currentTitle,
          content,
          confidence: 0.7,
          citations: [],
        });
      } else {
        sections.push({
          title: currentTitle,
          content,
          confidence: 0.7,
          citations: [],
        });
      }
    }
  };

  // Match section headers: "### TITLE", "## TITLE", "# TITLE", "**TITLE**",
  // or "TITLE:" on its own line, or "TITLE" in all caps on its own line.
  for (const line of lines) {
    // "### TITLE" or "## TITLE" or "# TITLE"
    let m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) {
      // "**TITLE**" or "** TITLE **"
      m = line.match(/^\*\*\s*(.+?)\s*\*\*\s*$/);
    }
    if (!m) {
      // "TITLE:" where TITLE is short and the line has no other content
      const colonMatch = line.match(/^([А-ЯЁA-Z][А-ЯЁA-Z0-9\s\/\(\)\-]{2,60}):\s*$/);
      if (colonMatch && !line.includes("  ")) {
        m = colonMatch;
      }
    }
    if (m) {
      flush();
      currentTitle = m[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  flush();

  // If no sections were found but there's content, treat the whole thing as
  // a single "Заключение" section so the UI has something to render.
  if (sections.length === 0 && cleaned.length > 0) {
    sections.push({
      title: "Заключение",
      content: cleaned.slice(0, 3000),
      confidence: 0.5,
      citations: [],
    });
  }

  if (!conclusion && sections.length > 0) {
    // v5.0: приоритет извлечения краткого заключения: РЕЗЮМЕ (там по формату
    // первая строка — предварительный диагноз) → ДИАГНОЗ → первая секция.
    // Раздел «ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ» не берём — он длинный и целиком
    // рендерится отдельным структурированным блоком в UI.
    const summary = sections.find((s) =>
      s.title.toUpperCase().includes("РЕЗЮМЕ") || s.title.toUpperCase().includes("SUMMARY")
    );
    const diagnosis = sections.find((s) => {
      const t = s.title.toUpperCase();
      return t.includes("ДИАГНОЗ") && !t.includes("ДИФФЕРЕНЦИАЛЬНЫЙ");
    });
    conclusion = (summary ?? diagnosis ?? sections[0]).content.slice(0, 1200);
  }
  if (!conclusion) {
    conclusion = cleaned.slice(0, 2000);
  }

  return { sections, conclusion, confidence };
}

function parseConfidenceBlock(text: string, out: Record<string, number>): void {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/([а-яёa-z]+)\s*[:：]\s*([0-9]*\.?[0-9]+)/i);
    if (m) {
      const keyMap: Record<string, string> = {
        диагноз: "diagnosis", diagnosis: "diagnosis",
        терапия: "therapy", therapy: "therapy",
        прогноз: "prognosis", prognosis: "prognosis",
        общая: "overall", overall: "overall",
      };
      const mapped = keyMap[m[1].toLowerCase()] ?? m[1].toLowerCase();
      const val = parseFloat(m[2]);
      if (Number.isFinite(val)) {
        out[mapped] = val > 1 ? val / 100 : val;
      }
    }
  }
}

// ===========================================================================
// v5.0 — Структурированный разбор заключения ИИ
// ---------------------------------------------------------------------------
// Финальный текст заключения (разделы "### ...") разбирается в строгие
// структуры: гипотезы дифференциального диагноза, план дообследования,
// терапевтические опции, маркеры мониторинга. Разбор эвристический, но
// промпт требует жёсткого каркаса строк («Гипотеза N: …», «Аргументы за:» и
// т.д.), поэтому надёжность высокая. При неудаче парсинга соответствующий
// массив остаётся пустым — UI показывает текстовые разделы как раньше.
// ===========================================================================

/** Находит текст секции по имени (по подстроке в заголовке раздела). */
function findSectionText(
  sections: ConclusionSection[],
  titleIncludes: string[],
): string {
  const s = sections.find((sec) => {
    const t = sec.title.toUpperCase();
    return titleIncludes.some((k) => t.includes(k.toUpperCase()));
  });
  return s?.content ?? "";
}

/** Извлекает «### ОТЧЁТ САМОПРОВЕРКИ» из текста и удаляет его. */
export function extractVerificationReport(text: string): {
  report: string;
  corrections: string[];
  cleaned: string;
} {
  const re = /^#{1,6}\s*ОТЧЁТ САМОПРОВЕРКИ\s*$/im;
  const m = re.exec(text);
  if (!m || m.index === undefined) {
    return { report: "", corrections: [], cleaned: text.trim() };
  }
  const report = text.slice(m.index).replace(re, "").trim();
  const cleaned = text.slice(0, m.index).trim();
  const corrections: string[] = [];
  for (const line of report.split(/\r?\n/)) {
    const t = line.trim().replace(/^[-•*]\s*/, "");
    if (/^Исправлено:/i.test(t) && !/не выявлено/i.test(t)) {
      corrections.push(t.slice("Исправлено:".length).trim());
    }
  }
  return { report, corrections, cleaned };
}

/**
 * Главный разбор: строит AnalysisStructured из текстов секций.
 * @param rawText полный финальный текст (используется как fallback-источник)
 */
export async function parseStructuredFromText(
  rawText: string,
  sections: ConclusionSection[],
  texts: {
    differentialText: string;
    workupText: string;
    therapyText: string;
    monitoringText: string;
  },
  verification: VerificationReport,
): Promise<AnalysisStructured> {
  const grab = (prefer: string, fallbackTitles: string[]): string =>
    prefer || findSectionText(sections, fallbackTitles);

  const diffText = grab(texts.differentialText, ["ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ"]);
  const workupText = grab(texts.workupText, [
    "НЕОБХОДИМОЕ ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ",
    "ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ",
  ]);
  const therapyText = grab(texts.therapyText, ["ТЕРАПЕВТИЧЕСКИЕ ОПЦИИ"]);
  const monitoringText = grab(texts.monitoringText, [
    "МАРКЕРЫ И МОНИТОРИНГ",
    "МАРКЕРЫ",
    "МОНИТОРИНГ",
  ]);

  const differential = parseDifferential(diffText || sectionFromRaw(rawText, "ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ"));
  const workupPlan = parseWorkup(workupText || sectionFromRaw(rawText, "ДОПОЛНИТЕЛЬНОЕ ОБСЛЕДОВАНИЕ"));
  const therapyOptions = parseTherapy(therapyText || sectionFromRaw(rawText, "ТЕРАПЕВТИЧЕСКИЕ ОПЦИИ"));
  const monitoringPlan = parseMonitoring(monitoringText || sectionFromRaw(rawText, "МАРКЕРЫ"));

  return {
    differential,
    workupPlan,
    therapyOptions,
    monitoringPlan,
    verification,
  };
}

/** Достаёт текст раздела из сырого текста по заголовку (fallback). */
function sectionFromRaw(rawText: string, titleIncludes: string): string {
  if (!rawText) return "";
  const re = new RegExp(
    `^#{1,6}\\s*([^#\\n]*${titleIncludes}[^#\\n]*)$`,
    "im",
  );
  const m = re.exec(rawText);
  if (!m || m.index === undefined) return "";
  const rest = rawText.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,6}\s/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

/** Парсер дифференциального диагноза (каркас «Гипотеза N: …»). */
export function parseDifferential(text: string): DifferentialDiagnosis[] {
  if (!text) return [];
  const out: DifferentialDiagnosis[] = [];
  // Разбиваем на блоки по «Гипотеза N:»
  const blockRe = /Гипотеза\s*(\d+)\s*[:.]?\s*([^\n]+)/gi;
  const matches: Array<{ rank: number; title: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    matches.push({ rank: parseInt(m[1], 10), title: m[2].trim(), start: m.index });
  }
  if (matches.length === 0) return [];

  for (let i = 0; i < matches.length; i++) {
    const blockEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const block = text.slice(matches[i].start, blockEnd);

    const icdMatch = matches[i].title.match(/\(([A-ZА-Я]\d{2}(?:\.\d{1,2})?)\)/);
    const probMatch = block.match(/вероятност[а-яё]*\s*[~:≈]?\s*(\d{1,3})\s*%/i);

    const dx: DifferentialDiagnosis = {
      rank: matches[i].rank || i + 1,
      diagnosis: cleanDxTitle(matches[i].title),
      icd10: icdMatch ? icdMatch[1].toUpperCase() : undefined,
      probability:
        probMatch && Number.isFinite(+probMatch[1])
          ? Math.min(1, Math.max(0, +probMatch[1] / 100))
          : Math.max(0.5 - i * 0.12, 0.1),
      argumentsFor: extractLabeledList(block, ["Аргументы за"]),
      argumentsAgainst: extractLabeledList(block, ["Аргументы против", "Аргументы против:"]),
      workup: extractLabeledList(block, ["Для подтверждения"]),
      redFlags: extractLabeledList(block, ["Красные флаги"]),
      clinrecCode: block.match(/КР\s*(?:Минздрава)?\s*(?:РФ)?\s*№?\s*(\d{2,4}_\d+)/i)?.[1],
      notes: extractSingleLine(block, ["Чем различить"]),
      sources: Array.from(
        block.matchAll(/(NICE|WHO|ВОЗ|Cochrane|CDC|ESC|EMA|NCCN|PubMed)/gi),
      ).map((x) => x[1]).filter((v, idx, arr) => arr.indexOf(v) === idx),
    };
    out.push(dx);
  }
  return out;
}

function cleanDxTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, "") // убираем (МКБ-10)
    .replace(/[—–-]\s*вероятност[а-яё]*.*$/i, "")
    .replace(/вероятност[а-яё]*\s*[~:≈]?\s*\d{1,3}\s*%.*/i, "")
    .trim();
}

/** Строки-список после метки («Аргументы за:», «Для подтверждения:») до следующей метки. */
function extractLabeledList(block: string, labels: string[]): string[] {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  let capturing = false;
  for (const line of lines) {
    const t = line.trim();
    const isLabel = labels.some((lab) =>
      new RegExp(`^${lab}\\s*[:.]?\\s*$`, "i").test(t),
    );
    if (isLabel) {
      capturing = true;
      continue;
    }
    // Любая другая метка/заголовок каркаса заканчивает захват
    if (capturing) {
      if (
        /^[-•*]\s*/.test(t) ||
        (!/^(Аргументы|Для подтверждения|Красные флаги|Чем различить|Гипотеза|Предварительный)/i.test(t) && t.length > 0 && !/[:.]$/.test(t) && out.length === 0 && !/^[-•*]/.test(t))
      ) {
        // продолжаем только если это пункт списка или продолжение
      }
      if (/^(Аргументы\s+против|Аргументы\s+за|Для\s+подтверждения|Красные\s+флаги|Чем\s+различить|Гипотеза\s*\d|Предварительный\s+рабочий\s+диагноз|Если\s+подтвержд[ёе]н|Предупреждени[а-яё]*)\s*[:.]/i.test(t)) {
        capturing = false;
        continue;
      }
      if (/^[-•*]\s*/.test(t)) {
        out.push(t.replace(/^[-•*]\s*/, "").trim());
      } else if (t && out.length > 0 && !/^(Аргументы|Гипотеза)/i.test(t)) {
        // продолжение предыдущего пункта
        out[out.length - 1] += " " + t;
      } else if (t && out.length === 0) {
        // значение в той же строке после метки
        out.push(t);
      }
    }
  }
  return out.filter(Boolean).slice(0, 8);
}

/** Одна строка после метки (например «Чем различить: …»). */
function extractSingleLine(block: string, labels: string[]): string | undefined {
  for (const line of block.split(/\r?\n/)) {
    for (const lab of labels) {
      const re = new RegExp(`^${lab}\\s*[:.]?\\s*(.+)$`, "i");
      const m = line.trim().match(re);
      if (m && m[1]) return m[1].trim();
    }
  }
  return undefined;
}

/**
 * v5.1: Парсер плана дообследования.
 *
 * Старый формат:  `- Название — приоритет — зачем`
 * Новый формат (см. промпт выше): каждая запись — это ОДНА строка-буллит
 * с расширенным набором тегов + следующая строка «Интерпретация: …».
 *
 * Поддерживаются оба формата (старые данные без новых полей сохраняют
 * обратную совместимость — все новые поля опциональны).
 *
 * Извлекаемые поля:
 *   - name            — название обследования
 *   - priority        — срочно/высокий/плановый
 *   - purpose         — «зачем: какую гипотезу подтверждает/исключает»
 *   - targetDx        — (legacy) одно название гипотезы
 *   - targetDxConfirm — массив «подтверждает гипотезу: A, B, C»
 *   - targetDxRefute  — массив «исключает гипотезу: A, B, C»
 *   - expectedResult  — «ожидаемый результат: ...»
 *   - normalRange     — «норма: ...»
 *   - cutoffs         — (алиас для expectedResult+normalRange, если
 *                       промпт дал только «пороги:»)
 *   - confirmsIf      — «подтверждает, если: ...»
 *   - refutesIf       — «исключает, если: ...»
 *   - interpretation  — следующая строка «Интерпретация: …»
 */
export function parseWorkup(text: string): WorkupItem[] {
  if (!text) return [];
  const out: WorkupItem[] = [];
  const lines = text.split(/\r?\n/);

  /** Извлекает хвост после явно названного тега в строке. */
  function extractExplicit(line: string, tag: string): string | undefined {
    const re = new RegExp(`${tag}\\s*[:=—\\-]?\\s*([^|—]+?)(?:\\s+[—|]\\s+|$)`, "iu");
    const m = line.match(re);
    if (!m?.[1]) return undefined;
    const v = m[1].trim();
    return v === "—" ? undefined : v;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim().replace(/^[-•*]\s*/, "");
    if (!t || t.length < 4) continue;
    if (/^(обследование|план|приоритет)/i.test(t) && !t.includes("—")) continue;

    // Отдельная строка «Интерпретация: …» привязывается к ПРЕДЫДУЩЕМУ буллиту.
    if (/^Интерпретаци[а-яё]*\s*[:.]?\s*/i.test(t)) {
      const v = t.replace(/^Интерпретаци[а-яё]*\s*[:.]?\s*/i, "").trim();
      if (v && out.length > 0) out[out.length - 1].interpretation = v;
      continue;
    }

    // Если строка содержит ровно один разделитель « — », это legacy-формат
    // «name — priority — purpose». Парсим как раньше.
    const parts = t.split(/\s*[—–]\s*|\s+\|\s+/);
    if (parts.length < 2) {
      out.push({ name: t, priority: "routine" });
      continue;
    }

    const name = parts[0].trim();
    let priority: WorkupItem["priority"] = "routine";
    let purpose = "";
    let targetDx: string | undefined;
    let targetDxConfirm: string[] | undefined;
    let targetDxRefute: string[] | undefined;
    let expectedResult: string | undefined;
    let normalRange: string | undefined;
    let confirmsIf: string | undefined;
    let refutesIf: string | undefined;
    let timing: string | undefined;
    let preparation: string | undefined;

    const p1 = (parts[1] ?? "").trim().toLowerCase();
    if (/сроч|urgent|экстрен|немедлен/i.test(p1)) priority = "urgent";
    else if (/высок|high/i.test(p1)) priority = "high";
    else if (/планов|routine|низк/i.test(p1)) priority = "routine";

    // Легаси-часть: «зачем» — это всё после приоритета или, если приоритета
    // нет, второй сегмент.
    const p2 = parts.slice(2).join(" — ").trim();
    if (p2) purpose = p2;
    else if (parts.length === 2 && !/сроч|высок|планов|urgent|high|routine|низк/i.test(p1)) {
      purpose = parts[1].trim();
      priority = /сроч|экстрен/i.test(t) ? "urgent" : "routine";
    }

    // v5.1: явные теги в одной строке. Если их нет — это legacy-формат,
    // и мы по-прежнему извлекаем targetDx через старый regex.
    targetDxConfirm = extractExplicit(t, "подтверждает гипотезу")?.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!targetDxConfirm) targetDxConfirm = extractExplicit(t, "подтверждает")?.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    targetDxRefute = extractExplicit(t, "исключает гипотезу")?.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!targetDxRefute) targetDxRefute = extractExplicit(t, "исключает")?.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

    expectedResult = extractExplicit(t, "ожидаемый результат")
      ?? extractExplicit(t, "ожидаемо");
    normalRange = extractExplicit(t, "норма")
      ?? extractExplicit(t, "референс");
    confirmsIf = extractExplicit(t, "подтверждает, если")
      ?? extractExplicit(t, "положительно при");
    refutesIf = extractExplicit(t, "исключает, если")
      ?? extractExplicit(t, "отрицательно при");
    // v5.2: срок и подготовка — нужны врачу для очерёдности и направления.
    timing = extractExplicit(t, "срок")
      ?? extractExplicit(t, "когда выполнить");
    preparation = extractExplicit(t, "подготовка")
      ?? extractExplicit(t, "подготовка к исследованию");

    // Легаси: если новых тегов не было, targetDx достаём по старому regex.
    if (!targetDxConfirm || targetDxConfirm.length === 0) {
      const targetDxMatch = purpose.match(
        /(?:гипотез[а-яё]*|диагноз[а-яё]*)\s*[«"]?([^«»;,.]{3,60})/i,
      );
      targetDx = targetDxMatch ? targetDxMatch[1].trim() : undefined;
    } else {
      // Налицо мульти-таргет — legacy-поле targetDx = первому.
      targetDx = targetDxConfirm[0];
    }

    // Очистим «зачем» от дублирования тегов (если они в нём присутствуют).
    const cleanedPurpose = purpose
      ? purpose
          .replace(/—?\s*подтверждает\s+гипотез[уа]?\s*[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*исключает\s+гипотез[уа]?\s*[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*ожидаем(?:ый|о)\s+результат[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*норма[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*подтверждает,\s+если[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*исключает,\s+если[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*срок[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/—?\s*подготовка[:—-]?\s*[^—|]*(?=\s+[—|]\s|$)/iu, "")
          .replace(/\s+[—|]\s*$/, "")
          .trim()
      : undefined;

    out.push({
      name,
      priority,
      purpose: cleanedPurpose || purpose || undefined,
      targetDx,
      targetDxConfirm: targetDxConfirm?.length ? targetDxConfirm : undefined,
      targetDxRefute: targetDxRefute?.length ? targetDxRefute : undefined,
      expectedResult,
      normalRange,
      confirmsIf,
      refutesIf,
      timing,
      preparation,
    });
  }
  return out.slice(0, 15);
}

/** Парсер терапевтических опций: «Если подтверждён [dx]:» + «- препарат …». */
export function parseTherapy(text: string): TherapyOption[] {
  if (!text) return [];
  const out: TherapyOption[] = [];
  let currentDx = "";
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    const dxHeader = t.match(/^Если\s+подтвержд[ёе]н[а-яё]*\s*[:—-]?\s*(.+?):?\s*$/i);
    if (dxHeader) {
      currentDx = dxHeader[1].trim();
      continue;
    }
    if (/^Предупреждени[а-яё]*\s*[:.]?/i.test(t)) {
      const caution = t.replace(/^Предупреждени[а-яё]*\s*[:.]?\s*/i, "");
      if (caution && out.length > 0) out[out.length - 1].caution = caution;
      else if (caution && out.length === 0) {
        out.push({ name: "Общие предупреждения", caution });
      }
      continue;
    }
    const item = t.match(/^[-•*]\s*(.+)$/);
    if (!item) continue;
    const body = item[1].trim();
    const [head, ...restParts] = body.split(/\s+—\s+/);
    const rest = restParts.join(" — ");
    const evidence = body.match(/доказательност[а-яё]*\s*[:—-]?\s*([ABCD])(?![A-Za-z])/i)?.[1];
    const source =
      body.match(/(КР\s*Минздрава\s*(?:РФ)?\s*№?\s*\d{2,4}_\d+)/i)?.[1] ??
      body.match(/\b(NICE|WHO|ВОЗ|Cochrane|CDC|ESC|EMA|NCCN)\b/i)?.[1];
    const justification = rest
      .replace(/обоснование\s*[:—-]?\s*/i, "")
      .replace(/\(доказательность[^)]*\)/gi, "")
      .replace(/\(источник[^)]*\)/gi, "")
      .trim();
    out.push({
      name: head.replace(/\s*\((?:доказательность|источник)[^)]*\)/gi, "").trim(),
      regimen: extractRegimen(head),
      evidenceLevel: evidence,
      source: source ?? undefined,
      justification: justification || undefined,
      targetDx: currentDx || undefined,
    });
  }
  return out.slice(0, 12);
}

/** Доза/путь/кратность/длительность из головы пункта терапии. */
function extractRegimen(head: string): string | undefined {
  // Оставляем часть после первого упоминания дозы (цифры+мг/мкг/мл/МЕ/%)
  const m = head.match(/(\d+(?:[.,]\d+)?)\s*(?:мг|мкг|мл|МЕ|%|g|mg)/i);
  if (!m || m.index === undefined) return undefined;
  const tail = head.slice(m.index).trim();
  return tail.length > 2 ? tail : undefined;
}

/** Парсер мониторинга: «- Маркер — цель — частота». */
export function parseMonitoring(text: string): MonitoringMarker[] {
  if (!text) return [];
  const out: MonitoringMarker[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().replace(/^[-•*]\s*/, "");
    if (!t || t.length < 3) continue;
    if (/^(маркер|мониторинг|контроль)\b/i.test(t) && !t.includes("—")) continue;
    const parts = t.split(/\s*[—–]\s*|\s+\|\s+/).map((p) => p.trim());
    if (parts.length === 1) {
      out.push({ marker: parts[0] });
    } else if (parts.length === 2) {
      // Маркер — частота/цель (определяем по содержимому)
      if (/\d+\s*(мес|нед|дн|месяц|day|week|month)/i.test(parts[1]) || /кажд|еже|через/i.test(parts[1])) {
        out.push({ marker: parts[0], frequency: parts[1] });
      } else {
        out.push({ marker: parts[0], target: parts[1] });
      }
    } else {
      out.push({
        marker: parts[0],
        target: parts[1],
        frequency: parts[2],
        purpose: parts.slice(3).join(" — ") || undefined,
      });
    }
  }
  return out.slice(0, 12);
}

/**
 * Best-effort сверка гипотез с официальным репозиторием КР Минздрава РФ
 * по коду МКБ-10 (найденная КР прикрепляется к гипотезе как clinrecCode).
 */
async function attachClinrecsToDifferential(
  differential: DifferentialDiagnosis[],
): Promise<void> {
  for (const dx of differential.slice(0, 3)) {
    if (dx.clinrecCode || !dx.icd10) continue;
    try {
      if (!/^[A-TV-Z][0-9]{2}/.test(dx.icd10)) continue;
      const match = await findClinrecByMkb(dx.icd10, undefined);
      if (match) dx.clinrecCode = match.codeVersion;
    } catch {
      // Репозиторий недоступен — не критично
    }
  }
}
