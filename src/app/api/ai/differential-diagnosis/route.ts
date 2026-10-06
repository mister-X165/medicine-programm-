// СППВР v5.2 — Differential Diagnosis API (медкарта, ИИ-ассистент)
// ============================================================================
// Переработан по итогам пилотной эксплуатации. Устраняемые дефекты пилота:
//   1. «Ставится ОДИН диагноз без уточнения по анализам» →
//      ИИ обязан выдать 3–8 дифференциальных гипотез, у каждой — отдельные
//      массивы аргументов ЗА и ПРОТИВ (только из данных врача), вероятность,
//      различающий тест и план подтверждения конкретной гипотезы.
//   2. «Сразу предлагает лечение без обследования и без пояснений» →
//      медикаментозная терапия запрещена в промпте до верификации диагноза;
//      вместо неё — сводный ПЛАН ДООБСЛЕДОВАНИЯ (workupPlan с приоритетами)
//      и ОПЦИИ терапии формата «если подтверждён [диагноз]»: каждое серьёзное
//      лекарство требует развёрнутого обоснования (механизм, уровень
//      доказательности, источник КР/международный) и списка контролий ДО старта.
//   3. «Нейросеть додумала курение, хотя в карте указано „не курит“» →
//      жёсткий запрет домысливания анамнеза в системном промпте + обязательная
//      многопроходная САМОПРОВЕРКА (см. lib/ai-verify.ts): аудитор сверяет
//      каждый факт с исходными данными и удаляет выдуманное.
//   4. Поиск источников: КР Минздрава РФ (cr.minzdrav.gov.ru, см. minzdrav-cr)
//      + авторитетные МЕЖДУНАРОДНЫЕ источники (PubMed, ВОЗ, NICE, Cochrane,
//      CDC, ESC, EMA, NCCN — см. international-rag). Результаты прикрепляются
//      к конкретным гипотезам и возвращаются врачу.
//
// Конвейер: черновик LLM → парсинг/санитайз → матчинг КР Минздрава по каждой
// гипотезе → международный RAG по теме → сборка контекста (A) → N проходов
// аудита (AI_SELF_VERIFY_PASSES, по умолчанию 2) → финальный ответ + отчёт
// самопроверки. Ответ соответствует типу DDxResponse (lib/types.ts).
import { NextResponse } from "next/server";
import { llmChat, parseJSON } from "@/lib/ai-service";
import { requireAuth } from "@/lib/auth";
import { deidentifyText } from "@/lib/deidentify";
import { logger } from "@/lib/logger";
import {
  findClinrecByName,
  findClinrecByMkb,
  type ClinrecMatch,
} from "@/lib/minzdrav-cr";
import { runInternationalRag, type IntlRagResult } from "@/lib/international-rag";
import { verifyDraftText, getSelfVerifyPasses } from "@/lib/ai-verify";
import type {
  DDxResponse,
  DDxTherapyOption,
  VerificationReport,
  WorkupItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Сырая гипотеза из JSON LLM (до нормализации). */
interface RawHypothesis {
  diagnosis?: string;
  icd10?: string;
  probability?: number;
  argumentsFor?: string[];
  argumentsAgainst?: string[];
  workup?: string[];
  differentiator?: string;
  redFlags?: string[] | string;
  rationale?: string;
}

interface RawTherapyOption {
  targetDx?: string;
  name?: string;
  regimen?: string;
  justification?: string;
  evidenceLevel?: string;
  source?: string;
  caution?: string;
  preStartChecks?: string[];
}

interface RawWorkupItem {
  name?: string;
  priority?: string;
  purpose?: string;
  targetDx?: string;
}

interface RawDraft {
  diagnoses?: RawHypothesis[];
  workupPlan?: RawWorkupItem[];
  therapyOptions?: RawTherapyOption[];
  missingData?: string[];
}

const strArr = (v: unknown, max = 8, len = 300): string[] =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, len))
    : [];

const normPriority = (p?: string): WorkupItem["priority"] => {
  const s = (p || "").toLowerCase();
  if (/сроч|urgent|немедл|экстрен/.test(s)) return "urgent";
  if (/высок|high|приоритет/.test(s)) return "high";
  return "routine";
};

// ─── Системный промпт черновика (v5.2) ──────────────────────────────────────
const DRAFT_SYSTEM_PROMPT = `Ты — система поддержки врачебных решений (СППВР), помогающая врачу с дифференциальной диагностикой.
Опирайся ТОЛЬКО на клинические данные, предоставленные врачом. Не выдумывай факты.
ГРУБЕЙШАЯ ОШИБКА — домысливание анамнеза: если курение, алкоголь, аллергии, наследственность, профессия, образ жизни или прививки НЕ указаны врачом (или указано иное, например «не курит») — НЕ упоминай их как факт; при необходимости напиши «данных нет». Никаких выдуманных симптомов, значений анализов и событий.

Верни СТРОГО валидный JSON (без markdown-обёрток):
{
  "diagnoses": [
    {
      "diagnosis": "название диагноза (по-русски, клинически точное)",
      "icd10": "код МКБ-10 (например E11.9)",
      "probability": 0.0-1.0,
      "argumentsFor": ["аргумент ЗА — конкретный симптом/факт из данных врача", "..."],
      "argumentsAgainst": ["аргумент ПРОТИВ — что не укладывается в гипотезу или отличает её от альтернатив", "..."],
      "differentiator": "тест/признак, которым эта гипотеза различается с соседними",
      "redFlags": ["опасные признаки, требующие исключения в первую очередь"],
      "workup": ["конкретные обследования для подтверждения/исключения именно этой гипотезы (1-5)"],
      "rationale": "краткое патофизиологическое/эпидемиологическое обоснование (1-3 предложения)"
    }
  ],
  "workupPlan": [
    { "name": "обследование", "priority": "срочно|высокий|плановый", "purpose": "что подтвердить/исключить", "targetDx": "название гипотезы" }
  ],
  "therapyOptions": [
    {
      "targetDx": "диагноз, при подтверждении которого рассматривается опция",
      "name": "МНН + доза, путь, кратность, длительность",
      "justification": "РАЗВЁРНУТОЕ обоснование: механизм действия, почему именно этот препарат при данном состоянии",
      "evidenceLevel": "уровень доказательности (A/B/C, GRADE и т.п.)",
      "source": "КР Минздрава РФ / международный гайдлайн (только реально существующий)",
      "caution": "основные риски/противопоказания",
      "preStartChecks": ["обследования и контроли, ОБЯЗАТЕЛЬНЫЕ ДО старта этого препарата"]
    }
  ],
  "missingData": ["каких данных не хватает для уверенного выбора между гипотезами"]
}
Правила:
- 3–8 дифференциальных гипотез, отсортированных по убыванию вероятности; единственный диагноз запрещён.
- У каждой гипотезы обязаны быть и argumentsFor, и argumentsAgainst — оба из переданных данных.
- Обязательно включи опасные, требующие исключения состояния, даже при низкой вероятности.
- МЕДИКАМЕНТОЗНОЕ ЛЕЧЕНИЕ ДО ПОДТВЕРЖДЕНИЯ ДИАГНОЗА НЕ НАЗНАЧАЙ. therapyOptions — только условные опции «если подтверждён [диагноз]», каждая с развёрнутым обоснованием и preStartChecks. Если данных для обсуждения терапии недостаточно — верни пустой массив therapyOptions.
- workupPlan — сводный конкретный план обследования, закрывающий ВСЕ гипотезы, с приоритетами.
- Если опираешься на найденные источники (КР Минздрава, международные) — указывай их в source/rationale; вымышленные коды и названия запрещены.`;

/** Формат, который обязан сохранить аудитор (ai-verify) — описание JSON-схемы. */
const FORMAT_NOTE =
  `СТРОГО валидный JSON без markdown-обёрток со схемой: {"diagnoses":[{diagnosis, icd10, probability, argumentsFor[], argumentsAgainst[], differentiator, redFlags[], workup[], rationale}], "workupPlan":[{name, priority, purpose, targetDx}], "therapyOptions":[{targetDx, name, regimen, justification, evidenceLevel, source, caution, preStartChecks[]}], "missingData":[]}. Сохрани все поля и структуру черновика.`;

export async function POST(req: Request) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  let body: {
    symptoms: string;
    age?: number;
    sex?: string;
    history?: string;
    examiners?: string;
    patientId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (!body.symptoms?.trim()) {
    return NextResponse.json({ error: "Симптомы обязательны" }, { status: 400 });
  }

  const deidentified = deidentifyText(body.symptoms.trim()).text;
  const historyDeid = body.history ? deidentifyText(body.history.trim()).text : "";
  const examinersDeid = body.examiners ? deidentifyText(body.examiners.trim()).text : "";

  // Возрастная категория для подбора КР (дети/взрослые)
  const ageCategory = body.age != null ? (body.age < 18 ? 1 : 2) : null;

  const userMsg =
    `Симптомы и данные: ${deidentified}` +
    (body.age != null ? `\nВозраст: ${body.age}` : "") +
    (body.sex ? `\nПол: ${body.sex}` : "") +
    (historyDeid ? `\nАнамнез (только то, что указал врач): ${historyDeid}` : "") +
    (examinersDeid ? `\nОбследования/анализы: ${examinersDeid}` : "");

  // ─── 1. Черновик LLM ───────────────────────────────────────────────────
  const rawDraft = await llmChat(DRAFT_SYSTEM_PROMPT, userMsg, {
    json: true,
    temperature: 0.2,
    maxTokens: 4000,
  });
  if (!rawDraft) {
    return NextResponse.json(
      { error: "ИИ-ядро недоступно. Запустите LM Studio (см. раздел «О системе»)" },
      { status: 503 },
    );
  }

  const parsed = parseJSON<RawDraft>(rawDraft);
  if (!parsed?.diagnoses?.length) {
    return NextResponse.json<DDxResponse>({
      diagnoses: [],
      workupPlan: [],
      therapyOptions: [],
      raw: rawDraft,
      error: "Не удалось разобрать ответ ИИ.",
    });
  }

  // ─── 2. Нормализация гипотез (гарантия ЗА/ПРОТИВ у каждой) ─────────────
  interface Hypo {
    diagnosis: string;
    icd10: string;
    probability: number;
    argumentsFor: string[];
    argumentsAgainst: string[];
    workup: string[];
    redFlags: string[];
    differentiator?: string;
    rationale?: string;
  }
  const normalize = (list: RawHypothesis[]): Hypo[] =>
    list
      .map<Hypo>((d) => {
        const forArgs = strArr(d.argumentsFor, 8);
        const againstArgs = strArr(d.argumentsAgainst, 8);
        // fallback: если модель положила всё в rationale — не теряем аргументы
        if (forArgs.length === 0 && d.rationale) forArgs.push(String(d.rationale).slice(0, 300));
        return {
          diagnosis: (d.diagnosis || "—").slice(0, 200),
          icd10: (d.icd10 || "").toUpperCase().slice(0, 20),
          probability: Math.max(0, Math.min(1, Number(d.probability) || 0)),
          argumentsFor: forArgs,
          argumentsAgainst: againstArgs,
          differentiator: d.differentiator?.slice(0, 300),
          redFlags: typeof d.redFlags === "string" ? strArr([d.redFlags]) : strArr(d.redFlags),
          workup: strArr(d.workup, 6, 200),
          rationale: d.rationale?.slice(0, 600),
        };
      })
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 10);

  const hypotheses = normalize(parsed.diagnoses);

  const workupPlan: WorkupItem[] = (Array.isArray(parsed.workupPlan) ? parsed.workupPlan : [])
    .slice(0, 15)
    .map((w) => ({
      name: String(w.name || "—").slice(0, 200),
      priority: normPriority(w.priority),
      purpose: w.purpose?.slice(0, 300),
      targetDx: w.targetDx?.slice(0, 200),
    }));

  const therapyOptions: DDxTherapyOption[] = (
    Array.isArray(parsed.therapyOptions) ? parsed.therapyOptions : []
  )
    .slice(0, 12)
    .map((t) => ({
      targetDx: String(t.targetDx || "—").slice(0, 200),
      name: String(t.name || "—").slice(0, 300),
      regimen: t.regimen?.slice(0, 300),
      justification: t.justification?.slice(0, 900),
      evidenceLevel: t.evidenceLevel?.slice(0, 120),
      source: t.source?.slice(0, 300),
      caution: t.caution?.slice(0, 400),
      preStartChecks: strArr(t.preStartChecks, 8, 200),
    }));

  // ─── 3. Сверка каждой гипотезы с КР Минздрава РФ ───────────────────────
  const matchClinrec = async (
    h: { diagnosis: string; icd10: string },
  ): Promise<ClinrecMatch | null> => {
    try {
      if (h.icd10 && /^[A-TV-Z][0-9]{2}/.test(h.icd10)) {
        const byMkb = await findClinrecByMkb(h.icd10, ageCategory);
        if (byMkb) return byMkb;
      }
      return await findClinrecByName(h.diagnosis, ageCategory);
    } catch (e) {
      logger.warn("ai", "Clinrec match failed (non-blocking)", {
        diagnosis: h.diagnosis.slice(0, 60),
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  };

  const clinrecByHypo: Array<ClinrecMatch | null> = await Promise.all(
    hypotheses.map(matchClinrec),
  );

  // ─── 4. Международные авторитетные источники (PubMed/ВОЗ/NICE/…) ───────
  let intlResults: IntlRagResult[] = [];
  let englishQuery = "";
  try {
    const topic = [
      hypotheses[0]?.diagnosis,
      hypotheses[1]?.diagnosis,
      hypotheses[2]?.diagnosis,
      deidentified.slice(0, 160),
    ]
      .filter(Boolean)
      .join(" ");
    const intl = await runInternationalRag({ sanitizedQuery: topic, maxResults: 8 });
    intlResults = intl.results;
    englishQuery = intl.englishQuery;
  } catch (e) {
    logger.warn("ai", "International RAG failed (non-blocking)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const toRef = (r: IntlRagResult) => ({ title: r.title.slice(0, 250), url: r.url, source: r.source });

  // Тематическая привязка международных результатов к гипотезам
  const intlByHypo: Array<Array<{ title: string; url: string; source: string }>> = hypotheses.map(
    (h) => {
      const key = (h.diagnosis || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)[0] ?? "";
      const direct = intlResults.filter((r) => key && r.title.toLowerCase().includes(key.slice(0, 12)));
      return (direct.length ? direct : intlResults).slice(0, 3).map(toRef);
    },
  );

  // ─── 5. ГЛУБОКИЙ АНАЛИЗ: многопроходная самопроверка (черновик→аудит) ──
  const draftJson = JSON.stringify({ diagnoses: hypotheses, workupPlan, therapyOptions });

  // Контекст аудитора (A): исходные данные + реально найденные источники,
  // чтобы аудитор мог удалить вымышленные ссылки и домысленные факты.
  const sourcesBlock = [
    ...clinrecByHypo
      .filter((c): c is ClinrecMatch => !!c)
      .map((c) => `КР Минздрава РФ: ${c.codeVersion} — ${c.name} (${c.url})`),
    ...intlResults.map((r) => `Международный источник (${r.source}): ${r.title} (${r.url})`),
  ].join("\n");

  const sourceDataContext =
    `${userMsg}\n\nРЕАЛЬНО НАЙДЕННЫЕ ИСТОЧНИКИ (ссылаться можно только на них):\n${sourcesBlock || "— источники не найдены —"}`;

  const passes = getSelfVerifyPasses();
  let finalText = draftJson;
  let verification: VerificationReport = { performed: false, passes: 0, corrections: [] };

  if (passes > 0) {
    const t0 = Date.now();
    const res = await verifyDraftText({
      draft: draftJson,
      sourceData: sourceDataContext,
      passes,
      formatNote: FORMAT_NOTE,
      maxTokens: 6000,
      logTag: "ai-ddx",
    });
    finalText = res.text;
    verification = res.verification;
    logger.info("ai", "DDx self-verification finished", {
      passes: verification.passes,
      corrections: verification.corrections.length,
      elapsedMs: Date.now() - t0,
    });
  }

  // Парсим финальную версию; при сбое аудита — остаёмся на нормализованном черновике
  const finalParsed = parseJSON<RawDraft>(finalText);
  const finalDiagnoses: Hypo[] =
    finalParsed?.diagnoses && finalParsed.diagnoses.length >= 3
      ? normalize(finalParsed.diagnoses)
      : hypotheses;

  const finalWorkupPlan: WorkupItem[] =
    finalParsed?.workupPlan && finalParsed.workupPlan.length
      ? finalParsed.workupPlan.slice(0, 15).map((w) => ({
          name: String(w.name || "—").slice(0, 200),
          priority: normPriority(w.priority),
          purpose: w.purpose?.slice(0, 300),
          targetDx: w.targetDx?.slice(0, 200),
        }))
      : workupPlan;

  const finalTherapy: DDxTherapyOption[] =
    finalParsed && Array.isArray(finalParsed.therapyOptions)
      ? finalParsed.therapyOptions.slice(0, 12).map((t) => ({
          targetDx: String(t.targetDx || "—").slice(0, 200),
          name: String(t.name || "—").slice(0, 300),
          regimen: t.regimen?.slice(0, 300),
          justification: t.justification?.slice(0, 900),
          evidenceLevel: t.evidenceLevel?.slice(0, 120),
          source: t.source?.slice(0, 300),
          caution: t.caution?.slice(0, 400),
          preStartChecks: strArr(t.preStartChecks, 8, 200),
        }))
      : therapyOptions;

  // Матчинг КР пересобираем под финальные названия гипотез (кеш minzdrav-cr)
  const finalClinrec: Array<ClinrecMatch | null> = await Promise.all(
    finalDiagnoses.map(async (h, i) => {
      const prev = clinrecByHypo[i];
      if (
        prev &&
        prev.name &&
        h.diagnosis &&
        (prev.name.toLowerCase().includes(h.diagnosis.toLowerCase().slice(0, 15)) ||
          h.diagnosis.toLowerCase().includes(prev.name.toLowerCase().slice(0, 15)))
      ) {
        return prev;
      }
      const fresh = await matchClinrec(h);
      return fresh ?? prev ?? null;
    }),
  );

  const confirmedCount = finalClinrec.filter(Boolean).length;

  logger.info("ai", "DDx v5.2 generated (multi-hypothesis + self-verify + intl sources)", {
    count: finalDiagnoses.length,
    confirmedWithClinrec: confirmedCount,
    internationalCount: intlResults.length,
    verifyPasses: verification.passes,
  });

  const response: DDxResponse = {
    diagnoses: finalDiagnoses.map((h, i) => {
      const cr = finalClinrec[i];
      return {
        diagnosis: h.diagnosis,
        icd10: h.icd10,
        probability: h.probability,
        argumentsFor: h.argumentsFor,
        argumentsAgainst: h.argumentsAgainst,
        workup: h.workup,
        differentiator: h.differentiator,
        redFlags: h.redFlags,
        rationale: h.rationale,
        clinrec: cr
          ? {
              codeVersion: cr.codeVersion,
              name: cr.name,
              mkbString: cr.mkbString,
              url: cr.url,
              pdfUrl: cr.pdfUrl,
              npcApproved: cr.npcApproved,
              ageCategory: cr.ageCategory,
              developers: cr.developers,
              publishDate: cr.publishDate,
              matchType:
                cr.mkbString && h.icd10 && cr.mkbString.toUpperCase().includes(h.icd10.slice(0, 4))
                  ? ("mkb" as const)
                  : ("name" as const),
            }
          : null,
        intlSources:
          intlByHypo[i] ??
          (finalDiagnoses.length <= hypotheses.length ? [] : intlResults.slice(0, 3).map(toRef)),
      };
    }),
    workupPlan: finalWorkupPlan,
    therapyOptions: finalTherapy,
    verification,
    clinrecSummary: {
      matched: confirmedCount,
      total: finalDiagnoses.length,
      source: "Минздрав РФ — Клинические рекомендации (cr.minzdrav.gov.ru)",
      internationalCount: intlResults.length,
      internationalQuery: englishQuery,
    },
    provider: "lm-studio",
  };

  return NextResponse.json(response);
}
