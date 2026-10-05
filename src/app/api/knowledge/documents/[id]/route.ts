// СППВР v2.3.2 — Knowledge Document Detail API
// ============================================================================
// GET /api/knowledge/documents/[id]
// DELETE /api/knowledge/documents/[id]
//
// Returns the full record for a single KnowledgeDocument (including rawText
// and deidText — which are excluded from the list endpoint for performance).
//
// DELETE soft-deletes by setting isActive=false (preserves audit chain) —
// actually hard-deletes since there's no recovery path and the user wants
// the document gone. Audit log records the deletion.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import { safeJsonParse } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { id } = await params;
    const doc = await db.knowledgeDocument.findUnique({ where: { id } });
    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      document: {
        id: doc.id,
        title: doc.title,
        fileName: doc.fileName,
        fileType: doc.fileType,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        category: doc.category,
        tags: safeJsonParse(doc.tags, []),
        source: doc.source,
        chunkCount: doc.chunkCount,
        isActive: doc.isActive,
        uploadedById: doc.uploadedById,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        // Full text (excluded from list view for performance)
        rawText: doc.rawText,
        deidText: doc.deidText,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("knowledge", "Knowledge document GET failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { id } = await params;
    const doc = await db.knowledgeDocument.findUnique({
      where: { id },
      select: { id: true, fileName: true, title: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    await db.knowledgeDocument.delete({ where: { id } });

    await appendAudit({
      doctorId: session.doctorId,
      action: "delete_knowledge_document",
      details: JSON.stringify({
        documentId: doc.id,
        fileName: doc.fileName,
        title: doc.title,
      }),
    });

    logger.info("knowledge", "Knowledge document deleted", {
      documentId: doc.id,
      fileName: doc.fileName,
      doctorId: session.doctorId,
    });

    return NextResponse.json({ success: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("knowledge", "Knowledge document DELETE failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
