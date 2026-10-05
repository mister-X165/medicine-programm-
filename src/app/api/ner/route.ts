// СППВР — NER De-identification API
// POST /api/ner — Run NER-based de-identification on text
// GET /api/ner — Check NER availability

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { nerDeidentify, isNERAvailable, combinedDeidentify } from "@/lib/ner-deidentify";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const available = await isNERAvailable();
    return NextResponse.json({
      available,
      method: "regex_local",
      model: "regex-local-v2",
    });
  } catch {
    return NextResponse.json({ available: false, method: "regex_fallback", model: null });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAuth(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const { text, lang = "ru", mode = "combined" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (text.length > 50000) {
      return NextResponse.json({ error: "Text too long (max 50000 characters)" }, { status: 400 });
    }

    let result;

    if (mode === "ner_only") {
      result = await nerDeidentify(text, lang);
    } else {
      // Combined mode: NER ML + regex fallback
      result = await combinedDeidentify(text, lang);
    }

    logger.info("ner", "NER de-identification completed", {
      method: result.method,
      entityCount: result.entities.length,
      processingTimeMs: result.processingTimeMs,
      doctorId: session.doctorId,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    logger.error("ner", "NER API error", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
