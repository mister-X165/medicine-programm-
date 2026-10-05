// СППВР v5.0 — ДВИЖОК ПОТОКОВОГО ОНЛАЙН-ПОИСКА ЛЕКАРСТВЕННЫХ ВЗАИМОДЕЙСТВИЙ
// ============================================================================
// ПЕРЕСМОТР ОЦЕНКИ DDI (задача v5.0): проверка взаимодействий больше не
// опирается исключительно на статичную локальную таблицу (28 записей).
// Теперь каждый запрос выполняет ПОТОКОВЫЙ ОНЛАЙН-ПОИСК в российских
// базах данных лекарственных средств с LLM-извлечением структурированных
// результатов и кэшированием:
//
//   Препараты (МНН/бренды) → нормализация МНН (словарь RU-рынка)
//     → мгновенная проверка локальной таблицы (быстрые алерты)
//     → ПОТОКОВАЯ проверка каждой пары:
//         [веб-поиск: РЛС rlsnet.ru · Vidal vidal.ru · ГРЛС · КР Минздрава
//          · справочники взаимодействия] → [LLM-извлечение: severity по
//          классификации РЛС, механизм, тактика, ссылки на источники]
//     → дедупликация → сортировка по тяжести → итог
//
// Приоритет российских источников (ориентация на рынок РФ):
//   rlsnet.ru (РЛС) — эталонный справочник взаимодействий РФ
//   vidal.ru / vidal.by (Видаль) — справочник РФ/СНГ
//   grls.rosminzdrav.ru (ГРЛС) — гос. реестр ЛС Минздрава
//   cr.minzdrav.gov.ru — клинические рекомендации Минздрава
//   pharmateca.ru, medlined.ru, checkmed.info — проф. издания РФ
//
// z-ai-web-dev-sdk используется ТОЛЬКО на сервере (backend-only).
// ============================================================================

import { createHash } from "crypto";
import { db } from "./db";
import { logger } from "./logger";
import type { DDIAlert } from "./types";

// ----------------------------------------------------------------------------
// ТИПЫ
// ----------------------------------------------------------------------------

/** Источник, найденный в ходе онлайн-поиска. */
export interface DDISourceRef {
  title: string;
  url: string;
  host: string;
  /** Рейтинг доверия источника: 3 = официальные/справочники РФ, 2 = проф. издания, 1 = прочие. */
  trust: number;
  label: string;
}

/** Онлайн-алерт о взаимодействии, извлечённый из российских баз. */
export interface OnlineDDIAlert extends DDIAlert {
  /** Откуда получены данные: "rls" | "vidal" | "grls" | "clinrec" | "web" | "local-db" | "ai". */
  origin: "rls" | "vidal" | "grls" | "clinrec" | "web" | "local-db" | "ai";
  /** Уверенность извлечения: high = подтверждено справочником, medium = проф. источник, low = только поисковая выдача. */
  confidence: "high" | "medium" | "low";
  /** Ссылки на первоисточники (РЛС/Видаль/ГРЛС/КР). */
  sourceUrls: DDISourceRef[];
  /** Признак данных из кэша (не искали онлайн заново). */
  fromCache?: boolean;
}

/** Нормализованный препарат. */
export interface NormalizedMedication {
  /** Исходный ввод врача. */
  input: string;
  /** Нормализованное МНН (нижний регистр). */
  inn: string;
  /** Определён ли бренд → МНН словарём. */
  mapped: boolean;
}

/** События потоковой проверки (SSE). */
export type DdiStreamEvent =
  | { type: "stage"; stage: "init" | "normalize" | "local" | "online" | "summary" | "done"; label: string }
  | { type: "normalized"; medications: NormalizedMedication[] }
  | { type: "local-alerts"; alerts: OnlineDDIAlert[]; count: number }
  | { type: "pair-start"; pairIndex: number; totalPairs: number; drugA: string; drugB: string; cached: boolean }
  | { type: "pair-search"; pairIndex: number; drugA: string; drugB: string; query: string; sources: string[] }
  | { type: "pair-found"; pairIndex: number; drugA: string; drugB: string; resultCount: number; domains: string[] }
  | { type: "pair-llm"; pairIndex: number; drugA: string; drugB: string }
  | { type: "pair-done"; pairIndex: number; drugA: string; drugB: string; alerts: OnlineDDIAlert[]; sources: DDISourceRef[]; fromCache: boolean; durationMs: number }
  | { type: "alert"; alert: OnlineDDIAlert }
  | { type: "pair-error"; pairIndex: number; drugA: string; drugB: string; error: string }
  | { type: "summary"; text: string }
  | { type: "complete"; totalAlerts: number; localAlerts: number; onlineAlerts: number; pairsChecked: number; pairsFromCache: number; sourcesUsed: string[]; durationMs: number }
  | { type: "error"; message: string };

// ----------------------------------------------------------------------------
// СЛОВАРЬ БРЕНДОВ РОССИЙСКОГО РЫНКА → МНН
// ----------------------------------------------------------------------------

/** Топовые торговые наименования РФ → МНН. Сокращённый справочник. */
const RU_BRAND_TO_INN: Record<string, string> = {
  // Антикоагулянты / антиагреганты
  "плавикс": "клопидогрел", "зилт": "клопидогрел", "брилинта": "тикагрелор",
  "эликвис": "апиксабан", "ксарелто": "ривароксабан", "прадакса": "дабигатран",
  "варфарин никомед": "варфарин", "кардиомагнил": "ацетилсалициловая кислота",
  "тромбо асс": "ацетилсалициловая кислота", "аспирин кардио": "ацетилсалициловая кислота",
  // Гиполипидемические
  "аторис": "аторвастатин", "торвакард": "аторвастатин", "липримар": "аторвастатин",
  "крестор": "розувастатин", "мертенил": "розувастатин", "зокор": "симвастатин",
  // Антигипертензивные
  "конкор": "бисопролол", "эгилок": "метопролол", "небилет": "небиволол",
  "энап": "эналаприл", "престариум": "периндоприл", "хартил": "рамиприл",
  "диротон": "лизиноприл", "капотен": "каптоприл", "лориста": "лозартан",
  "валз": "валсартан", "диован": "валсартан", "нолипрел": "периндоприл+индапамид",
  "амлотоп": "амлодипин", "норваск": "амлодипин", "тенокс": "амлодипин",
  // Диабет
  "глюкофаж": "метформин", "сиофор": "метформин", "глюкофаж лонг": "метформин",
  "джардинс": "эмпаглифлозин", "форсига": "дапаглифлозин", "янувия": "ситаглиптин",
  "галвус": "вилдаглиптин", "оземпик": "семаглутид", "саксенда": "лираглутид",
  "виктоза": "лираглутид", "трулисити": "дулаглутид", "амарил": "глимепирид",
  "манинил": "глибенкламид", "диабетон": "гликлазид", "диабетон мв": "гликлазид",
  // Антидепрессанты / ЦНС
  "золофт": "сертралин", "паксил": "пароксетин", "прозак": "флуоксетин",
  "ципралекс": "эсциталопрам", "циталор": "циталопрам", "феварин": "флувоксамин",
  "финлепсин": "карбамазепин",
  "депакин": "вальпроевая кислота", "конвулекс": "вальпроевая кислота",
  "топамакс": "топирамат", "габапентин-тева": "габапентин", "лирика": "прегабалин",
  "сирдалуд": "тизанидин", "баклосан": "баклофен",
  // Анальгетики / НПВС
  "нурофен": "ибупрофен", "миг 400": "ибупрофен", "вольтарен": "диклофенак",
  "ортофен": "диклофенак", "ксефокам": "лорноксикам", "найз": "нимесулид",
  "мелоксикам-тева": "мелоксикам", "мовалис": "мелоксикам",
  "целебрекс": "целекоксиб", "аркоксия": "эторикоксиб", "кеторол": "кеторолак",
  "панадол": "парацетамол", "эффералган": "парацетамол", "солпадеин": "парацетамол+кодеин",
  "трамал": "трамадол", "трамадол-тева": "трамадол",
  // ЖКТ
  "омез": "омепразол", "лосек": "омепразол", "нольпаза": "пантопразол",
  "контролок": "пантопразол", "рабепразол-сз": "рабепразол",
  "париет": "рабепразол", "нейблокс": "рабепразол", "денол": "висмута трикалия дицитрат",
  "смекта": "диосмектит",
  // Гормоны / щитовидная железа
  "l-тироксин": "левотироксин", "эутирокс": "левотироксин", "l тироксин": "левотироксин",
  "мерказолил": "тиамазол", "тирозол": "тиамазол",
  // Сердечные гликозиды / антиаритмики
  "кордарон": "амиодарон", "опакор": "амиодарон", "сотагексал": "соталол",
  "пропанорм": "пропафенон", "верапамил-тева": "верапамил", "изоптин": "верапамил",
  "дилтиазем-тева": "дилтиазем", "алдактон": "спиронолактон", "верошпирон": "спиронолактон",
  // Антибиотики / противогрибковые
  "амоксиклав": "амоксициллин+клавулановая кислота", "аугментин": "амоксициллин+клавулановая кислота",
  "флемоксин солютаб": "амоксициллин", "сумамед": "азитромицин", "клацид": "кларитромицин",
  "зиннат": "цефуроксим", "цефтриаксон-тева": "цефтриаксон", "левофлоксацин-тева": "левофлоксацин",
  "таваник": "левофлоксацин", "ципролет": "ципрофлоксацин", "ципробай": "ципрофлоксацин",
  "дифлюкан": "флуконазол", "флюкостат": "флуконазол", "нистатин": "нистатин",
  // Онкология
  "нолвадекс": "тамоксифен", "тамоксифен-тева": "тамоксифен", "фемара": "летрозол",
  "аримидекс": "анастрозол", "гливек": "иматиниб", "тагриссо": "осимертиниб",
  "зитазони": "олапариб", "линпарза": "олапариб", "герцептин": "трастузумаб",
  // Бронхолитики / астма
  "вентолин": "сальбутамол", "симбикорт": "будесонид+формотерол", "серетид": "салметерол+флутиказон",
  "пульмикорт": "будесонид", "спирива": "тиотропий", "эуфиллин": "аминофиллин",
  // Урология / прочее
  "омник": "тамсулозин", "пенестер": "финастерид", "дуодарт": "финастерид+тамсулозин",
  "циннаризин-авексима": "циннаризин", "кавинтон": "винпоцетин", "милдронат": "мельдоний",
  // Иммунодепрессанты
  "сандиммун неорал": "циклоспорин", "экворал": "циклоспорин", "рапамун": "сиролимус",
};

/** Синонимы МНН и упрощения для сопоставления (без брендов). */
const INN_SYNONYMS: Record<string, string> = {
  "аспирин": "ацетилсалициловая кислота",
  "ацс": "ацетилсалициловая кислота",
  "аск": "ацетилсалициловая кислота",
  "нпвс": "ибупрофен", // условный представитель класса для парной проверки
  "нпвп": "ибупрофен",
  "5-фторурацил": "фторурацил",
  "5-фу": "фторурацил",
  "фу": "фторурацил",
  "l-тироксин": "левотироксин",
  "тироксин": "левотироксин",
  "преднизолон": "преднизолон",
  "гидрохлортиазид": "гидрохлоротиазид",
  "гипотиазид": "гидрохлоротиазид",
  "верошпирон": "спиронолактон",
};

// ----------------------------------------------------------------------------
// РЕЕСТР РОССИЙСКИХ ИСТОЧНИКОВ
// ----------------------------------------------------------------------------

interface SourceRule {
  /** Подстрока домена для сопоставления. */
  domain: string;
  /** Короткое имя для UI. */
  label: string;
  /** Доверие 1–3. */
  trust: 1 | 2 | 3;
  origin: OnlineDDIAlert["origin"];
}

const RU_SOURCES: SourceRule[] = [
  { domain: "rlsnet.ru", label: "РЛС (rls.net.ru)", trust: 3, origin: "rls" },
  { domain: "rls.net.ru", label: "РЛС (rls.net.ru)", trust: 3, origin: "rls" },
  { domain: "vidal.ru", label: "Справочник Видаль", trust: 3, origin: "vidal" },
  { domain: "vidal.by", label: "Видаль (BY)", trust: 3, origin: "vidal" },
  { domain: "grls.rosminzdrav.ru", label: "ГРЛС Минздрава РФ", trust: 3, origin: "grls" },
  { domain: "cr.minzdrav.gov.ru", label: "КР Минздрава РФ", trust: 3, origin: "clinrec" },
  { domain: "apicr.minzdrav.gov.ru", label: "КР Минздрава РФ", trust: 3, origin: "clinrec" },
  { domain: "pharmateca.ru", label: "Фарматека", trust: 2, origin: "web" },
  { domain: "medlined.ru", label: "Medlined", trust: 2, origin: "web" },
  { domain: "checkmed.info", label: "CheckMed", trust: 2, origin: "web" },
  { domain: "eco-vector.com", label: "Эко-Вектор (журналы)", trust: 2, origin: "web" },
  { domain: "medi.ru", label: "Меди.ру", trust: 2, origin: "web" },
  { domain: "health-ua.com", label: "Health-UA", trust: 1, origin: "web" },
  { domain: "provisor.ua", label: "Провизор", trust: 1, origin: "web" },
];

function classifySource(url: string, host: string): { label: string; trust: number; origin: OnlineDDIAlert["origin"] } {
  const h = (host || "").toLowerCase().replace(/^www\./, "");
  for (const rule of RU_SOURCES) {
    if (h.includes(rule.domain) || (url || "").toLowerCase().includes(rule.domain)) {
      return { label: rule.label, trust: rule.trust, origin: rule.origin };
    }
  }
  return { label: h || "веб-источник", trust: 1, origin: "web" };
}

// ----------------------------------------------------------------------------
// НОРМАЛИЗАЦИЯ ПРЕПАРАТОВ
// ----------------------------------------------------------------------------

const STOP_WORDS = [
  "таблетки", "таб", "капсулы", "капс", "порошок", "раствор", "суспензия",
  "мг", "мкг", "г", "мл", "тыс", "ретард", "лонг", "форте", "мв", "шт",
];

export function normalizeMedication(input: string): NormalizedMedication {
  let s = (input || "").toLowerCase().trim();
  s = s.replace(/[«»"'`]/g, " ").replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();

  // «Торговое наименование 500 мг» → «торговое наименование»
  s = s.replace(/\b\d+([.,]\d+)?\s*(мг|мкг|г|мл)\b/gi, " ").replace(/\s+/g, " ").trim();

  // Прямое попадание в словарь брендов
  if (RU_BRAND_TO_INN[s]) {
    return { input, inn: RU_BRAND_TO_INN[s], mapped: true };
  }
  if (INN_SYNONYMS[s]) {
    return { input, inn: INN_SYNONYMS[s], mapped: true };
  }

  // Поиск по словарю с допуском «бренд + цифры/слова»
  for (const [brand, inn] of Object.entries(RU_BRAND_TO_INN)) {
    if (s.length >= brand.length && s.startsWith(brand + " ")) {
      return { input, inn, mapped: true };
    }
  }
  for (const [syn, inn] of Object.entries(INN_SYNONYMS)) {
    if (s.startsWith(syn + " ")) {
      return { input, inn, mapped: true };
    }
  }

  // Убираем лекарственные формы
  const words = s.split(" ").filter((w) => w && !STOP_WORDS.includes(w));
  const cleaned = words.join(" ");
  if (INN_SYNONYMS[cleaned]) {
    return { input, inn: INN_SYNONYMS[cleaned], mapped: true };
  }
  return { input, inn: cleaned || s, mapped: false };
}

export function normalizeMedications(inputs: string[]): NormalizedMedication[] {
  const seen = new Set<string>();
  const out: NormalizedMedication[] = [];
  for (const raw of inputs) {
    if (!raw || !raw.trim()) continue;
    const n = normalizeMedication(raw);
    if (!n.inn || seen.has(n.inn)) continue;
    seen.add(n.inn);
    out.push(n);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Z-AI SDK (backend-only): singleton
// ----------------------------------------------------------------------------

import ZAI from "z-ai-web-dev-sdk";

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>;
let zaiPromise: Promise<ZAIInstance> | null = null;

async function getZAI(): Promise<ZAIInstance> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

interface WebSearchItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date?: string;
}

async function webSearch(query: string, num = 8): Promise<WebSearchItem[]> {
  const zai = await getZAI();
  const results = (await zai.functions.invoke("web_search", {
    query,
    num,
  })) as WebSearchItem[];
  if (!Array.isArray(results)) return [];
  return results.filter((r) => r && r.url && r.name);
}

// ----------------------------------------------------------------------------
// LLM-ИЗВЛЕЧЕНИЕ СТРУКТУРИРОВАННЫХ ВЗАИМОДЕЙСТВИЙ
// ----------------------------------------------------------------------------

const SEVERITY_WHITELIST = ["contraindication", "major", "moderate", "minor", "none"] as const;
const CONFIDENCE_WHITELIST = ["high", "medium", "low"] as const;

interface LlmInteraction {
  drugA?: string;
  drugB?: string;
  severity?: string;
  severityLabelRu?: string;
  description?: string;
  mechanism?: string;
  management?: string;
  evidenceLevel?: string;
  sourceName?: string;
  sourceUrl?: string;
  confidence?: string;
}

function safeJsonParse<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  // Убираем markdown-ограждения ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * LLM-извлечение: поисковая выдача → структурированные взаимодействия.
 * Строгие правила: только пара drugA+drugB, severity из классификации РЛС,
 * ссылка на источник обязательна для high/medium confidence.
 */
async function extractInteractionsViaLLM(
  drugA: string,
  drugB: string,
  searchResults: WebSearchItem[],
): Promise<{ alerts: OnlineDDIAlert[]; summary: string }> {
  const zai = await getZAI();

  const context = searchResults
    .map((r, i) => {
      const cls = classifySource(r.url, r.host_name);
      return `${i + 1}. [${cls.label}] ${r.name}\n   URL: ${r.url}\n   ${r.snippet || ""}`;
    })
    .join("\n\n");

  const system = [
    "Ты — клинический фармаколог системы поддержки врачебных решений (СППВР) для российского рынка.",
    "Проанализируй результаты ПОИСКА В РОССИЙСКИХ БАЗАХ ДАННЫХ ЛЕКАРСТВЕННЫХ СРЕДСТВ",
    "(РЛС, Видаль, ГРЛС Минздрава, клинические рекомендации) на предмет взаимодействия ДВУХ препаратов.",
    "",
    "СТРОГИЕ ПРАВИЛА:",
    "1. Оценивай ТОЛЬКО пару, указанную в запросе. Не добавляй другие препараты.",
    "2. Классификация тяжести — как в РЛС (справочник лекарственных средств РФ):",
    '   "contraindication" — совместное применение противопоказано;',
    '   "major" — высокая клиническая значимость (требуется коррекция/контроль);',
    '   "moderate" — средняя клиническая значимость (мониторинг);',
    '   "minor" — низкая значимость;',
    '   "none" — клинически значимого взаимодействия не выявлено.',
    "3. Если поисковая выдача НЕ подтверждает взаимодействие — верни severity='none'.",
    "    Не выдумывай взаимодействия, которых нет в источниках.",
    "4. Поля description/mechanism/management пиши по-русски, кратко и клинически точно",
    "    (для российского врача, с МНО/СКФ/дозами в единицах РФ).",
    "5. В sourceName укажи название базы (например «РЛС», «Видаль»), в sourceUrl — URL из выдачи.",
    "6. confidence: 'high' — подтверждено РЛС/Видаль/ГРЛС/КР; 'medium' — проф. издание;",
    "    'low' — только косвенные упоминания.",
    "",
    "Ответ — ТОЛЬКО валидный JSON:",
    '{"interactions":[{"severity":"...","severityLabelRu":"...","description":"...","mechanism":"...","management":"...","evidenceLevel":"A|B|C","sourceName":"...","sourceUrl":"...","confidence":"..."}],"summary":"краткое заключение по-русски"}',
    "В interactions — РОВНО ОДИН объект (для запрошенной пары).",
  ].join("\n");

  const user = [
    `Пара препаратов: ${drugA} + ${drugB}`,
    "",
    "Результаты онлайн-поиска в российских базах:",
    context || "(результатов нет)",
  ].join("\n");

  let raw: string | undefined;
  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        { role: "user", content: user },
      ],
      thinking: { type: "disabled" },
    });
    raw = completion.choices[0]?.message?.content ?? undefined;
  } catch (e) {
    logger.warn("ddi-online", "LLM extraction failed", {
      error: e instanceof Error ? e.message : String(e),
      pair: `${drugA}+${drugB}`,
    });
    return { alerts: [], summary: "" };
  }

  const parsed = safeJsonParse<{ interactions?: LlmInteraction[]; summary?: string }>(raw ?? "");
  if (!parsed || !Array.isArray(parsed.interactions)) {
    return { alerts: [], summary: parsed?.summary ?? "" };
  }

  const alerts: OnlineDDIAlert[] = [];
  for (const item of parsed.interactions) {
    const severity = SEVERITY_WHITELIST.includes(item.severity as never)
      ? (item.severity as OnlineDDIAlert["severity"] | "none")
      : "none";
    if (severity === "none") continue; // взаимодействие не подтверждено

    const confidence = CONFIDENCE_WHITELIST.includes(item.confidence as never)
      ? (item.confidence as OnlineDDIAlert["confidence"])
      : "low";

    // Сопоставляем sourceUrl с реальной выдачей (анти-галлюцинация ссылок)
    let sourceUrl = item.sourceUrl ?? "";
    if (sourceUrl && !searchResults.some((r) => r.url === sourceUrl)) {
      // Нечёткое совпадение хоста
      const byHost = searchResults.find((r) => sourceUrl.includes(r.host_name?.replace(/^www\./, "") ?? "###"));
      sourceUrl = byHost?.url ?? searchResults[0]?.url ?? "";
    }
    if (!sourceUrl) sourceUrl = searchResults[0]?.url ?? "";

    const ref: DDISourceRef | null = sourceUrl
      ? (() => {
          const host = searchResults.find((r) => r.url === sourceUrl)?.host_name
            ?? (() => { try { return new URL(sourceUrl).hostname; } catch { return ""; } })();
          const cls = classifySource(sourceUrl, host);
          return {
            title: searchResults.find((r) => r.url === sourceUrl)?.name ?? "Источник",
            url: sourceUrl,
            host,
            trust: cls.trust,
            label: item.sourceName?.includes("РЛС") ? "РЛС" : cls.label,
          };
        })()
      : null;

    const cls = ref ? classifySource(ref.url, ref.host) : { origin: "web" as const, trust: 1, label: "веб" };

    alerts.push({
      drug1: drugA,
      drug2: drugB,
      severity,
      description: (item.description ?? "").slice(0, 900),
      mechanism: (item.mechanism ?? "").slice(0, 600),
      management: (item.management ?? "").slice(0, 900),
      evidenceLevel: ["A", "B", "C", "D"].includes(item.evidenceLevel ?? "") ? (item.evidenceLevel as string) : "C",
      source: item.sourceName
        ? `${item.sourceName}${ref ? ` — ${ref.label}` : ""}`
        : ref?.label ?? "Онлайн-поиск (РФ)",
      origin: cls.origin,
      confidence,
      sourceUrls: ref ? [ref] : [],
    });
  }

  return { alerts, summary: parsed.summary ?? "" };
}

// ----------------------------------------------------------------------------
// КЭШ (SQLite, TTL 7 дней) + in-memory
// ----------------------------------------------------------------------------

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
const memoryCache = new Map<string, { expires: number; value: { alerts: OnlineDDIAlert[]; sources: DDISourceRef[]; summary: string } }>();
const MEMORY_CACHE_LIMIT = 300;

function pairKey(drugA: string, drugB: string): string {
  const [a, b] = [drugA, drugB].map((s) => s.toLowerCase().trim()).sort();
  return createHash("sha1").update(`${a}|${b}`).digest("hex");
}

async function cacheGet(key: string): Promise<{ alerts: OnlineDDIAlert[]; sources: DDISourceRef[]; summary: string } | null> {
  const mem = memoryCache.get(key);
  if (mem && mem.expires > Date.now()) {
    return { ...mem.value, alerts: mem.value.alerts.map((a) => ({ ...a, fromCache: true })) };
  }
  if (mem) memoryCache.delete(key);

  try {
    const row = await db.ddiOnlineCache.findUnique({ where: { cacheKey: key } });
    if (row && Date.now() - row.updatedAt.getTime() < CACHE_TTL_MS) {
      const parsed = JSON.parse(row.payload) as { alerts: OnlineDDIAlert[]; sources: DDISourceRef[]; summary: string };
      const value = { alerts: (parsed.alerts ?? []).map((a) => ({ ...a, fromCache: true })), sources: parsed.sources ?? [], summary: parsed.summary ?? "" };
      memoryCache.set(key, { expires: Date.now() + 10 * 60 * 1000, value });
      return value;
    }
  } catch (e) {
    logger.warn("ddi-online", "cache read failed", { error: e instanceof Error ? e.message : String(e) });
  }
  return null;
}

async function cachePut(key: string, drugA: string, drugB: string, value: { alerts: OnlineDDIAlert[]; sources: DDISourceRef[]; summary: string }): Promise<void> {
  try {
    const [a, b] = [drugA, drugB].map((s) => s.toLowerCase().trim()).sort();
    await db.ddiOnlineCache.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, drugA: a, drugB: b, payload: JSON.stringify(value) },
      update: { payload: JSON.stringify(value), hitCount: { increment: 1 }, updatedAt: new Date() },
    });
    if (memoryCache.size >= MEMORY_CACHE_LIMIT) {
      const firstKey = memoryCache.keys().next().value;
      if (firstKey) memoryCache.delete(firstKey);
    }
    memoryCache.set(key, { expires: Date.now() + 10 * 60 * 1000, value });
  } catch (e) {
    logger.warn("ddi-online", "cache write failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

// ----------------------------------------------------------------------------
// ПОТОКОВЫЙ КАНАЛ СОБЫТИЙ
// ----------------------------------------------------------------------------

/** Async-канал: продюсер пушит события, потребитель итерирует асинхронно. */
class EventChannel<T> {
  private queue: T[] = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolver of this.resolvers) {
      resolver({ value: undefined as never, done: true });
    }
    this.resolvers = [];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const item = this.queue.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) {
        return;
      }
      // Ждём следующее событие от продюсера
      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.resolvers.push(resolve);
      });
      if (result.done) return;
      if (result.value !== undefined) yield result.value;
    }
  }
}

// ----------------------------------------------------------------------------
// ПОИСК ПО ПАРЕ (несколько запросов параллельно)
// ----------------------------------------------------------------------------

async function searchPairOnline(drugA: string, drugB: string): Promise<WebSearchItem[]> {
  const queries = [
    // Основной запрос по российским справочникам взаимодействий
    `${drugA} и ${drugB} лекарственное взаимодействие`,
    // Таргетированный запрос в РЛС/Видаль
    `site:rlsnet.ru ${drugA} ${drugB} взаимодействие`,
  ];

  const settled = await Promise.allSettled(queries.map((q) => webSearch(q, 8)));
  const all: WebSearchItem[] = [];
  const seenUrls = new Set<string>();
  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    for (const item of res.value) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        all.push(item);
      }
    }
  }

  // Приоритизация российских источников
  all.sort((a, b) => {
    const ta = classifySource(a.url, a.host_name).trust;
    const tb = classifySource(b.url, b.host_name).trust;
    if (tb !== ta) return tb - ta;
    const relevancyB = relevanceScore(b, drugA, drugB);
    const relevancyA = relevanceScore(a, drugA, drugB);
    return relevancyB - relevancyA;
  });

  return all.slice(0, 10);
}

function relevanceScore(item: WebSearchItem, drugA: string, drugB: string): number {
  const text = `${item.name} ${item.snippet}`.toLowerCase();
  let score = 0;
  const a = drugA.toLowerCase().split(" ")[0];
  const b = drugB.toLowerCase().split(" ")[0];
  if (a && text.includes(a)) score += 2;
  if (b && text.includes(b)) score += 2;
  if (text.includes("взаимодейств")) score += 1;
  return score;
}

// ----------------------------------------------------------------------------
// ГЛАВНЫЙ ПОТОКОВЫЙ АЛГОРИТМ
// ----------------------------------------------------------------------------

export interface StreamDDIOptions {
  /** Максимальное число препаратов (пары ограничены). */
  maxMeds?: number;
  /** Параллельность онлайн-проверки пар. */
  concurrency?: number;
  /** Использовать онлайн-поиск (иначе только локальная база). */
  online?: boolean;
}

/**
 * ПОТОКОВАЯ проверка взаимодействий: async-итерация по событиям.
 * Каждая пара проверяется онлайн (РЛС/Видаль/ГРЛС/КР + LLM-извлечение),
 * события приходят по мере готовности.
 */
export function streamDDICheck(
  medications: string[],
  options: StreamDDIOptions = {},
): AsyncIterable<DdiStreamEvent> {
  const { maxMeds = 16, concurrency = 3, online = true } = options;
  const channel = new EventChannel<DdiStreamEvent>();
  const startedAt = Date.now();

  (async () => {
    try {
      channel.push({ type: "stage", stage: "init", label: "Инициализация потоковой проверки" });

      // 1. Нормализация МНН
      channel.push({ type: "stage", stage: "normalize", label: "Нормализация препаратов (МНН)" });
      const normalized = normalizeMedications(medications).slice(0, maxMeds);
      if (normalized.length === 0) {
        channel.push({ type: "error", message: "Не указаны препараты для проверки" });
        channel.close();
        return;
      }
      channel.push({ type: "normalized", medications: normalized });

      // 2. Локальная таблица — мгновенные алерты (быстрый отклик)
      channel.push({ type: "stage", stage: "local", label: "Локальная база взаимодействий" });
      const localAlerts = await checkLocalInteractions(normalized);
      const localOnline: OnlineDDIAlert[] = localAlerts.map((a) => ({
        ...a,
        origin: "local-db",
        confidence: "high",
        sourceUrls: [],
      }));
      channel.push({ type: "local-alerts", alerts: localOnline, count: localOnline.length });

      if (!online) {
        channel.push({
          type: "complete",
          totalAlerts: localOnline.length,
          localAlerts: localOnline.length,
          onlineAlerts: 0,
          pairsChecked: 0,
          pairsFromCache: 0,
          sourcesUsed: [],
          durationMs: Date.now() - startedAt,
        });
        channel.close();
        return;
      }

      // 3. Онлайн-проверка пар (потоковая, с ограниченной параллельностью)
      channel.push({ type: "stage", stage: "online", label: "Онлайн-поиск в базах РФ (РЛС · Видаль · ГРЛС · КР Минздрава)" });
      const pairs: Array<{ a: NormalizedMedication; b: NormalizedMedication }> = [];
      for (let i = 0; i < normalized.length; i++) {
        for (let j = i + 1; j < normalized.length; j++) {
          pairs.push({ a: normalized[i], b: normalized[j] });
        }
      }
      // Не более 45 пар (15 препаратов) — защита от комбинаторного взрыва
      const capped = pairs.slice(0, 45);
      const totalPairs = capped.length;

      const onlineAlerts: OnlineDDIAlert[] = [];
      const sourcesUsedSet = new Set<string>();
      let pairsFromCache = 0;
      let pairIndex = 0;

      const worker = async (): Promise<void> => {
        while (true) {
          const idx = pairIndex++;
          if (idx >= capped.length) return;
          const { a, b } = capped[idx];
          const pairStart = Date.now();
          const key = pairKey(a.inn, b.inn);

          // Кэш?
          const cached = await cacheGet(key).catch(() => null);
          if (cached) {
            pairsFromCache++;
            for (const s of cached.sources) {
              if (s.trust >= 2) sourcesUsedSet.add(s.label);
            }
            channel.push({ type: "pair-start", pairIndex: idx + 1, totalPairs, drugA: a.inn, drugB: b.inn, cached: true });
            if (cached.alerts.length > 0) {
              for (const alert of cached.alerts) {
                channel.push({ type: "alert", alert });
              }
            }
            channel.push({
              type: "pair-done",
              pairIndex: idx + 1,
              drugA: a.inn,
              drugB: b.inn,
              alerts: cached.alerts,
              sources: cached.sources,
              fromCache: true,
              durationMs: Date.now() - pairStart,
            });
            onlineAlerts.push(...cached.alerts);
            continue;
          }

          channel.push({ type: "pair-start", pairIndex: idx + 1, totalPairs, drugA: a.inn, drugB: b.inn, cached: false });
          channel.push({
            type: "pair-search",
            pairIndex: idx + 1,
            drugA: a.inn,
            drugB: b.inn,
            query: `${a.inn} и ${b.inn} взаимодействие`,
            sources: ["rlsnet.ru", "vidal.ru", "grls.rosminzdrav.ru", "cr.minzdrav.gov.ru"],
          });

          try {
            // Онлайн-поиск
            const searchResults = await searchPairOnline(a.inn, b.inn);
            const domains = [...new Set(searchResults.map((r) => (r.host_name || "").replace(/^www\./, "")))];
            channel.push({ type: "pair-found", pairIndex: idx + 1, drugA: a.inn, drugB: b.inn, resultCount: searchResults.length, domains });

            if (searchResults.length === 0) {
              // Поиск ничего не дал — фиксируем пустой результат
              await cachePut(key, a.inn, b.inn, { alerts: [], sources: [], summary: "" });
              channel.push({ type: "pair-done", pairIndex: idx + 1, drugA: a.inn, drugB: b.inn, alerts: [], sources: [], fromCache: false, durationMs: Date.now() - pairStart });
              continue;
            }

            // LLM-извлечение
            channel.push({ type: "pair-llm", pairIndex: idx + 1, drugA: a.inn, drugB: b.inn });
            const { alerts: extracted, summary } = await extractInteractionsViaLLM(a.inn, b.inn, searchResults);

            const sources: DDISourceRef[] = searchResults.slice(0, 6).map((r) => {
              const cls = classifySource(r.url, r.host_name);
              return { title: r.name, url: r.url, host: r.host_name, trust: cls.trust, label: cls.label };
            });

            for (const s of sources) {
              if (s.trust >= 2) sourcesUsedSet.add(s.label);
            }

            // Кэшируем (TTL 7 дней)
            await cachePut(key, a.inn, b.inn, { alerts: extracted, sources, summary });

            if (extracted.length > 0) {
              for (const alert of extracted) {
                channel.push({ type: "alert", alert });
              }
            }
            onlineAlerts.push(...extracted);
            channel.push({ type: "pair-done", pairIndex: idx + 1, drugA: a.inn, drugB: b.inn, alerts: extracted, sources, fromCache: false, durationMs: Date.now() - pairStart });
            if (summary) {
              // Summary пары не спамим — только в случае найденных взаимодействий
              // (итоговый summary соберём по всем парам ниже)
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn("ddi-online", "pair check failed", { pair: `${a.inn}+${b.inn}`, error: msg });
            channel.push({ type: "pair-error", pairIndex: idx + 1, drugA: a.inn, drugB: b.inn, error: msg });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, capped.length) }, () => worker()));

      // 4. Дедупликация: локальные + онлайн (приоритет онлайн с источниками)
      const merged = dedupAlerts(localOnline, onlineAlerts);

      // 5. Сводка по всей проверке
      channel.push({ type: "stage", stage: "summary", label: "Формирование итогового заключения" });
      const summary = buildSummary(normalized, merged, sourcesUsedSet, pairsFromCache, totalPairs);
      channel.push({ type: "summary", text: summary });

      channel.push({
        type: "complete",
        totalAlerts: merged.length,
        localAlerts: localOnline.length,
        onlineAlerts: onlineAlerts.length,
        pairsChecked: totalPairs,
        pairsFromCache,
        sourcesUsed: [...sourcesUsedSet],
        durationMs: Date.now() - startedAt,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("ddi-online", "stream DDI check failed", { error: msg });
      channel.push({ type: "error", message: msg });
    } finally {
      channel.close();
    }
  })();

  return channel;
}

// ----------------------------------------------------------------------------
// ДЕДУПЛИКАЦИЯ И ИТОГ
// ----------------------------------------------------------------------------

function alertKey(a: { drug1: string; drug2: string }): string {
  return [a.drug1?.toLowerCase(), a.drug2?.toLowerCase()].sort().join("+");
}

function dedupAlerts(local: OnlineDDIAlert[], online: OnlineDDIAlert[]): OnlineDDIAlert[] {
  const onlineKeys = new Set(online.map(alertKey));
  const severityOrder: Record<string, number> = { contraindication: 4, major: 3, moderate: 2, minor: 1 };

  const merged: OnlineDDIAlert[] = [...online];
  for (const la of local) {
    if (!onlineKeys.has(alertKey(la))) {
      merged.push(la);
    }
  }
  merged.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0));
  return merged;
}

function buildSummary(
  meds: NormalizedMedication[],
  alerts: OnlineDDIAlert[],
  sources: Set<string>,
  pairsFromCache: number,
  totalPairs: number,
): string {
  const counts = { contraindication: 0, major: 0, moderate: 0, minor: 0 };
  for (const a of alerts) {
    counts[a.severity as keyof typeof counts] = (counts[a.severity as keyof typeof counts] ?? 0) + 1;
  }
  const parts: string[] = [];
  parts.push(`Проверено ${meds.length} препаратов (${totalPairs} пар) потоковым онлайн-поиском в базах РФ.`);
  if (alerts.length === 0) {
    parts.push("Клинически значимых взаимодействий НЕ выявлено по данным РЛС/Видаля/ГРЛС и КР Минздрава.");
  } else {
    const sev: string[] = [];
    if (counts.contraindication) sev.push(`${counts.contraindication} противопоказано`);
    if (counts.major) sev.push(`${counts.major} тяжёлых`);
    if (counts.moderate) sev.push(`${counts.moderate} умеренных`);
    if (counts.minor) sev.push(`${counts.minor} незначительных`);
    parts.push(`Выявлено взаимодействий: ${alerts.length} (${sev.join(", ")}).`);
    const worst = alerts[0];
    if (worst && (worst.severity === "contraindication" || worst.severity === "major")) {
      parts.push(`Наиболее критичная пара: ${worst.drug1} + ${worst.drug2}.`);
    }
  }
  if (sources.size > 0) parts.push(`Источники: ${[...sources].join(", ")}.`);
  if (pairsFromCache > 0) parts.push(`${pairsFromCache} пар — из кэша проверок.`);
  return parts.join(" ");
}

// ----------------------------------------------------------------------------
// ЛОКАЛЬНАЯ ПРОВЕРКА (улучшенный матчинг вместо наивного includes)
// ----------------------------------------------------------------------------

/** Проверка по локальной таблице DrugInteraction с корректным сопоставлением МНН. */
export async function checkLocalInteractions(normalized: NormalizedMedication[]): Promise<DDIAlert[]> {
  const alerts: DDIAlert[] = [];
  try {
    const allInteractions = await db.drugInteraction.findMany();
    const inns = normalized.map((m) => m.inn);

    const wordHead = (s: string) => s.split(/[\s+(/-]/)[0]?.toLowerCase() ?? "";

    for (const interaction of allInteractions) {
      const d1 = wordHead(interaction.drug1);
      const d2 = wordHead(interaction.drug2);
      // Матчинг по голове МНН (первое слово): ловит «варфарин» в «варфарин никомед»,
      // «метотрексат» в «метотрексат эбеве», и НЕ ловит ложные подстроки
      const m1 = inns.some((m) => wordHead(m) === d1);
      const m2 = inns.some((m) => wordHead(m) === d2);
      if (m1 && m2 && d1 !== d2) {
        alerts.push({
          drug1: interaction.drug1,
          drug2: interaction.drug2,
          severity: interaction.severity as DDIAlert["severity"],
          description: interaction.description,
          mechanism: interaction.mechanism,
          management: interaction.management,
          evidenceLevel: interaction.evidenceLevel,
          source: interaction.source,
        });
      }
    }
  } catch (e) {
    logger.warn("ddi-online", "local interactions read failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return alerts;
}

// ----------------------------------------------------------------------------
// НЕ-ПОТОКОВЫЙ WRAPPER (для /api/ddi и med-check)
// ----------------------------------------------------------------------------

export interface OnlineDDIResult {
  alerts: OnlineDDIAlert[];
  normalizedMedications: NormalizedMedication[];
  summary: string;
  pairsChecked: number;
  pairsFromCache: number;
  sourcesUsed: string[];
  durationMs: number;
  online: boolean;
}

/** Полная (не-потоковая) онлайн-проверка — для обычных JSON-эндпоинтов. */
export async function checkDDIOnline(medications: string[], online = true): Promise<OnlineDDIResult> {
  const startedAt = Date.now();
  const normalized = normalizeMedications(medications);

  const localAlerts = (await checkLocalInteractions(normalized)).map((a) => ({
    ...a,
    origin: "local-db" as const,
    confidence: "high" as const,
    sourceUrls: [] as DDISourceRef[],
  }));

  const onlineAlerts: OnlineDDIAlert[] = [];
  const sourcesUsedSet = new Set<string>();
  let pairsFromCache = 0;
  let pairsChecked = 0;

  if (online && normalized.length >= 2) {
    const pairs: Array<[NormalizedMedication, NormalizedMedication]> = [];
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        pairs.push([normalized[i], normalized[j]]);
      }
    }
    const capped = pairs.slice(0, 45);
    pairsChecked = capped.length;

    // Последовательная обработка с меньшей параллельностью для не-потокового режима
    const CONC = 2;
    let idx = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= capped.length) return;
        const [a, b] = capped[i];
        const key = pairKey(a.inn, b.inn);
        try {
          const cached = await cacheGet(key).catch(() => null);
          if (cached) {
            pairsFromCache++;
            onlineAlerts.push(...cached.alerts);
            for (const s of cached.sources) if (s.trust >= 2) sourcesUsedSet.add(s.label);
            continue;
          }
          const searchResults = await searchPairOnline(a.inn, b.inn);
          if (searchResults.length === 0) {
            await cachePut(key, a.inn, b.inn, { alerts: [], sources: [], summary: "" });
            continue;
          }
          const { alerts: extracted, summary } = await extractInteractionsViaLLM(a.inn, b.inn, searchResults);
          const sources: DDISourceRef[] = searchResults.slice(0, 6).map((r) => {
            const cls = classifySource(r.url, r.host_name);
            return { title: r.name, url: r.url, host: r.host_name, trust: cls.trust, label: cls.label };
          });
          for (const s of sources) if (s.trust >= 2) sourcesUsedSet.add(s.label);
          await cachePut(key, a.inn, b.inn, { alerts: extracted, sources, summary });
          onlineAlerts.push(...extracted);
        } catch (e) {
          logger.warn("ddi-online", "pair check failed (json mode)", {
            pair: `${a.inn}+${b.inn}`,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, capped.length) }, () => worker()));
  }

  const merged = dedupAlerts(localAlerts, onlineAlerts);
  const summary = buildSummary(normalized, merged, sourcesUsedSet, pairsFromCache, pairsChecked);

  return {
    alerts: merged,
    normalizedMedications: normalized,
    summary,
    pairsChecked,
    pairsFromCache,
    sourcesUsed: [...sourcesUsedSet],
    durationMs: Date.now() - startedAt,
    online,
  };
}

// ----------------------------------------------------------------------------
// ОЧИСТКА КЭША (админ)
// ----------------------------------------------------------------------------

export async function clearDDIOnlineCache(): Promise<number> {
  memoryCache.clear();
  try {
    const res = await db.ddiOnlineCache.deleteMany({});
    return res.count;
  } catch {
    return 0;
  }
}

export async function getDDICacheStats(): Promise<{ entries: number; oldestDays: number | null }> {
  try {
    const count = await db.ddiOnlineCache.count();
    const oldest = await db.ddiOnlineCache.findFirst({ orderBy: { updatedAt: "asc" } });
    const oldestDays = oldest ? Math.floor((Date.now() - oldest.updatedAt.getTime()) / 86400000) : null;
    return { entries: count, oldestDays };
  } catch {
    return { entries: 0, oldestDays: null };
  }
}
