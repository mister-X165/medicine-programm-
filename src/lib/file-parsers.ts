// СППВР — парсинг загруженных файлов (ТЗ п. 3.1)
// VCF/CSV — прямой парсинг; PDF/DOCX/изображения — через ИИ
// СТРОГИЙ АЛГОРИТМ: если в документах нет медицинских/геномных данных,
// ИИ НЕ ДОЛЖЕН их придумывать — он должен сообщить об их отсутствии.

import { llmChat, parseJSON, vlmAnalyzeImage } from "./ai-service";
import { logger } from "@/lib/logger";
import { mapReduceLLM, chunkText, type TextChunk } from "./chunking";
import type { Mutation } from "./types";

/// Парсинг VCF-файла (Variant Call Format)
export function parseVCF(content: string): {
  variants: Array<{
    chrom: string;
    pos: number;
    id: string;
    ref: string;
    alt: string;
    info: string;
    rawLine: number;
  }>;
  rawText: string;
} {
  const lines = content.split(/\r?\n/);
  const variants: Array<{
    chrom: string;
    pos: number;
    id: string;
    ref: string;
    alt: string;
    info: string;
    rawLine: number;
  }> = [];
  let lineNum = 0;
  for (const line of lines) {
    lineNum++;
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 8) continue;
    variants.push({
      chrom: parts[0],
      pos: parseInt(parts[1], 10) || 0,
      id: parts[2],
      ref: parts[3],
      alt: parts[4],
      info: parts[7],
      rawLine: lineNum,
    });
  }
  return { variants, rawText: content };
}

/// Парсинг CSV генетического отчёта (упрощённый)
export function parseGeneticCSV(content: string): {
  rows: Array<Record<string, string>>;
  headers: string[];
  rawText: string;
} {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], headers: [], rawText: content };
  const headers = parseCSVLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return { rows, headers, rawText: content };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

/// Интерпретация генетических вариантов через LLM (map-reduce по чанкам)
/// ============================================================================
/// СТРОГИЙ АЛГОРИТМ: ИИ НЕ придумывает данные, которых нет в документе.
///
/// Длинные генетические отчёты (VCF с сотнями вариантов, расширенные CSV)
/// разбиваются на чанки по ~2000 символов. Каждый чанк обрабатывается
/// отдельным LLM-запросом (map), затем результаты сливаются с дедупликацией
/// по (gene, variant) — это критично для небольших моделей (gemma-3-4b),
/// которые при длинном входе теряют факты и галлюцинируют.
export async function interpretGeneticVariants(
  deidText: string,
): Promise<Mutation[] | null> {
  const system = `Ты — клинический генетик. Проанализируй фрагмент генетического отчёта и извлеки клинически значимые варианты.

ПРАВИЛА:
- Не придумывай варианты, которых нет в тексте.
- Если генетических данных в этом фрагменте нет — верни пустой массив [].
- Каждый вариант должен быть из текста фрагмента.

Для каждого варианта укажи:
- gene: символ гена (BRCA1, EGFR, CYP2D6 и т.д.)
- variant: номенклатура (c.68_69del, p.Val600Glu, G12C и т.д.)
- interpretation: клиническая значимость и влияние на терапию с конкретными препаратами/дозами
- clinicalSignificance: одно из pathogenic | likely_pathogenic | vus | likely_benign | benign

Верни ТОЛЬКО JSON-массив. Без markdown, без пояснений.`;

  const mapFn = async (chunk: TextChunk): Promise<Mutation[] | null> => {
    const chunkHeader = chunk.total > 1
      ? `[ФРАГМЕНТ ${chunk.index + 1} из ${chunk.total} генетического отчёта]\n\n`
      : "";
    const user = `Генетический отчёт:\n\n${chunkHeader}${chunk.text}`;
    const raw = await llmChat(system, user, { json: true, maxTokens: 4096 });
    const parsed = parseJSON<Mutation[] | { variants?: Mutation[]; mutations?: Mutation[] }>(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const maybe = parsed.variants ?? parsed.mutations;
      if (Array.isArray(maybe)) return maybe;
    }
    return null;
  };

  const reduceFn = async (partials: Mutation[][]): Promise<Mutation[]> => {
    // Дедупликация по (gene + variant) — сохраняем первое вхождение,
    // приоритет у чанков с большим index (обычно там более развёрнутая интерпретация)
    const seen = new Set<string>();
    const merged: Mutation[] = [];
    // Обходим в обратном порядке, чтобы оставить последнее (наиболее полное) вхождение
    for (let i = partials.length - 1; i >= 0; i--) {
      for (const m of partials[i]) {
        const key = `${(m.gene || "").toUpperCase()}|${(m.variant || "").toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.unshift(m);
        }
      }
    }
    return merged;
  };

  const { result } = await mapReduceLLM<Mutation[], Mutation[]>(deidText, {
    mapFn,
    reduceFn,
    concurrency: 2,
    onProgress: (done, total) => {
      if (total > 1) {
        logger.info("analysis", "Генетический вариант: чанк обработан", { done, total });
      }
    },
  });

  return result;
}

/// Извлечение сущностей (NER) из медицинской выписки через LLM (map-reduce)
/// ============================================================================
/// СТРОГИЙ АЛГОРИТМ: ИИ НЕ придумывает данные, которых нет в документе.
///
/// Длинные выписки разбиваются на чанки по ~2000 символов. Каждый чанк
/// обрабатывается отдельным LLM-запросом (map), затем сущности сливаются
/// с дедупликацией по (type, value), а summary собирается из частичных
/// summary каждого чанка. Это критично для небольших моделей (gemma-3-4b),
/// которые при длинном входе теряют факты и галлюцинируют.
export async function extractEntitiesFromDischarge(
  deidText: string,
): Promise<{
  entities: Array<{
    type: string;
    value: string;
    context: string;
  }>;
  summary: string;
  mutations: Array<{
    gene: string;
    variant: string;
    interpretation: string;
    clinicalSignificance: string;
  }>;
} | null> {
  type PartialResult = {
    entities: Array<{ type: string; value: string; context: string }>;
    summary: string;
    mutations: Array<{
      gene: string;
      variant: string;
      interpretation: string;
      clinicalSignificance: string;
    }>;
  };

  const system = `Ты — медицинский NER-экстрактор. Из фрагмента выписки извлеки сущности.

ПРАВИЛА:
- Не придумывай данные, которых нет в тексте.
- Если медицинских данных в этом фрагменте нет — верни пустые массивы и резюме об отсутствии данных.
- Каждый диагноз, препарат или мутация должны быть из текста фрагмента.

Извлеки:
1. entities — массив: type (diagnosis|medication|dosage|procedure|lab_value|date|other), value (конкретное значение), context (контекст из выписки).
   ВАЖНО для дат: type="date" используется для КЛИНИЧЕСКИХ дат (даты анализов, обследований, операций, выписок, госпитализаций). Извлекай ВСЕ такие даты в формате как в тексте (например "15.03.2024", "2024-03-15"). В context указывай к чему относится дата (например "дата анализа крови", "дата операции", "дата выписки").
   ВАЖНО для лабораторных значений: type="lab_value", value должно содержать показатель+значение+единицы+референс (например "Глюкоза 8.5 ммоль/л (реф 3.3-5.5)"), в context — дата анализа если есть.
2. mutations — упомянутые мутации: gene, variant, interpretation (с препаратами/дозами), clinicalSignificance (pathogenic|likely_pathogenic|vus|likely_benign|benign).
3. summary — резюме этого фрагмента на русском (3-5 предложений): что важно в этом фрагменте — диагноз, препараты с дозами, мутации, рекомендации. ОБЯЗАТЕЛЬНО упоминай даты анализов и их результаты (например "Анализ от 15.03.2024: глюкоза 8.5 ммоль/л — повышена").

Верни JSON: {"entities":[...], "mutations":[...], "summary":"..."}.`;

  const mapFn = async (chunk: TextChunk): Promise<PartialResult | null> => {
    const chunkHeader = chunk.total > 1
      ? `[ФРАГМЕНТ ${chunk.index + 1} из ${chunk.total} медицинской выписки]\n\n`
      : "";
    const user = `Выписка:\n\n${chunkHeader}${chunk.text}`;
    const raw = await llmChat(system, user, { json: true, maxTokens: 4096 });
    const parsed = parseJSON<{
      entities?: Array<{ type: string; value: string; context: string }>;
      summary?: string;
      mutations?: Array<{
        gene: string;
        variant: string;
        interpretation: string;
        clinicalSignificance: string;
      }>;
    }>(raw);
    if (!parsed) return null;
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      mutations: Array.isArray(parsed.mutations) ? parsed.mutations : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  };

  const reduceFn = async (partials: PartialResult[]): Promise<PartialResult> => {
    // Дедупликация entities по (type + value), дедупликация mutations по (gene + variant)
    const seenEntities = new Set<string>();
    const seenMuts = new Set<string>();
    const entities: PartialResult["entities"] = [];
    const mutations: PartialResult["mutations"] = [];
    const summaries: string[] = [];

    for (const p of partials) {
      for (const e of p.entities) {
        const key = `${e.type}|${(e.value || "").toLowerCase().trim()}`;
        if (!seenEntities.has(key)) {
          seenEntities.add(key);
          entities.push(e);
        }
      }
      for (const m of p.mutations) {
        const key = `${(m.gene || "").toUpperCase()}|${(m.variant || "").toUpperCase()}`;
        if (!seenMuts.has(key)) {
          seenMuts.add(key);
          mutations.push(m);
        }
      }
      if (p.summary && p.summary.trim()) {
        summaries.push(p.summary.trim());
      }
    }

    // Если было несколько чанков — просим модель собрать общее резюме
    // из частичных summary. Для одного чанка — оставляем как есть.
    let finalSummary = summaries.join("\n\n");
    if (summaries.length > 1) {
      try {
        const reduceSys = `Ты — медицинский редактор. Ниже представлены частичные резюме фрагментов одной медицинской выписки. Собери из них единое связное резюме на русском (5-10 предложений): диагноз по МКБ-10, назначенные препараты с дозировками, выявленные мутации, рекомендации по лечению. Не придумывай факты, которых нет в частичных резюме.`;
        const reduceUser = `Частичные резюме:\n\n${summaries.map((s, i) => `--- Фрагмент ${i + 1} ---\n${s}`).join("\n\n")}`;
        const reduced = await llmChat(reduceSys, reduceUser, { json: false, maxTokens: 2048 });
        if (reduced && reduced.trim().length > 20) {
          finalSummary = reduced.trim();
        }
      } catch (e) {
        logger.error("analysis", "Ошибка сборки резюме", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      entities,
      mutations,
      summary: finalSummary,
    };
  };

  const { result } = await mapReduceLLM<PartialResult, PartialResult>(deidText, {
    mapFn,
    reduceFn,
    concurrency: 2,
    onProgress: (done, total) => {
      if (total > 1) {
        logger.info("analysis", "Выписка: чанк обработан", { done, total });
      }
    },
  });

  return result;
}

/// Анализ медицинского изображения через VLM (ТЗ п. 3.2)
export async function analyzeMedicalImage(
  imageDataUrl: string,
  context: string,
): Promise<{
  findings: string;
  regionOfInterest: string;
  measurements: string;
  suspicion: "low" | "moderate" | "high";
} | null> {
  const system = `Ты — рентгенолог/онколог. Проанализируй медицинское изображение.

КРИТИЧЕСКИ ПРАВИЛО — НЕ ПРИДУМЫВАЙ ДАННЫЕ:
1. Если на изображении нет медицинских/патологических находок — так и укажи: «Патологических изменений не выявлено».
2. НЕ придумывай несуществующие патологии, размеры или области интереса.
3. Если изображение не является медицинским (снимок/скриншот/нерелевантный файл) — укажи: «Загруженный файл не является медицинским изображением. Анализ невозможен.» с suspicion: "low".

ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ: это исследовательский анализ, не окончательный диагноз.
Верни JSON: {"findings":"описание","regionOfInterest":"область интереса","measurements":"оценка размеров","suspicion":"low|moderate|high"}.`;
  const prompt = `${system}\n\nКонтекст пациента: ${context || "не указан"}`;
  const raw = await vlmAnalyzeImage(imageDataUrl, prompt);
  return parseJSON(raw);
}

/// Извлечение текста из PDF/DOCX через image_url (LM Studio с vision-моделью).
/// Приоритет: прямой парсинг PDF/DOCX → LM Studio vision → плейсхолдер.
export async function extractTextFromDocument(
  fileDataUrl: string,
  fileName: string,
): Promise<string | null> {
  // 0. Прямой парсинг DOCX/PDF (без ИИ — быстро и надёжно)
  const directText = await tryDirectDocumentParse(fileDataUrl, fileName);
  if (directText !== null) {
    return directText;
  }

  const prompt = `Извлеки весь текст из документа "${fileName}" и верни его как есть, сохраняя структуру. Это медицинская выписка. ВАЖНО: не придумывай содержание, которого нет в документе. Если документ пуст или не содержит текста — так и укажи.`;

  // 1. LM Studio: пробуем vision-API через image_url (если загружена vision-модель)
  try {
    const { lmStudioVision, getLMStudioConfig } = await import("./lm-studio");
    const cfg = getLMStudioConfig();
    if (cfg.enabled) {
      const result = await lmStudioVision(fileDataUrl, prompt);
      if (result && result.trim().length > 0) return result;
    }
  } catch (e) {
    logger.error("analysis", "Извлечение текста: LM Studio ошибка", { error: e instanceof Error ? e.message : String(e) });
  }

  // 2. Fallback: если LM Studio недоступен или не справился — плейсхолдер
  return `[Не удалось извлечь текст из ${fileName}]`;
}

/**
 * Декодирует data: URL в Buffer.
 */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) {
    // Возможно, это чистый base64 без префикса
    return Buffer.from(dataUrl, "base64");
  }
  const base64 = dataUrl.slice(commaIdx + 1);
  return Buffer.from(base64, "base64");
}

/**
 * Runtime dynamic import, защищённый от статического анализа бандлером
 * (Turbopack/webpack). Это позволяет использовать опциональные зависимости
 * (`unpdf`, `mammoth`), даже если они не установлены на машине разработчика —
 * в этом случае импорт просто вернёт null, и мы перейдём к AI-fallback.
 *
 * `new Function()` создаёт функцию, тело которой бандлер не анализирует
 * статически, поэтому `import(specifier)` выполняется только в рантайме.
 */
async function runtimeImport<T = unknown>(specifier: string): Promise<T | null> {
  try {
    const dynamicImporter = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<T>;
    return await dynamicImporter(specifier);
  } catch (e) {
    logger.error("analysis", "Динамический импорт не удался", { specifier, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Прямой (без ИИ) парсинг содержимого файла в текст для базы знаний.
 * Поддерживаемые типы: PDF (unpdf), DOCX (mammoth), TXT/MD/HTML (прямой UTF-8).
 * Возвращает пустую строку, если тип не поддерживается, пакет не установлен
 * или парсинг не дал текста (без AI fallback — это для RAG-документов, а не
 * медицинских выписок).
 *
 * Используется эндпоинтом POST /api/knowledge/upload.
 */
export async function parseFileContent(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();
  const uint8 = new Uint8Array(buffer);

  // PDF — через unpdf (serverless, без Worker/canvas)
  if (lower.endsWith(".pdf")) {
    try {
      const mod = await runtimeImport<{ extractText: (u: Uint8Array, o?: unknown) => Promise<{ text: string }> }>("unpdf");
      if (mod && typeof mod.extractText === "function") {
        const { text } = await mod.extractText(uint8, { mergePages: true });
        const trimmed = text?.trim();
        if (trimmed && trimmed.length > 0) return trimmed;
      }
    } catch (e) {
      logger.warn("analysis", "parseFileContent: PDF parse failed", { fileName, error: e instanceof Error ? e.message : String(e) });
    }
    return "";
  }

  // DOCX/DOC — через mammoth
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    try {
      const mod = await runtimeImport<{ default: { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> } }>("mammoth");
      if (mod && mod.default && typeof mod.default.extractRawText === "function") {
        const result = await mod.default.extractRawText({ buffer });
        const trimmed = result?.value?.trim();
        if (trimmed && trimmed.length > 0) return trimmed;
      }
    } catch (e) {
      logger.warn("analysis", "parseFileContent: DOCX parse failed", { fileName, error: e instanceof Error ? e.message : String(e) });
    }
    return "";
  }

  // TXT/MD/HTML — прямой UTF-8 парсинг (HTML — грубое удаление тегов)
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".html") || lower.endsWith(".htm")) {
    const text = buffer.toString("utf-8");
    if (lower.endsWith(".html") || lower.endsWith(".htm")) {
      // Удаляем скрипты/стили и HTML-теги, расшифровываем базовые сущности
      const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      return cleaned;
    }
    return text.trim();
  }

  // Неподдерживаемый тип — возвращаем пустую строку
  logger.warn("analysis", "parseFileContent: unsupported file type", { fileName });
  return "";
}

/**
 * Прямое (без ИИ) извлечение текста из PDF и DOCX.
 * PDF — через unpdf (serverless, без Worker/canvas).
 * DOCX — через mammoth (ZIP → document.xml → текст параграфов).
 * Возвращает null, если тип не поддерживается, пакет не установлен или парсинг не дал текста.
 */
async function tryDirectDocumentParse(
  fileDataUrl: string,
  fileName: string,
): Promise<string | null> {
  const lower = fileName.toLowerCase();
  const isPdf = lower.endsWith(".pdf");
  const isDocx = lower.endsWith(".docx") || lower.endsWith(".doc");
  if (!isPdf && !isDocx) return null;

  const buf = dataUrlToBuffer(fileDataUrl);
  // unpdf требует именно Uint8Array (не Node Buffer)
  const uint8 = new Uint8Array(buf);

  try {
    if (isPdf) {
      const mod = await runtimeImport<{ extractText: (u: Uint8Array, o?: unknown) => Promise<{ text: string }> }>("unpdf");
      if (!mod || typeof mod.extractText !== "function") {
        // unpdf не установлен — fallback к AI ниже
        return null;
      }
      const { text } = await mod.extractText(uint8, { mergePages: true });
      const trimmed = text?.trim();
      if (trimmed && trimmed.length > 0) {
        return trimmed;
      }
      return null;
    }

    if (isDocx) {
      const mod = await runtimeImport<{ default: { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> } }>("mammoth");
      if (!mod || !mod.default || typeof mod.default.extractRawText !== "function") {
        // mammoth не установлен — fallback к AI ниже
        return null;
      }
      const result = await mod.default.extractRawText({ buffer: buf });
      const trimmed = result?.value?.trim();
      if (trimmed && trimmed.length > 0) {
        return trimmed;
      }
      return null;
    }
  } catch (e) {
    logger.warn("analysis", "Прямой парсинг документа не удался", { fileName, error: e instanceof Error ? e.message : String(e) });
    // Не возвращаем null здесь — дадим шанс AI fallback
  }
  return null;
}
