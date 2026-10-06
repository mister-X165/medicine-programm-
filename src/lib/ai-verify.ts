// СППВР v5.2 — ГЛУБОКИЙ АНАЛИЗ: многопроходная самопроверка ИИ
// ============================================================================
// Общая реализация принципа «черновик → аудит → исправление» для всех ИИ-модулей
// (анализ кейса, дифференциальный диагноз в медкарте). Раньше такая проверка
// была встроена только в конвейер анализа кейсов; теперь она вынесена сюда и
// вызывается повторно (AI_SELF_VERIFY_PASSES, по умолчанию 2 прохода), чтобы
// ИИ сам перепроверял ответ несколько раз до выдачи врачу.
//
// Каждый проход — отдельный LLM-запрос с ролью «клинический аудитор»:
//   • ФАКТЫ: ни одно утверждение не должно противоречить исходным данным
//     (главный дефект пилота — ИИ «додумал курение», хотя в карте указано
//     «не курит»). Всё, чего нет в данных, удаляется или помечается
//     «данных нет в предоставленных материалах».
//   • ПОЛНОТА: диагноз не может быть единственным — требуется 3–8 гипотез с
//     аргументами ЗА/ПРОТИВ.
//   • ТЕРАПИЯ: не назначается до подтверждения диагноза; каждое серьёзное
//     лекарство требует развёрнутого обоснования (механизм, доказательность,
//     источник, контроль ДО старта).
//   • ИСТОЧНИКИ: допускаются только реально присутствующие в контексте КР
//     Минздрава РФ и международные гайдлайны (PubMed/ВОЗ/NICE/Cochrane/CDC/ESC/EMA/NCCN).
//
// Результат проходов — отчёт исправлений (VerificationReport), который UI
// показывает врачу («Самопроверка: N проходов, исправлено: …»).
// ============================================================================

import { llmChat } from "./ai-service";
import { logger, type LogCategory } from "./logger";
import type { VerificationReport } from "./types";

/** Число проходов самопроверки из ENV (по умолчанию 2, минимум 1). */
export function getSelfVerifyPasses(): number {
  if (process.env.AI_DEEP_ANALYSIS === "false") return 0;
  const n = parseInt(process.env.AI_SELF_VERIFY_PASSES ?? "2", 10);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(4, n));
}

/**
 * Системный промпт аудитора. `formatNote` описывает требуемый формат ответа
 * (для текстовых заключений — «### РАЗДЕЛЫ», для JSON — строгая схема).
 */
export function buildAuditorSystemPrompt(formatNote: string): string {
  return `Ты — клинический аудитор СППВР (виртуальный консилиум проверки заключения). Тебе даны (A) исходные данные пациента и (B) ЧЕРНОВИК заключения ИИ. Проверь черновик и верни ИСПРАВЛЕННУЮ ФИНАЛЬНУЮ ВЕРСИЮ.

ОТВЕТ — ${formatNote}

ПРОВЕРКИ (применить каждую):
1. ФАКТЫ: каждый факт обязан следовать из (A). Особо — анамнез: курение, алкоголь, аллергии, наследственность, профессия, образ жизни, прививки. Если в (A) это НЕ указано (или указано иное, напр. «не курит») — УДАЛИ утверждение черновика, замени на «данных нет в предоставленных материалах». Домысливание анамнеза — грубейшая ошибка, удаляй без сожаления. Никаких выдуманных симптомов, значений анализов и событий.
2. ДИФФЕРЕНЦИАЛЬНЫЙ РЯД: должно быть 3–8 гипотез, у каждой — аргументы ЗА и ПРОТИВ именно из данных (A), вероятность ~NN%, план подтверждения. Единственный диагноз без альтернатив — исправь (дополни гипотезами и различающими тестами).
3. ТЕРАПИЯ: не должна назначаться до подтверждения диагноза — только как опции «если подтверждён [диагноз]». У каждого препарата — МНН, доза, путь, кратность, длительность, РАЗВЁРНУТОЕ обоснование (механизм действия, почему именно этот препарат), уровень доказательности, источник (КР Минздрава РФ / международный гайдлайн); для препаратов с серьёзным профилем риска — какие обследования/контроли нужны ДО старта. Исправь неверные или опасные дозы.
4. ОБСЛЕДОВАНИЕ: сводный план должен закрывать все гипотезы, быть конкретным, с приоритетами (срочно/высокий/плановый).
5. ИСТОЧНИКИ: ссылки на КР Минздрава РФ (коды вида 601_2) и международные источники (PubMed, ВОЗ, NICE, Cochrane, CDC, ESC, EMA, NCCN) — только те, что реально есть в контексте (A). Вымышленные коды/названия — удалить.
6. КОНКРЕТНОСТЬ: удали водянистые фразы и общие слова вместо клиники; заключение адресовано врачу и обязано быть конкретным и развёрнутым.
7. Сохрани структуру и формат черновика (названия разделов/поля JSON, каркас гипотез).

В самом конце добавь раздел:
### ОТЧЁТ САМОПРОВЕРКИ
Строки:
- Исправлено: [что именно исправлено]
- Подтверждено: [какие блоки проверены и оставлены без изменений]
Если серьёзных правок нет — строка «- Исправлено: существенных расхождений с исходными данными не выявлено».

Верни ТОЛЬКО финальный текст, без каких-либо пояснений.`;
}

/**
 * Извлекает «### ОТЧЁТ САМОПРОВЕРКИ» из текста и удаляет его из тела ответа.
 * Экспортируется из маршрута анализа кейсов (совместимость) и переиспользуется здесь.
 */
export function extractVerificationReportFromText(text: string): {
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
 * Многопроходная самопроверка текста ответа ИИ.
 * @returns финальный (возможно исправленный) текст + отчёт verification
 */
export async function verifyDraftText(params: {
  draft: string;
  sourceData: string;
  passes: number;
  formatNote: string;
  maxTokens?: number;
  logTag?: LogCategory;
}): Promise<{ text: string; verification: VerificationReport }> {
  const { draft, sourceData, passes, formatNote, maxTokens, logTag = "ai" as LogCategory } = params;
  const verification: VerificationReport = {
    performed: false,
    passes: 0,
    corrections: [],
  };

  let corrected = draft;
  if (passes <= 0 || !draft || draft.trim().length < 50) {
    return { text: draft, verification };
  }

  const system = buildAuditorSystemPrompt(formatNote);
  for (let pass = 1; pass <= passes; pass++) {
    const verified = await llmChat(system, `ИСХОДНЫЕ ДАННЫЕ (A):\n${sourceData}\n\nЧЕРНОВИК (B):\n${corrected}`, {
      json: false,
      maxTokens,
      temperature: 0.1,
    });
    if (verified && verified.trim().length >= 50) {
      corrected = verified;
      verification.passes = pass;
    } else {
      logger.warn(logTag, "Проход самопроверки вернул пустой ответ", { pass });
      break;
    }
  }

  const { corrections, cleaned } = extractVerificationReportFromText(corrected);
  verification.corrections = corrections;
  verification.performed = verification.passes > 0;
  // Model self-review does not establish grounding in patient data.
  verification.factsGrounded = undefined;
  verification.verifiedAt = new Date().toISOString();

  logger.info(logTag, "Глубокий анализ: самопроверка завершена", {
    passes: verification.passes,
    corrections: corrections.length,
  });

  return { text: cleaned, verification };
}

