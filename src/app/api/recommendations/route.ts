// СППВР v2.0 — Clinical Recommendations API (RAG)
// GET /api/recommendations?q=...&gene=...&category=...

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const gene = url.searchParams.get("gene")?.toUpperCase();
    const category = url.searchParams.get("category");

    const where: Record<string, unknown> = {};
    if (gene) where.gene = gene;
    if (category) where.category = category;
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
        { keywords: { contains: q } },
      ];
    }

    const recs = await db.clinicalRecommendation.findMany({
      where,
      orderBy: { category: "asc" },
    });
    return NextResponse.json({ recommendations: recs, count: recs.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "recommendations GET error", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
