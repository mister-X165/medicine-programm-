// СППВР v2.0 — Document by ID API
// GET    /api/cases/[id]/documents/[docId]            — Download original file (auth-checked)
// GET    /api/cases/[id]/documents/[docId]?preview=1   — Stream file inline for preview
// DELETE /api/cases/[id]/documents/[docId]             — Delete document
//
// SECURITY (v2.1.4): DELETE now enforces case ownership via `requireCaseAccess`.
// Previously any logged-in doctor could delete ANY document in ANY case (IDOR).
// GET already had an inline ownership check; it is preserved here.
//
// SECURITY (v2.1): documents are stored in /private-storage (outside /public).
// They can only be retrieved through this auth-checked endpoint. The previous
// design returned a /uploads/... public URL that was downloadable without auth.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteFile } from "@/lib/storage";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCaseAccess } from "@/lib/case-access";
import { appendAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { decryptFile } from "@/lib/encryption";

export const dynamic = "force-dynamic";

// MIME types that can carry active content (scripts). These are NEVER served
// inline — always forced to "attachment" so the browser downloads instead of
// executing in the application origin (stored-XSS defense, v4.3 audit fix).
const ACTIVE_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/xml",
  "text/xml",
]);

/** Returns a safe, normalized MIME type for a stored document. Active types
 *  are downgraded to a non-executable type when served inline is impossible,
 *  but we primarily rely on Content-Disposition: attachment. */
function safeServeMime(declared: string | null | undefined): string {
  const m = (declared || "application/octet-stream").toLowerCase();
  return m || "application/octet-stream";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id: caseId, docId } = await params;
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const doc = await db.document.findUnique({
      where: { id: docId },
      select: { id: true, caseId: true, fileName: true, mimeType: true, storagePath: true, fileSize: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.caseId !== caseId) {
      return NextResponse.json({ error: "Document does not belong to this case" }, { status: 404 });
    }

    // Authorization: admin or case owner (or shared doctor).
    const foundCase = await db.case.findUnique({
      where: { id: caseId },
      select: { doctorId: true },
    });
    if (!foundCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (foundCase.doctorId !== session.doctorId && session.role !== "admin") {
      const share = await db.caseShare.findFirst({
        where: { caseId, toDoctorId: session.doctorId, status: "active" },
      });
      if (!share) {
        return NextResponse.json({ error: "Not authorized to access this document" }, { status: 403 });
      }
    }

    if (!doc.storagePath) {
      return NextResponse.json({ error: "File not available" }, { status: 404 });
    }

    // Normalize legacy public paths to private-storage relative paths.
    let relPath = doc.storagePath;
    if (relPath.startsWith("/uploads/")) {
      relPath = relPath.slice("/uploads/".length); // -> "filename.ext"
      relPath = `uploads/${relPath}`;
    } else if (relPath.startsWith("/")) {
      relPath = relPath.slice(1);
    }

    // v4.3 audit fix: encrypted-at-rest only. We NO LONGER fall back to a
    // plaintext read — a missing/tampered .enc/.meta now yields 404 instead
    // of silently serving substituted bytes (integrity defense).
    let buffer: Buffer | null = null;
    try {
      const decrypted = await decryptFile(relPath);
      if (decrypted) {
        buffer = decrypted.data;
      }
    } catch (e) {
      logger.warn("api", "documents/[docId] decryptFile failed; refusing plaintext fallback", {
        caseId, docId, error: e instanceof Error ? e.message : String(e),
      });
    }
    if (!buffer) {
      return NextResponse.json({ error: "File not found in private storage" }, { status: 404 });
    }

    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";
    const mime = safeServeMime(doc.mimeType);
    // Active-content types are NEVER served inline — force attachment to
    // prevent stored XSS via uploaded HTML/SVG (v4.3 audit fix).
    const disposition = preview && !ACTIVE_MIME_TYPES.has(mime) ? "inline" : "attachment";
    const fileName = encodeURIComponent(doc.fileName || "document");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "documents/[docId] GET error", { caseId, docId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id: caseId, docId } = await params;
  try {
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const doc = await db.document.findUnique({
      where: { id: docId },
      select: { id: true, caseId: true, storagePath: true, fileName: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.caseId !== caseId) {
      return NextResponse.json({ error: "Document does not belong to this case" }, { status: 404 });
    }
    if (doc.storagePath) {
      let relPath = doc.storagePath;
      if (relPath.startsWith("/uploads/")) {
        relPath = `uploads/${relPath.slice("/uploads/".length)}`;
      } else if (relPath.startsWith("/")) {
        relPath = relPath.slice(1);
      }
      await deleteFile(relPath);
    }
    await db.document.delete({ where: { id: docId } });

    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "delete_document",
      details: JSON.stringify({ docId, fileName: doc.fileName }),
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "documents/[docId] DELETE error", { caseId, docId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
