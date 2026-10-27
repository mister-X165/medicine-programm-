// СППВР v4.1 — Полный текст КР Минздрава РФ
// GET /api/minzdrav/clinrecs/[codeVersion]?force=false
//   Возвращает полный структурированный текст клинической рекомендации
//   (разделы с HTML-содержимым) из официального репозитория Минздрава.
//   codeVersion — формат "286_3" (код_версия).
//   Кэш — 7 дней в SQLite; ?force=true принудительно обновляет.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  getClinrecFull,
  clinrecUrl,
  clinrecPdfUrl,
  htmlToText,
  type ClinrecSection,
} from "@/lib/minzdrav-cr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ codeVersion: string }> },
) {
  const session = await requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  }

  const { codeVersion } = await params;
  const cv = decodeURIComponent(codeVersion).trim();

  if (!/^\d+_\d+$/.test(cv)) {
    return NextResponse.json(
      { error: "Некорректный формат кода версии КР (ожидается, например, 286_3)" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  try {
    const full = await getClinrecFull(cv, force);
    if (!full) {
      return NextResponse.json(
        { error: `КР ${cv} не найдена в репозитории Минздрава или репозиторий недоступен` },
        { status: 404 },
      );
    }

    const sections: ClinrecSection[] = full.obj?.sections ?? [];

    // Для UI: текстовая версия каждого раздела (HTML → текст)
    const sectionsText = sections.map((s) => ({
      id: s.id,
      title: s.title,
      content: s.content,
      text: htmlToText(s.content).slice(0, 8000),
      hasContent: s.content.trim().length > 20,
    }));

    logger.info("minzdrav-api", "Full CR served", {
      codeVersion: cv,
      name: full.name,
      sections: sections.length,
    });

    return NextResponse.json({
      clinrec: {
        codeVersion: cv,
        name: full.name,
        mkb: full.mkb,
        publishDate: full.publish_date,
        approved: full.approved,
        adult: full.adult,
        child: full.child,
        npcApproved: full.NPC_approved,
        applyStatus: full.apply_status,
        prevCrId: full.prev_cr_id,
        url: clinrecUrl(cv),
        pdfUrl: clinrecPdfUrl(cv),
      },
      sections: sectionsText,
      sectionsCount: sections.length,
    });
  } catch (e) {
    logger.error("minzdrav-api", "Full CR fetch failed", {
      codeVersion: cv,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: `Ошибка загрузки КР: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
