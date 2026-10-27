// СППВР v2.0 — Therapy Recommendations API
// POST /api/cases/[id]/therapy — Generate therapy recommendations

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { llmChat, parseJSON, getActiveProvider } from "@/lib/ai-service";
import { logger } from "@/lib/logger";
import { safeJsonParse } from "@/lib/utils";
import { appendAudit } from "@/lib/audit";
import { requireCaseAccess } from "@/lib/case-access";
import type { TherapyRecommendation, Mutation, Recommendation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM_PROMPT = `Ты — клинический фармаколог и онколог-генетик. На основе данных анализа пациента предложи конкретные рекомендации по терапии.

ОБЯЗАТЕЛЬНО укажи для каждого препарата:
- МНН (международное непатентованное название)
- Точная доза (в мг/мкг/МЕ)
- Путь введения (перорально, в/в, в/м, п/к и т.д.)
- Кратность (1-2-3 раза/сутки, через день и т.д.)
- Длительность курса
- Развёрнутое обоснование: механизм действия, почему именно этот препарат предпочтителен в данной ситуации, ожидаемый клинический эффект, уровень доказательности A/B/C и источник (КР Минздрава РФ [код], NICE, ESC, WHO и т.п.)

КАТЕГОРИИ (используй ровно эти значения для поля "category"):
- "medications" — Рекомендуемые препараты (основная терапия)
- "tactics" — Тактики лечения (линия терапии, режим, обоснование выбора)
- "tests" — Рекомендуемые анализы и мониторинг
- "dose_adjustments" — Коррекция доз (на основе генетического профиля, функции почек/печени)
- "alternatives" — Альтернативные схемы (если основная неприменима)

ПРАВИЛА:
1. Опирайся ТОЛЬКО на предоставленные данные (диагноз, мутации, рекомендации, DDI). НЕ домысливай анамнез (курение, алкоголь, аллергии, наследственность), если его нет в данных.
2. Не придумывай препараты, не соответствующие диагнозу.
3. Если диагноз НЕ подтверждён (нет результатов подтверждающего обследования) — СНАЧАЛА перечисли в категории "tests" обязательные обследования для подтверждения, и только потом давай препараты: каждый препарат описывай как опцию «после подтверждения диагноза», с обоснованием и предупреждениями.
4. Для препаратов с серьёзным профилем риска обязательно укажи, какие обследования/контроли нужны ДО старта терапии (например, функция почек, ЭКГ, беременность и т.п.).
5. Учитывай лекарственные взаимодействия (DDI) и фармакогеномные особенности.
6. Если есть противопоказание к препарату первой линии — обязательно предложи альтернативу.

Ответь ТОЛЬКО валидным JSON (без markdown-обёртки, без пояснений). Формат:
[
  {
    "category": "medications",
    "items": [
      {
        "name": "Метформин",
        "description": "1000 мг перорально 2 раза/сутки, длительно. После подтверждения диагноза СД2. Обоснование: снижает глюконеогенез в печени и повышает чувствительность тканей к инсулину; препарат первой линии при СД2, снижает макрососудистые осложнения. До старта: СКФ, функция печени.",
        "priority": "high",
        "evidenceLevel": "A"
      }
    ]
  },
  {
    "category": "tests",
    "items": [
      {
        "name": "Гликированный гемоглобин (HbA1c)",
        "description": "Контроль каждые 3 месяца. Целевое значение < 7%.",
        "priority": "high"
      }
    ]
  }
]`;

// v2.7.2 (audit fix): нормализация приоритета из LLM-ответа к строгому union.
function normalizePriority(value: unknown): "high" | "medium" | "low" {
  const v = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (v === "high" || v === "высокий" || v === "critical" || v === "критический") return "high";
  if (v === "low" || v === "низкий") return "low";
  return "medium";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  try {
    // SECURITY (v2.1.4): enforce case ownership — previously any logged-in
    // doctor could trigger AI therapy generation for ANY case (IDOR + AI
    // resource abuse). Also fixes audit forgery: the audit entry now uses
    // session.doctorId (the acting doctor) instead of found.doctorId.
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const found = await db.case.findUnique({
      where: { id: caseId },
      include: { analysis: true },
    });

    if (!found) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    if (!found.analysis) {
      return NextResponse.json({ error: "Analysis not performed. Run analysis first." }, { status: 400 });
    }

    const provider = await getActiveProvider();
    const aiAvailable = provider !== "none";

    const mutations: Mutation[] = safeJsonParse(found.analysis.mutations, []);
    const recommendations: Recommendation[] = safeJsonParse(found.analysis.recommendations, []);
    const conclusion = found.analysis.conclusion || "";
    const sections = safeJsonParse(found.analysis.sections, []);

    const contextParts: string[] = [];
    if (found.diagnosisHint) contextParts.push(`Диагноз: ${found.diagnosisHint}`);
    if (mutations.length > 0) {
      contextParts.push("Выявленные мутации:\n" + mutations.map((m) => `- ${m.gene}: ${m.variant} (${m.clinicalSignificance}) — ${m.interpretation}`).join("\n"));
    }
    if (recommendations.length > 0) {
      contextParts.push("Клинические рекомендации (RAG):\n" + recommendations.slice(0, 5).map((r) => `- ${r.title}: ${r.content.slice(0, 200)} (источник: ${r.source})`).join("\n"));
    }
    if (conclusion) contextParts.push(`Заключение:\n${conclusion.slice(0, 1500)}`);
    if (Array.isArray(sections) && sections.length > 0) {
      const sectionsText = sections.map((s: { title: string; content: string }) => `${s.title}: ${s.content?.slice(0, 400) || ""}`).join("\n");
      contextParts.push(`Разделы анализа:\n${sectionsText}`);
    }

    if (contextParts.length === 0) {
      return NextResponse.json({ error: "Insufficient data for recommendations." }, { status: 400 });
    }

    const userMessage = contextParts.join("\n\n");
    // In manual mode (provider === "none") skip the LLM call entirely —
    // llmChat() would return null anyway, but skipping avoids the network
    // timeout/round-trip and makes the intent explicit. The fallback below
    // then produces rule-based recommendations from the analysis data.
    const raw = aiAvailable
      ? await llmChat(SYSTEM_PROMPT, userMessage, { json: true, maxTokens: 6144 })
      : null;

    let therapyRecommendations: TherapyRecommendation[] = [];
    if (raw) {
      const parsed = parseJSON<TherapyRecommendation[]>(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        therapyRecommendations = parsed.map((cat) => ({
          category: cat.category,
          // v2.7.2 (audit fix): приоритет нормализуется к допустимым значениям —
          // LLM может вернуть произвольную строку.
          items: (cat.items || []).map((item: Record<string, unknown>) => ({
            name: (item.name as string) || (item.title as string) || "",
            description: (item.description as string) || (item.details as string) || "",
            priority: normalizePriority(item.priority),
            evidenceLevel: (item.evidenceLevel as string) || undefined,
          })),
        }));
      }
    }

    if (therapyRecommendations.length === 0) {
      therapyRecommendations = buildFallbackRecommendations(mutations, recommendations);
    }

    await db.analysisResult.update({
      where: { caseId },
      data: { therapyRecommendations: JSON.stringify(therapyRecommendations) },
    });

    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "therapy_recommendations",
      details: JSON.stringify({
        provider,
        categoryCount: therapyRecommendations.length,
        totalItems: therapyRecommendations.reduce((sum, c) => sum + c.items.length, 0),
      }),
    }).catch(() => {});

    logger.info("therapy", "Therapy recommendations generated", { caseId, provider, aiAvailable });

    return NextResponse.json({ therapyRecommendations, aiAvailable });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "therapy POST error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildFallbackRecommendations(
  mutations: Mutation[],
  recommendations: Recommendation[],
): TherapyRecommendation[] {
  const result: TherapyRecommendation[] = [];

  const medItems = recommendations
    .filter((r) => r.category === "therapy" || r.title.toLowerCase().includes("drug"))
    .slice(0, 5)
    .map((r) => ({ name: r.title, description: r.content.slice(0, 300), priority: "medium" as const }));
  if (medItems.length > 0) result.push({ category: "medications", items: medItems });

  if (mutations.length > 0) {
    result.push({
      category: "tests",
      items: [
        { name: "Genetic marker monitoring", description: `Monitor markers: ${mutations.map((m) => m.gene).join(", ")}. Every 3 months.`, priority: "high" as const },
        { name: "Complete blood count", description: "Hematological monitoring during therapy. Weekly first month, then monthly.", priority: "high" as const },
      ],
    });

    const doseItems = mutations
      .filter((m) => m.clinicalSignificance === "pathogenic" || m.clinicalSignificance === "likely_pathogenic")
      .map((m) => ({ name: `Dose adjustment (${m.gene})`, description: `Mutation ${m.gene}: ${m.variant} may affect drug metabolism. Pharmacogenetic consultation recommended.`, priority: "high" as const }));
    if (doseItems.length > 0) result.push({ category: "dose_adjustments", items: doseItems });
  }

  // Safety net (manual mode): always return at least one actionable
  // recommendation so the UI doesn't render an empty state when AI is
  // unavailable and the case has no mutations / therapy-tagged RAG hits.
  // This mirrors the "graceful degradation to manual mode" contract.
  if (result.length === 0) {
    result.push({
      category: "tactics",
      items: [
        {
          name: "Consult with specialist",
          description:
            "AI therapy engine unavailable. Review the case analysis manually and consult with a clinical pharmacologist-oncologist before prescribing. Confirm diagnosis, genetic profile, and any contraindications before initiating therapy.",
          priority: "high" as const,
        },
      ],
    });
  }

  return result;
}
