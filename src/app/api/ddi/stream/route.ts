// СППВР v5.0 — ПОТОКОВЫЙ ОНЛАЙН-ПОИСК ЛЕКАРСТВЕННЫХ ВЗАИМОДЕЙСТВИЙ (SSE)
// ============================================================================
// POST /api/ddi/stream
// Body: { medications: string[] }
//
// Потоковая (Server-Sent Events) проверка взаимодействий:
//   1. Нормализация МНН (бренды РФ → МНН)
//   2. Мгновенные алерты из локальной таблицы
//   3. ПОТОКОВАЯ онлайн-проверка каждой пары в российских базах данных
//      (РЛС rlsnet.ru · Видаль vidal.ru · ГРЛС Минздрава · КР Минздрава)
//      с LLM-извлечением структурированных результатов
//   4. Сводное заключение
//
// Каждое событие — JSON в формате SSE: `data: {...}\n\n`
// События: stage | normalized | local-alerts | pair-start | pair-search |
//          pair-found | pair-llm | pair-done | alert | pair-error |
//          summary | complete | error
// ============================================================================

import { streamDDICheck, type DdiStreamEvent } from "@/lib/ddi-online";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  // Аутентификация обязательна (defense-in-depth, ФЗ-152)
  const session = await requireAuth(req).catch(() => null);
  if (!session) {
    return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  }

  let body: { medications?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const medications = Array.isArray(body.medications)
    ? body.medications
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim().slice(0, 120))
        .filter(Boolean)
    : [];

  if (medications.length < 2) {
    return Response.json({ error: "Минимум 2 препарата" }, { status: 400 });
  }
  if (medications.length > 16) {
    return Response.json({ error: "Максимум 16 препаратов за одну проверку" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DdiStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Клиент отключился — поток уже закрыт
        }
      };

      try {
        for await (const event of streamDDICheck(medications, { online: true, concurrency: 3 })) {
          send(event);
        }
        logger.info("ddi-online", "Streaming DDI check finished", {
          doctorId: session.doctorId,
          medicationCount: medications.length,
          durationMs: Date.now() - startedAt,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error("ddi-online", "Streaming DDI check failed", {
          doctorId: session.doctorId,
          error: msg,
        });
        send({ type: "error", message: msg });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      logger.info("ddi-online", "Streaming DDI check cancelled by client");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
