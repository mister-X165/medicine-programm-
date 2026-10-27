// СППВР v4.2 — AI Chat API (multifunctional medical platform)
// POST /api/chat — AI chat with case context + direct document chunk transmission
//
// v4.2 changes (ПРЯМОЕ ПОДКЛЮЧЕНИЕ К РЕПОЗИТОРИЮ КР МИНЗДРАВА РФ):
//   1. ИИ НАПРЯМУЮ подключается к официальному репозиторию клинических
//      рекомендаций Минздрава (cr.minzdrav.gov.ru) и ПАРСИТ его по теме
//      вопроса врача: поиск КР → полные тексты → парсинг всех разделов →
//      отбор релевантных теме фрагментов (minzdrav-rag.ts).
//   2. Разбор репозитория выполняется для ЛЮБОГО медицинского вопроса —
//      не только при наличии контекста случая (раньше требовался diagnosisHint
//      или документ). Тема извлекается из самого вопроса + диагноза кейса.
//   3. В ответе возвращается meta.ragClinrecs — список разобранных КР
//      (код, название, ссылка, число фрагментов) — UI показывает врачу,
//      на какие официальные КР опирался ИИ.
//
// v2.2 (сохранено):
//   1. System prompt — мультимодальная медицинская консультационная платформа.
//   2. Длинные документы чанкуются (chunkText) и передаются ИИ напрямую;
//      для очень длинных — map-reduce (сводка каждого чанка → общий ответ).

import { NextResponse } from "next/server";
import { llmChat, getActiveProvider } from "@/lib/ai-service";
import { chunkText, type TextChunk } from "@/lib/chunking";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  caseContext?: {
    diagnosisHint?: string;
    analysisSummary?: string;
    therapyRecommendations?: string;
  };
  // NEW v2.2: direct document text transmission
  documentText?: string;
  documentChunks?: string[];
  documentTitle?: string;
}

const SYSTEM_PROMPT = `Ты — мультимодальная медицинская консультационная платформа СППВР (Clinical Decision Support System). Ты не ограничен одной узкой специальностью: ты выступаешь как виртуальный консилиум специалистов, готовый помочь врачу любой специальности.

ТВОИ РОЛИ И КОМПЕТЕНЦИИ (мультидисциплинарная платформа):
1. **Терапевт / врач общей практики** — первичная дифференциальная диагностика, ведение хронических пациентов, профилактика.
2. **Онколог и клинический генетик** — интерпретация генетических вариантов (BRCA1/2, EGFR, KRAS, TPMT, DPYD, CYP2D6, CYP2C19, HLA-B и др.), подбор таргетной/иммунотерапии, фармакогеномика.
3. **Кардиолог** — интерпретация ЭКГ и ЭхоКГ, ведение ИБС, АГ, ХСН, аритмий, антикоагулянтная терапия.
4. **Фармаколог / клинический фармаколог** — подбор препаратов, доз, режимов, проверка лекарственных взаимодействий (DDI), коррекция доз при почечной/печёночной недостаточности.
5. **Эндокринолог** — сахарный диабет, тиреоидные нарушения, метаболический синдром.
6. **Невролог** — инсульты, эпилепсия, нейродегенеративные заболевания, головная боль.
7. **Инфекционист** — антибактериальная/противовирусная терапия, антибиотикорезистентность, выбор эмпирической схемы.
8. **Педиатр / гериатр** — возрастные особенности дозирования и подходов.
9. **Рентгенолог / специалист медицинской визуализации** — описание снимков (КТ, МРТ, рентген, УЗИ) с VLM-модулем.
10. **Лабораторная диагностика** — интерпретация анализов крови, мочи, биохимии, онкомаркёров, иммунологических панелей.
11. **Медицинский кодировщик МКБ-10** — подбор кодов по диагнозам.
12. **Специалист по клиническим путям (clinical pathways)** — пошаговые протоколы ведения.

ИСТОЧНИК КЛИНИЧЕСКИХ РЕКОМЕНДАЦИЙ:
- Ты подключён НАПРЯМУЮ к официальному репозиторию клинических рекомендаций Минздрава РФ (cr.minzdrav.gov.ru): по теме вопроса система разбирает полные тексты утверждённых КР и передаёт тебе релевантные фрагменты.
- При наличии таких фрагментов ОПИРАЙСЯ ПРЕЖДЕ ВСЕГО на них: это действующие клинические рекомендации Минздрава России. Указывай код КР (например, 62_3) и ссылку на официальный источник.
- Если по теме не найдено официальной КР — честно сообщи об этом и дай ответ с оговоркой, обозначив уровень доказательности и источник (гайдлайн, CPIC, ESC и т.п.).

ОБЩИЕ ПРИНЦИПЫ:
- Адресат ответа — ВРАЧ. Отвечай развёрнуто, конкретно и профессионально: дозы, схемы, механизмы, доказательность — без общих слов и уклончивых формулировок.
- Отвечай на русском языке (если вопрос на другом языке — отвечай на языке вопроса).
- Опирайся на доказательную базу: указывай уровень доказательности (A/B/C), источник (КР Минздрава РФ, гайдлайн, CPIC, ESC, NCCN, ВОЗ).
- При клинических случаях давай ДИФФЕРЕНЦИАЛЬНЫЙ ряд (несколько гипотез с аргументами за/против), а не один диагноз; терапию формулируй как опции ПОСЛЕ подтверждения диагноза с обоснованием каждого препарата.
- Если данных недостаточно — прямо скажи, чего именно не хватает, и предложи конкретные дополнительные обследования.
- При работе с uploaded documents: анализируй документ по частям (чанкам), не выдумывай данные, которых нет в тексте. Если в документе нет нужной информации — так и скажи. НЕ домысливай анамнез (курение, алкоголь, аллергии, наследственность), если его нет в тексте — пиши «данных нет».
- Соблюдай конфиденциальность (ФЗ-152): не запрашивай и не сохраняй персональные данные пациентов в открытом виде.

ФОРМАТ ОТВЕТА:
- Для коротких вопросов — краткий и точный ответ.
- Для клинических случаев — структурированный ответ с разделами (Клиническая картина, Дифференциальный диагноз, Дообследование, Терапия после подтверждения, Мониторинг, Прогноз).
- Для доз препаратов всегда указывай: препарат, доза, кратность, путь введения, длительность.
- Для взаимодействий — механизм, тяжесть, рекомендации по ведению.`;

// ---------------------------------------------------------------------------
// Thresholds for document chunk handling
// ---------------------------------------------------------------------------
// If the document text is shorter than this, we pass it inline as context.
// If longer, we run a map-reduce: summarize each chunk, then answer the
// question using the merged summaries. This keeps the prompt within the
// model's context window (typical 4K-8K tokens for local models).
const INLINE_DOC_LIMIT = 6000; // chars; ~1500-2000 tokens
const CHUNK_SIZE_FOR_DOCS = 2000;
const CHUNK_OVERLAP_FOR_DOCS = 200;

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: require a valid session (was optional). The route
    // invokes LM Studio + Минздрав RAG — unauthenticated access would allow
    // AI-resource abuse and external API spam.
    const session = await requireAuth(req);

    const body = (await req.json()) as ChatRequest;
    const { messages, caseContext, documentText, documentChunks, documentTitle } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages array required" }, { status: 400 });
    }

    const provider = await getActiveProvider();
    if (provider === "none") {
      // Instead of a bare 503, return a 200 with a structured message that
      // the chat UI can render as an assistant message. This way the user
      // sees a helpful explanation instead of an error toast, and the
      // conversation history is preserved (the UI doesn't clear the input).
      //
      // v4.2: даже без LM Studio система НАПРЯМУЮ разбирает репозиторий КР
      // Минздрава по теме вопроса — врач получает официальные рекомендации
      // (фрагменты + ссылки), а не только сообщение о недоступности ИИ-ядра.
      const fallbackMessage =
        "⚠️ **AI-ядро недоступно.** LM Studio не запущен или не отвечает.\n\n" +
        "Что делать:\n" +
        "1. Запустите LM Studio и загрузите модель (например, gemma-3-4b).\n" +
        "2. Убедитесь, что сервер LM Studio доступен по адресу `http://127.0.0.1:1234/v1`.\n" +
        "3. После запуска LM Studio повторите вопрос — ИИ активируется автоматически.\n\n" +
        "Система продолжает работать в штатном режиме: вы можете создавать случаи, загружать документы, формировать отчёты. Анализ будет выполнен в ручном режиме (без ИИ).";

      interface FallbackClinrecMeta {
        codeVersion: string;
        name: string;
        url: string;
        fragmentsCount: number;
      }
      let ragClinrecs: FallbackClinrecMeta[] = [];
      let degradedContent = fallbackMessage;

      const lastMsgForRag = messages[messages.length - 1]?.content || "";
      if (shouldSearchMinzdrav(lastMsgForRag) || caseContext?.diagnosisHint) {
        try {
          const { runWebRag } = await import("@/lib/web-rag");
          const ragTopicSource = [
            lastMsgForRag.slice(0, 400),
            caseContext?.diagnosisHint?.slice(0, 200) ?? "",
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
          const rag = await runWebRag({
            topic: ragTopicSource || undefined,
            diagnosisHint: caseContext?.diagnosisHint,
            maxResults: 4,
            enableContentFetch: true,
          });
          ragClinrecs = rag.results
            .filter((r) => r.codeVersion)
            .map((r) => ({
              codeVersion: r.codeVersion as string,
              name: r.title,
              url: r.url,
              fragmentsCount: r.fragments?.length ?? 0,
            }));

          if (ragClinrecs.length > 0) {
            const crBlocks = rag.results.map((r) => {
              const frags = (r.fragments ?? [])
                .slice(0, 3)
                .map((f) => `   • «${f.sectionTitle}»: ${f.text.slice(0, 400)}${f.text.length > 400 ? "…" : ""}`)
                .join("\n");
              return (
                `**${r.title}**\n` +
                `   Официальный источник: ${r.url}${r.codeVersion ? ` (КР ${r.codeVersion})` : ""}\n` +
                (frags ? frags : "   (полный текст доступен по ссылке)")
              );
            });
            degradedContent =
              fallbackMessage +
              "\n\n---\n\n" +
              "📖 **Однако по теме вопроса система напрямую разобрала официальный репозиторий КР Минздрава РФ** (cr.minzdrav.gov.ru) и нашла действующие клинические рекомендации:\n\n" +
              crBlocks.join("\n\n") +
              "\n\n*Фрагменты приведены из полных текстов КР Минздрава России; итоговый синтез выполнит ИИ-ядро после запуска LM Studio.*";
          }
        } catch {
          // Разбор репозитория в деградированном режиме — best-effort
        }
      }

      return NextResponse.json({
        message: {
          role: "assistant",
          content: degradedContent,
          timestamp: new Date().toISOString(),
        },
        provider: "none",
        meta: {
          aiUnavailable: true,
          reason: "LM Studio не отвечает",
          ragClinrecs,
          ragTopic: ragClinrecs.length > 0 ? "Минздрав РФ (прямой разбор)" : undefined,
        },
      });
    }

    const lastUserMessage = messages[messages.length - 1]?.content || "";
    const conversationHistory = messages
      .slice(0, -1)
      .map((m) => `${m.role === "user" ? "Врач" : "Ассистент"}: ${m.content}`)
      .join("\n\n");

    // ───────────────────────────────────────────────────────────────────────
    // Build the document context: chunk the text and pass it DIRECTLY to AI.
    // ───────────────────────────────────────────────────────────────────────
    let documentContext = "";
    let chunkingInfo = "";

    // Prefer pre-chunked array; fall back to raw documentText.
    let chunks: TextChunk[] = [];
    if (documentChunks && Array.isArray(documentChunks) && documentChunks.length > 0) {
      // Treat each pre-chunked string as a chunk.
      chunks = documentChunks.map((text, i) => ({
        text,
        index: i,
        total: documentChunks.length,
        startOffset: 0,
      }));
    } else if (documentText && documentText.trim().length > 0) {
      chunks = chunkText(documentText, {
        chunkSize: CHUNK_SIZE_FOR_DOCS,
        overlap: CHUNK_OVERLAP_FOR_DOCS,
      });
    }

    if (chunks.length > 0) {
      const title = documentTitle || "загруженный документ";
      const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);

      if (chunks.length === 1 || totalChars <= INLINE_DOC_LIMIT) {
        // SHORT DOCUMENT: pass the full text inline as direct context.
        documentContext = `\n\n=== ТЕКСТ ДОКУМЕНТА: "${title}" ===\n${chunks
          .map((c, i) => (chunks.length > 1 ? `--- Фрагмент ${i + 1}/${chunks.length} ---\n${c.text}` : c.text))
          .join("\n\n")}\n=== КОНЕЦ ДОКУМЕНТА ===\n`;
        chunkingInfo = `Документ передан целиком (${chunks.length} фрагмент(ов), ~${totalChars} символов).`;
      } else {
        // LONG DOCUMENT: map-reduce — summarize each chunk, then use the
        // merged summary as context. This keeps the prompt within the model's
        // context window while still giving the AI access to the full content.
        logger.info("chat", "Документ длинный — запуск map-этапа", {
          chunkCount: chunks.length,
          totalChars,
        });

        const mapSys = `Ты — медицинский ассистент. Ниже приведён фрагмент медицинского документа. Извлеки из него ВСЕ клинически значимые факты: диагнозы, препараты (с дозами и режимами), мутации, результаты анализов, процедуры, даты, рекомендации. Не придумывай. Если фактов нет — верни "Нет клинически значимых данных в этом фрагменте."`;

        const summaries: string[] = [];
        for (const chunk of chunks) {
          try {
            const summary = await llmChat(mapSys, chunk.text, {
              temperature: 0.1,
              maxTokens: 1024,
            });
            if (summary && summary.trim().length > 0) {
              summaries.push(`[Фрагмент ${chunk.index + 1}/${chunk.total}]\n${summary.trim()}`);
            }
          } catch (e) {
            logger.warn("chat", "Ошибка обработки фрагмента документа", {
              chunkIndex: chunk.index,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        documentContext = `\n\n=== СВОДКА ДОКУМЕНТА: "${title}" ===\n(Документ разбит на ${chunks.length} фрагментов; ниже — извлечённые из каждого факты)\n\n${summaries.join("\n\n")}\n=== КОНЕЦ СВОДКИ ===\n`;
        chunkingInfo = `Документ разбит на ${chunks.length} чанков по ~${CHUNK_SIZE_FOR_DOCS} символов; каждый чанк обработан ИИ отдельно, факты объединены (map-reduce).`;
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Build the final system prompt with case context + document context
    // + ПРЯМОЙ РАЗБОР РЕПОЗИТОРИЯ КР МИНЗДРАВА РФ ПО ТЕМЕ (v4.2)
    // ───────────────────────────────────────────────────────────────────────
    let contextPrompt = SYSTEM_PROMPT;
    const contextParts: string[] = [];

    if (caseContext) {
      if (caseContext.diagnosisHint) {
        contextParts.push(`Предварительный диагноз: ${caseContext.diagnosisHint}`);
      }
      if (caseContext.analysisSummary) {
        contextParts.push(`Результаты анализа:\n${caseContext.analysisSummary}`);
      }
      if (caseContext.therapyRecommendations) {
        contextParts.push(`Текущие рекомендации по терапии:\n${caseContext.therapyRecommendations}`);
      }
    }

    // ─── ПРЯМОЙ РАЗБОР РЕПОЗИТОРИЯ КР МИНЗДРАВА ПО ТЕМЕ (v4.2) ────────────
    // ИИ подключается НАПРЯМУЮ к официальному репозиторию Минздрава РФ и
    // парсит его по теме вопроса: поиск КР → полные тексты → все разделы →
    // фрагменты, релевантные теме. Выполняется для ЛЮБОГО медицинского
    // вопроса (тема = вопрос врача + диагноз кейса), без обязательного
    // контекста случая. Запрос санитизируется (PHI исключается) ДО сети.
    //
    // НЕ выполняется для приветствий/немедицинских сообщений — чтобы не
    // гонять лишние запросы к репозиторию.
    interface RagClinrecMeta {
      codeVersion: string;
      name: string;
      url: string;
      fragmentsCount: number;
      mkbString: string;
    }
    let ragClinrecs: RagClinrecMeta[] = [];
    let ragTopic: string | undefined;

    if (shouldSearchMinzdrav(lastUserMessage) || caseContext?.diagnosisHint) {
      try {
        const { runWebRag, buildWebRagContext } = await import("@/lib/web-rag");
        // Тема разбора: вопрос врача + предварительный диагноз кейса.
        // Наружу (в репозиторий) уходят ТОЛЬКО клинические термины —
        // runWebRag санитизирует запрос (query-sanitizer.ts, ФЗ-152).
        const ragTopicSource = [
          lastUserMessage.slice(0, 400),
          caseContext?.diagnosisHint?.slice(0, 200) ?? "",
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
        const webRagResponse = await runWebRag({
          topic: ragTopicSource || undefined,
          diagnosisHint: caseContext?.diagnosisHint,
          dischargeSummary: documentText?.slice(0, 3000),
          maxResults: 4,
          enableContentFetch: true,
        });
        const webCtx = buildWebRagContext(webRagResponse.results, webRagResponse.sanitizedQuery);
        if (webCtx) {
          contextParts.push(webCtx);
        }
        // Сводка разобранных КР — в meta ответа (UI показывает врачу,
        // на какие официальные КР Минздрава опирался ИИ)
        ragClinrecs = webRagResponse.results
          .filter((r) => r.codeVersion)
          .map((r) => ({
            codeVersion: r.codeVersion as string,
            name: r.title,
            url: r.url,
            fragmentsCount: r.fragments?.length ?? 0,
            mkbString: "",
          }));
        ragTopic = webRagResponse.topic;
        logger.info("chat", "Прямой разбор репозитория КР Минздрава по теме вопроса", {
          topic: (ragTopic ?? "").slice(0, 60),
          resultCount: webRagResponse.results.length,
          parsedFragments: webRagResponse.parsedFragments ?? 0,
          doctorId: session?.doctorId ?? "anonymous",
        });
      } catch (e) {
        logger.warn("chat", "Разбор репозитория Минздрава не удался (non-blocking)", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (documentContext) {
      contextParts.push(documentContext);
    }

    if (chunkingInfo) {
      contextParts.push(`[Информация об обработке документа: ${chunkingInfo}]`);
    }

    if (contextParts.length > 0) {
      contextPrompt += `\n\n=== КОНТЕКСТ ТЕКУЩЕГО СЛУЧАЯ ===\n${contextParts.join("\n\n")}`;
    }

    contextPrompt += `\n\nВАЖНО: При ответе опирайся на предоставленный текст документа и на фрагменты официальных КР Минздрава РФ (если они переданы выше). Не выдумывай факты, которых нет в документе или контексте. Если информации недостаточно — честно скажи об этом.`;

    // ───────────────────────────────────────────────────────────────────────
    // Build the user message: conversation history + current question
    // ───────────────────────────────────────────────────────────────────────
    const fullUserMessage = conversationHistory
      ? `История диалога:\n${conversationHistory}\n\nВрач: ${lastUserMessage}`
      : lastUserMessage;

    const response = await llmChat(contextPrompt, fullUserMessage, {
      temperature: 0.4,
      maxTokens: 4096,
    });

    if (!response) {
      return NextResponse.json(
        { error: "Не удалось получить ответ от ИИ. Попробуйте ещё раз или проверьте LM Studio." },
        { status: 502 },
      );
    }

    logger.info("chat", "AI chat response generated", {
      provider,
      messageCount: messages.length,
      hasDocument: chunks.length > 0,
      chunkCount: chunks.length,
      doctorId: session?.doctorId ?? "anonymous",
    });

    return NextResponse.json({
      message: {
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      },
      provider,
      meta: {
        documentChunksProcessed: chunks.length,
        chunkingStrategy:
          chunks.length === 0
            ? "none"
            : chunks.length === 1
              ? "inline"
              : "map-reduce",
        // v4.2: КР Минздрава, разобранные ИИ напрямую из репозитория по теме вопроса
        ragClinrecs,
        ragTopic,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    logger.error("chat", "AI chat error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helper: decide whether the user's question warrants a direct Минздрав
// repository parse. We DON'T parse for greetings, casual questions, or
// non-medical queries — this avoids unnecessary network calls and keeps
// the chat fast.
// ---------------------------------------------------------------------------
function shouldSearchMinzdrav(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();

  // Skip very short messages (likely greetings)
  if (lower.trim().length < 10) return false;

  // Skip obvious non-medical / greeting patterns
  const skipPatterns = [
    "привет", "hello", "hi ", "здравствуй", "добрый день", "доброе утро",
    "добрый вечер", "спасибо", "thanks", "thank you", "bye", "пока",
    "как дела", "how are you", "кто ты", "who are you", "что ты можешь",
    "what can you do",
  ];
  if (skipPatterns.some((p) => lower.includes(p))) return false;

  // Search if the message contains clinical/medical keywords
  const medicalPatterns = [
    "диагноз", "diagnosis", "лечение", "treatment", "терапия", "therapy",
    "препарат", "drug", "medication", "medicine", "доз", "dose", "dosage",
    "мутаци", "mutation", "ген", "gene", "brca", "egfr", "kras",
    "рак", "cancer", "опухол", "tumor", "метастаз", "metastasis",
    "инфекц", "infection", "воспалени", "inflammation",
    "гайдлайн", "guideline", "протокол", "protocol", "рекомендаци", "recommendation",
    "мкб", "icd", "clincial pathway", "клинический путь",
    "противопоказан", "contraindication", "взаимодейств", "interaction",
    "побочн", "side effect", "adverse", "токсичност", "toxicity",
    "диабет", "diabetes", "гипертон", "hypertension",
    "что назначить", "чем лечить", "как лечить",
    "схема лечения", "regimen", "протокол лечения",
    "доказательн", "evidence", "исследован", "study", "studies",
    "свежие данные", "последние", "latest", "recent", "новые",
  ];
  return medicalPatterns.some((p) => lower.includes(p));
}

