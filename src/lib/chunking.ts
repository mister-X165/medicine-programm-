// СППВР — утилита разбиения длинных медицинских текстов на чанки
// ============================================================================
// Проблема, которую решает этот модуль:
//   Небольшие модели (google/gemma-3-4b, qwen-2.5-3b и т.п.) имеют ограниченный
//   контекст (часто 4K–8K токенов) и плохо справляются с длинными входными
//   текстами: теряют факты, галлюцинируют, обрывают ответ. Решение — разбить
//   длинный документ на перекрывающиеся чанки фиксированного размера, обработать
//   каждый чанк отдельно (map-этап), а затем свернуть результаты в единый ответ
//   (reduce-этап). Это классический паттерн map-reduce для LLM.
//
//   Подробнее:
//   - chunkText() — низкоуровневая функция разбиения (с overlap, по границам
//     предложений/абзацев). Возвращает массив {text, index, total}.
//   - mapReduceLLM() — высокоуровневая обёртка: применяет mapFn к каждому чанку
//     параллельно (с лимитом конкурентности), затем reduceFn объединяет
//     результаты.
//
// Размеры чанков выбраны консервативно под gemma-3-4b (context ~8K токенов):
//   - CHUNK_SIZE_CHARS = 2000 символов ≈ 500–700 токенов (русский текст)
//   - CHUNK_OVERLAP = 200 символов — сохраняет контекст между чанками
//   - MAX_CONCURRENCY = 2 — локальные модели обычно однопоточные

import { logger } from "@/lib/logger";

export interface TextChunk {
  /** Текст чанка */
  text: string;
  /** Порядковый номер чанка (0-based) */
  index: number;
  /** Общее число чанков */
  total: number;
  /** Символьное смещение начала чанка в исходном тексте */
  startOffset: number;
}

export interface ChunkingOptions {
  /** Максимальный размер чанка в символах (default: 2000) */
  chunkSize?: number;
  /** Перекрытие между чанками в символах (default: 200) */
  overlap?: number;
  /** Минимальная длина последнего чанка — если меньше, объединяется с предыдущим (default: 300) */
  minChunkSize?: number;
}

/**
 * Разбивает длинный текст на перекрывающиеся чанки по границам предложений
 * и абзацев. Границы выбираются так, чтобы чанки не разрезали предложения
 * посередине (это критично для медицинского текста, где «приём 2 раза»
 * не должно оказаться в отдельном от «тамоксифен» чанке).
 *
 * Алгоритм:
 *   1. Делим текст на абзацы (по \n\n) и предложения (по .!? с заглавной).
 *   2. Накапливаем предложения в текущий чанк, пока не достигнем chunkSize.
 *   3. Если чанк ≥ chunkSize — фиксируем, начинаем новый с overlap.
 *   4. Если последний чанк < minChunkSize — объединяем с предыдущим.
 */
export function chunkText(text: string, options?: ChunkingOptions): TextChunk[] {
  const chunkSize = options?.chunkSize ?? 2000;
  const overlap = options?.overlap ?? 200;
  const minChunkSize = options?.minChunkSize ?? 300;

  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (cleaned.length === 0) return [];

  // Если текст короче одного чанка — отдаём как есть
  if (cleaned.length <= chunkSize) {
    return [{ text: cleaned, index: 0, total: 1, startOffset: 0 }];
  }

  // Разбиваем на предложения с сохранением разделителей.
  // Паттерн: захватываем предложение вместе с завершающим .!? (и пробелами).
  const sentencePattern = /[^.!?。\n]+[.!?。]+(?:\s|$)|[^.!?。\n]+$/g;
  const matches = cleaned.match(sentencePattern);
  const sentences = matches
    ? matches.map((s) => s.trim()).filter((s) => s.length > 0)
    : [cleaned];

  const chunks: TextChunk[] = [];
  let current = "";
  let currentStart = 0;
  let cursor = 0; // абсолютное смещение в cleaned

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length === 0) return;
    chunks.push({
      text: trimmed,
      index: chunks.length,
      total: 0, // заполним в конце
      startOffset: currentStart,
    });
    current = "";
  };

  for (const sentence of sentences) {
    // Находим абсолютное смещение начала этого предложения
    const sIdx = cleaned.indexOf(sentence, cursor);
    if (sIdx === -1) continue;
    cursor = sIdx + sentence.length;

    // Если добавление предложения переполнит чанк — фиксируем текущий
    if (current.length > 0 && current.length + sentence.length + 1 > chunkSize) {
      flush();
      // overlap: берём хвост предыдущего чанка как начало нового
      const prev = chunks.length > 0 ? chunks[chunks.length - 1].text : "";
      const tail = prev.slice(-overlap);
      if (tail.length > 0) {
        current = tail + " " + sentence;
        currentStart = sIdx - tail.length;
      } else {
        current = sentence;
        currentStart = sIdx;
      }
    } else {
      if (current.length === 0) currentStart = sIdx;
      current = current.length === 0 ? sentence : current + " " + sentence;
    }
  }
  flush();

  // Объединяем слишком короткий последний чанк с предыдущим
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.text.length < minChunkSize) {
      prev.text = prev.text + "\n" + last.text;
      chunks.pop();
    }
  }

  // Заполняем total и пересчитываем index
  const total = chunks.length;
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].index = i;
    chunks[i].total = total;
  }

  return chunks;
}

/**
 * Параметры map-reduce обработки чанков через LLM.
 *
 * - mapFn: применяет LLM к одному чанку, возвращает частичный результат.
 *   Получает (chunkText, chunkMeta) — мета содержит {index, total} для
 *   информирования модели о позиции чанка.
 * - reduceFn: объединяет массив частичных результатов в финальный.
 * - concurrency: лимит одновременных LLM-запросов (default: 2).
 * - onProgress: колбэк прогресса (для логирования/телеметрии).
 */
export interface MapReduceOptions<TPartial, TResult> {
  mapFn: (chunk: TextChunk) => Promise<TPartial | null>;
  reduceFn: (partials: TPartial[], chunks: TextChunk[]) => Promise<TResult>;
  concurrency?: number;
  onProgress?: (done: number, total: number, lastChunkIndex: number) => void;
}

/**
 * Применяет mapFn к каждому чанку (с лимитом конкурентности), затем
 * reduceFn к массиву частичных результатов. Чанки с null-результатом
 * (модель не смогла обработать) пропускаются, но не прерывают пайплайн.
 *
 * Если все чанки вернули null — reduceFn не вызывается, возвращается null.
 */
export async function mapReduceLLM<TPartial, TResult>(
  text: string,
  options: MapReduceOptions<TPartial, TResult>,
  chunkingOptions?: ChunkingOptions,
): Promise<{ result: TResult | null; chunksProcessed: number; chunksTotal: number }> {
  const chunks = chunkText(text, chunkingOptions);
  if (chunks.length === 0) {
    return { result: null, chunksProcessed: 0, chunksTotal: 0 };
  }

  // Если всего один чанк — обходим map-reduce, вызываем mapFn напрямую.
  // Это ускоряет обработку коротких документов и снижает расход токенов.
  if (chunks.length === 1) {
    const partial = await options.mapFn(chunks[0]);
    options.onProgress?.(1, 1, 0);
    if (partial === null) {
      return { result: null, chunksProcessed: 0, chunksTotal: 1 };
    }
    const result = await options.reduceFn([partial], chunks);
    return { result, chunksProcessed: 1, chunksTotal: 1 };
  }

  const concurrency = Math.max(1, options.concurrency ?? 2);
  const partials: TPartial[] = [];
  const partialsMeta: TextChunk[] = [];
  let done = 0;

  // Пул выполнения с ограничением конкурентности
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < chunks.length) {
      const myIndex = nextIndex++;
      const chunk = chunks[myIndex];
      try {
        const partial = await options.mapFn(chunk);
        if (partial !== null) {
          partials.push(partial);
          partialsMeta.push(chunk);
        }
      } catch (e) {
        logger.error("analysis", "Ошибка обработки чанка", { chunkIndex: chunk.index + 1, total: chunk.total, error: e instanceof Error ? e.message : String(e) });
      }
      done++;
      options.onProgress?.(done, chunks.length, chunk.index);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, chunks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (partials.length === 0) {
    return { result: null, chunksProcessed: 0, chunksTotal: chunks.length };
  }

  const result = await options.reduceFn(partials, partialsMeta);
  return { result, chunksProcessed: partials.length, chunksTotal: chunks.length };
}
