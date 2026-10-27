// СППВР v4.1 — Справочник МКБ-10 Минздрава РФ
// GET /api/minzdrav/mkb?q=<поиск>&limit=20
//   Поиск по справочнику МКБ-10 официального репозитория КР Минздрава.
//   Кэш — 30 дней (справочник меняется редко).

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getMkbRefList } from "@/lib/minzdrav-cr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));

  try {
    const ref = await getMkbRefList();
    if (ref.length === 0) {
      return NextResponse.json(
        { error: "Справочник МКБ Минздрава недоступен (нет сети и кэш пуст)", items: [] },
        { status: 503 },
      );
    }

    let items = ref;
    if (q) {
      items = ref.filter(
        (m) =>
          m.Code.toLowerCase().includes(q) ||
          m.Name.toLowerCase().includes(q),
      );
    }

    // Негрупповые коды (конкретные диагнозы) приоритетнее
    const sorted = [...items].sort((a, b) => {
      if (a.IsGroup !== b.IsGroup) return a.IsGroup ? 1 : -1;
      return a.Code.localeCompare(b.Code);
    });

    return NextResponse.json({
      items: sorted.slice(0, limit),
      total: items.length,
      source: "Минздрав РФ — справочник МКБ-10 (cr.minzdrav.gov.ru)",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Ошибка загрузки справочника МКБ: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
