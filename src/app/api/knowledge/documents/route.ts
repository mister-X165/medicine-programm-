// СППВР v2.1.4 — Knowledge Documents List API
// ============================================================================
// GET /api/knowledge/documents?category=<category>&limit=<n>
//
// Lists all uploaded KnowledgeDocuments for the knowledge-base UI. Returns
// metadata only (no rawText/deidText — those can be huge and would slow down
// the list view). For full text, hit GET /api/knowledge/documents/[id].
//
// Query params:
//   - category: filter by category (oncology | pharmacogenomics | cardiology |
//     rare_diseases | general). If omitted, returns all categories.
//   - limit:    max number of results (default 100, max 500).
//   - q:        optional title/fileName substring filter (case-insensitive).
//
// Returns: `{ documents: Array<{ id, title, fileName, fileType, mimeType,
//            fileSize, category, tags, chunkCount, isActive, source,
//            uploadedById, createdAt, updatedAt }> }`
//
// Authentication: REQUIRED.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const category = url.searchParams.get("category")?.trim() || "";
    const q = url.searchParams.get("q")?.trim() || "";
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam
      ? Math.min(
          Math.max(parseInt(limitParam, 10) || DEFAULT_LIMIT, 1),
          MAX_LIMIT,
        )
      : DEFAULT_LIMIT;

    // Build WHERE clause — dual-case for Cyrillic case-insensitivity.
    const qLower = q.toLowerCase();
    const qUpper = q.toUpperCase();

    const where: Record<string, unknown> = {};
    if (category) {
      where.category = category;
    }
    if (q) {
      where.OR = [
        { title: { contains: qLower } },
        { title: { contains: qUpper } },
        { fileName: { contains: qLower } },
        { fileName: { contains: qUpper } },
      ];
    }

    const documents = await db.knowledgeDocument.findMany({
      where,
      select: {
        id: true,
        title: true,
        fileName: true,
        fileType: true,
        mimeType: true,
        fileSize: true,
        category: true,
        tags: true,
        source: true,
        chunkCount: true,
        isActive: true,
        uploadedById: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ documents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
