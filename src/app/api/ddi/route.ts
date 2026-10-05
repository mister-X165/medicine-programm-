// СППВР v5.0 — Drug-Drug Interaction (DDI) API
// GET  /api/ddi?drug=... — Get DDI records for a drug (локальный справочник)
// POST /api/ddi          — Проверка взаимодействий: ПОТОКОВЫЙ ОНЛАЙН-ПОИСК
//                          в российских базах (РЛС/Видаль/ГРЛС/КР Минздрава)
//                          + локальная таблица. Для SSE-версии см. /api/ddi/stream.
//
// Body POST: { medications: string[], online?: boolean }
//   online=true (по умолчанию) — онлайн-поиск по базам РФ + LLM-извлечение
//   online=false               — только локальная таблица (офлайн-режим)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkDDIOnline } from "@/lib/ddi-online";
import { checkDDISchema, validateOrThrow } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const drug = url.searchParams.get("drug")?.trim() || "";

    if (!drug) {
      return NextResponse.json({ interactions: [], count: 0 });
    }

    const drugLower = drug.toLowerCase();
    const interactions = await db.drugInteraction.findMany({
      where: {
        OR: [
          { drug1: { contains: drugLower } },
          { drug2: { contains: drugLower } },
        ],
      },
      orderBy: { severity: "desc" },
    });

    return NextResponse.json({ interactions, count: interactions.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: require auth (defense-in-depth).
    await requireAuth(req);
    const body = await req.json();
    const data = validateOrThrow(checkDDISchema, body);

    // v5.0: ПОТОКОВЫЙ ОНЛАЙН-ПОИСК в российских базах данных.
    // Не-потоковая версия движка: полный результат одним JSON.
    const online = body?.online !== false;
    const result = await checkDDIOnline(data.medications, online);

    logger.info("ddi", "DDI check performed (v5.0 online engine)", {
      medicationCount: data.medications.length,
      alertCount: result.alerts.length,
      online: result.online,
      pairsChecked: result.pairsChecked,
      pairsFromCache: result.pairsFromCache,
      durationMs: result.durationMs,
    });

    return NextResponse.json({
      alerts: result.alerts,
      count: result.alerts.length,
      normalizedMedications: result.normalizedMedications,
      summary: result.summary,
      pairsChecked: result.pairsChecked,
      pairsFromCache: result.pairsFromCache,
      sourcesUsed: result.sourcesUsed,
      durationMs: result.durationMs,
      online: result.online,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (e instanceof Error && e.message.startsWith("Validation error")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
