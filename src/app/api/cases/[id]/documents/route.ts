// СППВР v2.0 — Case Documents API
// GET  /api/cases/[id]/documents — List documents for case
// POST /api/cases/[id]/documents — Upload document (FormData with file)
//
// SECURITY (v2.1.4): POST now enforces case ownership via `requireCaseAccess`.
// Previously any logged-in doctor could upload documents to ANY case. Audit
// attribution now uses session.doctorId (the acting doctor) instead of
// found.doctorId (the case owner) — prevents audit-log forgery.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveFile, detectFileType, fileToBase64DataUrl } from "@/lib/storage";
import { deidentifyText } from "@/lib/deidentify";
import { appendAudit } from "@/lib/audit";
import { requireCaseAccess } from "@/lib/case-access";
import { logger } from "@/lib/logger";
import {
  parseVCF,
  parseGeneticCSV,
  extractTextFromDocument,
} from "@/lib/file-parsers";
import path from "path";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// v4.3 audit fix: allowlist of accepted file types. Previously ANY file was
// accepted (only a 25 MB size cap), and the client-declared Content-Type was
// stored and later served back — enabling stored XSS via text/html or
// image/svg+xml uploads rendered inline in the application origin.
const ALLOWED_EXT = new Set([
  ".pdf", ".txt", ".md", ".csv", ".tsv", ".vcf",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp",
  ".dicom", ".dcm",
  ".docx", ".doc",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "text/x-vcard",
  "image/png", "image/jpeg", "image/gif", "image/bmp",
  "application/dicom",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

// Magic-byte signatures for the binary types we accept. Verifies the declared
// type matches the actual file contents (defends against extension/MIME spoofing).
function matchesMagic(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 8) return true; // small text files — skip sniff
  const ext2 = ext.toLowerCase();
  if (ext2 === ".pdf") return buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (ext2 === ".png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext2 === ".jpg" || ext2 === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext2 === ".gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
  if (ext2 === ".docx" || ext2 === ".doc") return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04; // ZIP (OOXML)
  if (ext2 === ".bmp") return buffer.subarray(0, 2).toString("ascii") === "BM";
  // text-like (.txt, .md, .csv, .tsv, .vcf, .dicom/.dcm) — accept
  return true;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Verify the requesting session can see this case.
    const access = await requireCaseAccess(id, req);
    if (!access.ok) return access.response;

    const docs = await db.document.findMany({
      where: { caseId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ documents: docs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "documents GET error", { caseId: id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  try {
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const found = await db.case.findUnique({ where: { id: caseId } });
    if (!found) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "File not provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    // v4.3 audit fix: enforce extension + MIME allowlist and magic-byte sniff.
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { error: `Недопустимое расширение файла: ${ext}. Разрешены: ${[...ALLOWED_EXT].join(", ")}` },
        { status: 415 },
      );
    }
    const declaredMime = (file.type || "").toLowerCase();
    if (declaredMime && !ALLOWED_MIME.has(declaredMime)) {
      return NextResponse.json(
        { error: `Недопустимый тип файла: ${declaredMime}` },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!matchesMagic(buffer, ext)) {
      return NextResponse.json(
        { error: "Содержимое файла не соответствует объявленному типу (magic bytes mismatch)" },
        { status: 415 },
      );
    }

    const fileType = detectFileType(file.name, file.type);

    // Save file to storage
    let publicUrl = "";
    try {
      publicUrl = await saveFile(buffer, ext);
    } catch (e) {
      return NextResponse.json(
        { error: `Storage error: ${e instanceof Error ? e.message : e}` },
        { status: 500 },
      );
    }

    // Extract and de-identify content based on type
    let rawContent = "";
    let deidContent = "";
    let extractedMeta: Record<string, unknown> = {};

    try {
      if (fileType === "genetic") {
        const text = buffer.toString("utf-8");
        rawContent = text;
        if (file.name.toLowerCase().endsWith(".vcf")) {
          const parsed = parseVCF(text);
          extractedMeta = {
            parser: "vcf",
            variantCount: parsed.variants.length,
            variants: parsed.variants.slice(0, 50),
          };
        } else {
          const parsed = parseGeneticCSV(text);
          extractedMeta = {
            parser: "csv",
            rowCount: parsed.rows.length,
            headers: parsed.headers,
            rows: parsed.rows.slice(0, 50),
          };
        }
        const deid = deidentifyText(text);
        deidContent = deid.text;
        extractedMeta.deidSummary = deid.replacements;
      } else if (fileType === "discharge") {
        const isText = file.type.startsWith("text/") || /\.txt$/i.test(file.name);
        if (isText) {
          rawContent = buffer.toString("utf-8");
        } else {
          const dataUrl = fileToBase64DataUrl(buffer, file.type || "application/octet-stream");
          const extracted = await extractTextFromDocument(dataUrl, file.name);
          rawContent = extracted || `[Could not extract text from ${file.name}]`;
        }
        const deid = deidentifyText(rawContent);
        deidContent = deid.text;
        extractedMeta = {
          parser: isText ? "text" : "direct",
          deidSummary: deid.replacements,
        };
      } else {
        rawContent = `[Medical image: ${file.name}]`;
        deidContent = rawContent;
        extractedMeta = { parser: "image", dimensions: "pending" };
      }
    } catch (e) {
      rawContent = `[Extraction error: ${e instanceof Error ? e.message : e}]`;
      deidContent = rawContent;
    }

    // Save document to DB
    const doc = await db.document.create({
      data: {
        caseId,
        fileName: file.name,
        fileType,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        rawContent,
        deidContent,
        extractedMeta: JSON.stringify(extractedMeta),
        storagePath: publicUrl,
      },
    });

    // Update case status
    if (found.status === "new") {
      await db.case.update({ where: { id: caseId }, data: { status: "uploaded" } });
    }

    // Audit — attribute to the ACTING doctor (session.doctorId), not the case
    // owner. Previously this used `found.doctorId`, which meant a doctor who
    // uploaded to a shared case would log the action under the owner's name —
    // audit forgery.
    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "upload",
      details: JSON.stringify({ fileName: file.name, fileType, size: file.size, deidApplied: true }),
    }).catch(() => {});

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "documents POST error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
