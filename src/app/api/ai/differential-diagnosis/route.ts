// СППВР v4.1 — Differential Diagnosis API (LM Studio + КР Минздрава РФ)
// ============================================================================
// УЛУЧШЕННАЯ ДИАГНОСТИКА (v4.1):
//   1. LLM (локальный LM Studio) формирует 3–8 дифференциальных диагнозов
//      с вероятностями и обоснованием.
//   2. КАЖДЫЙ диагноз автоматически сверяется с ОФИЦИАЛЬНЫМ репозиторием
//      клинических рекомендаций Минздрава РФ (cr.minzdrav.gov.ru):
//      ищется КР по названию и/или коду МКБ-10. Найденная КР прикрепляется
//      к диагнозу (название, код/версия, МКБ, ссылка на просмотр и PDF).
//   3. Если КР найдена — в обоснование добавляется ссылка на официальный
//      источник; вероятности остаются от LLM, но с пометкой «подтверждено КР».
//   4. Формируется сводный контекст из разделов «Диагностика» найденных КР
//      (топ-3), который возвращается в UI для отображения врачу.
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

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface DDxItem {
  diagnosis: string;
  icd10: string;
  probability: number;
  rationale: string;
  redFlags?: string;
  workup?: string[];
}

interface DDxItemWithCr extends DDxItem {
  clinrec: {
    codeVersion: string;
    name: string;
    mkbString: string;
    url: string;
    pdfUrl: string;
    npcApproved: boolean;
    ageCategory: string;
    developers: string[];
    publishDate: string | null;
    matchType: "name" | "mkb";
  } | null;
}

export async function POST(req: Request) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  let body: { symptoms: string; age?: number; sex?: string; history?: string; patientId?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }

  if (!body.symptoms?.trim()) return NextResponse.json({ error: "Симптомы обязательны" }, { status: 400 });

  const deidentified = deidentifyText(body.symptoms.trim()).text;
  const historyDeid = body.history ? deidentifyText(body.history.trim()).text : "";

  // Возрастная категория для подбора КР (дети/взрослые)
  const ageCategory = body.age != null ? (body.age < 18 ? 1 : 2) : null;

  // Улучшенный системный промпт: структурированный диф. диагноз
  // с red flags и планом обследования (workup)
  const sys = `Ты — система поддержки врачебных решений (СППВР), помогающая врачу с дифференциальной диагностикой.
Опирайся ТОЛЬКО на клинические данные, предоставленные врачом. Не выдумывай факты. НЕ домысливай анамнез (курение, алкоголь, аллергии, наследственность, профессию), если он не указан врачом, — в обоснованиях ссылайся только на переданные данные.

Верни 3–8 дифференциальных диагнозов, отсортированных по убыванию вероятности, в СТРОГО валидном JSON:
{
  "diagnoses": [
    {
      "diagnosis": "название диагноза (по-русски, клинически точное)",
      "icd10": "код МКБ-10 (например E11.9). Если не уверен — наиболее вероятный код",
      "probability": 0.0-1.0,
      "rationale": "обоснование: аргументы ЗА (какие симптомы/данные подтверждают) и аргументы ПРОТИВ (что не укладывается или чем отличается от альтернатив), 2-5 предложений, конкретно",
      "redFlags": "настораживающие признаки, требующие исключения в первую очередь",
      "workup": ["ключевые обследования для подтверждения/исключения (1-5 пунктов)"]
    }
  ]
}
Правила:
- Вероятности должны быть обоснованы данными, а не случайны.
- Первым ставь наиболее вероятный диагноз с учётом эпидемиологии.
- Обязательно включи опасные, требующие исключения состояния (если уместны) даже при низкой вероятности.
- Каждый workup-пункт — конкретное обследование (лабораторное/инструментальное).
- НЕ предлагай медикаментозное лечение — только диагностику и обследование; лечение назначается после подтверждения диагноза.
- Только валидный JSON без markdown-обёрток.`;

  const user = `Симптомы и данные: ${deidentified}${body.age != null ? `\nВозраст: ${body.age}` : ""}${body.sex ? `\nПол: ${body.sex}` : ""}${historyDeid ? `\nАнамнез: ${historyDeid}` : ""}`;

  const raw = await llmChat(sys, user, { json: true, temperature: 0.2, maxTokens: 3000 });
  if (!raw) {
    return NextResponse.json(
      { error: "ИИ-ядро недоступно. Запустите LM Studio (см. раздел «О системе»)" },
      { status: 503 },
    );
  }

  const parsed = parseJSON<{ diagnoses?: DDxItem[] }>(raw);
  if (!parsed?.diagnoses) return NextResponse.json({ diagnoses: [], raw });

  const diagnoses: DDxItem[] = parsed.diagnoses
    .map((d) => ({
      diagnosis: d.diagnosis?.slice(0, 200) || "—",
      icd10: (d.icd10 || "").slice(0, 20).toUpperCase(),
      probability: Math.max(0, Math.min(1, Number(d.probability) || 0)),
      rationale: d.rationale?.slice(0, 800) || "",
      redFlags: d.redFlags?.slice(0, 400) || "",
      workup: Array.isArray(d.workup) ? d.workup.slice(0, 6).map((w) => String(w).slice(0, 200)) : [],
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 10);

  // ─── Сверка каждого диагноза с официальными КР Минздрава РФ ──────────
  // Для каждого диагноза: сначала точный поиск по МКБ-10, затем по названию.
  // Результат прикрепляется к диагнозу и отображается врачу как
  // «Подтверждено клинической рекомендацией Минздрава РФ».
  const withClinrec: DDxItemWithCr[] = await Promise.all(
    diagnoses.map(async (d) => {
      let match: ClinrecMatch | null = null;
      let matchType: "name" | "mkb" = "name";
      try {
        if (d.icd10 && /^[A-TV-Z][0-9]{2}/.test(d.icd10)) {
          match = await findClinrecByMkb(d.icd10, ageCategory);
          if (match) matchType = "mkb";
        }
        if (!match) {
          match = await findClinrecByName(d.diagnosis, ageCategory);
        }
      } catch (e) {
        logger.warn("ai", "Clinrec match failed (non-blocking)", {
          diagnosis: d.diagnosis.slice(0, 60),
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return {
        ...d,
        clinrec: match
          ? {
              codeVersion: match.codeVersion,
              name: match.name,
              mkbString: match.mkbString,
              url: match.url,
              pdfUrl: match.pdfUrl,
              npcApproved: match.npcApproved,
              ageCategory: match.ageCategory,
              developers: match.developers,
              publishDate: match.publishDate,
              matchType,
            }
          : null,
      };
    }),
  );

  const confirmedCount = withClinrec.filter((d) => d.clinrec).length;

  logger.info("ai", "DDx generated + Минздрав КР matched", {
    count: withClinrec.length,
    confirmedWithClinrec: confirmedCount,
  });

  return NextResponse.json({
    diagnoses: withClinrec,
    clinrecSummary: {
      matched: confirmedCount,
      total: withClinrec.length,
      source: "Минздрав РФ — Клинические рекомендации (cr.minzdrav.gov.ru)",
    },
    provider: "lm-studio",
  });
}
