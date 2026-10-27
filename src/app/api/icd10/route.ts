// СППВР v2.0 — ICD-10 Search & Suggest API
// GET  /api/icd10?q=... — Search ICD-10 codes
// POST /api/icd10       — Suggest ICD-10 codes for diagnosis (uses LLM)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suggestICD10Codes } from "@/lib/rag";
import { suggestICD10Schema, validateOrThrow } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import type { Entity } from "@/lib/types";

export const dynamic = "force-dynamic";

// v2.7.2 (audit fix): zod-схема допускает произвольную строку в type —
// нормализуем к строгому union перед передачей в RAG.
const ENTITY_TYPES: ReadonlySet<string> = new Set([
  "diagnosis", "medication", "dosage", "procedure", "lab_value", "date", "other",
]);
function normalizeEntities(raw: Array<{ type: string; value: string; context?: string }> | undefined): Entity[] {
  if (!raw) return [];
  return raw
    .filter((e) => e && typeof e.value === "string" && e.value.trim() !== "")
    .map((e) => ({
      type: (ENTITY_TYPES.has(e.type) ? e.type : "other") as Entity["type"],
      value: e.value,
      context: e.context ?? "",
    }));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";

    if (!q) {
      return NextResponse.json({ codes: [], count: 0 });
    }

    const qLower = q.toLowerCase();
    const codes = await db.iCD10Code.findMany({
      where: {
        OR: [
          { code: { contains: qUpper(q) } },
          { description: { contains: qLower } },
          { block: { contains: qLower } },
          { chapter: { contains: qLower } },
        ],
      },
      take: 50,
      orderBy: { code: "asc" },
    });

    return NextResponse.json({ codes, count: codes.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: ICD-10 LLM suggestion invokes the model — require auth.
    await requireAuth(req);
    const body = await req.json();
    const data = validateOrThrow(suggestICD10Schema, body);

    const suggestions = await suggestICD10Codes(
      data.diagnosisText,
      normalizeEntities(data.entities),
    );

    logger.info("icd10", "ICD-10 suggestions generated", { count: suggestions.length });

    return NextResponse.json({ suggestions });
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

function qUpper(s: string): string {
  return s.toUpperCase();
}
