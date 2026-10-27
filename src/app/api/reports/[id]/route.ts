// СППВР v2.0 — Report by ID API
// GET    /api/reports/[id]            — Get report metadata
// GET    /api/reports/[id]?download=1 — Download PDF file (auth-checked)
// PATCH  /api/reports/[id]            — Approve report
// DELETE /api/reports/[id]            — Delete report
//
// SECURITY (v2.1): PDF reports are stored in /private-storage (OUTSIDE the
// Next.js /public static folder). They can only be retrieved through this
// auth-checked endpoint. Previously reports lived in /public/uploads/reports
// and were downloadable by anyone who guessed the UUID-based filename — a
// direct ФЗ-152 / HIPAA disclosure.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";
import { appendAudit } from "@/lib/audit";
import { decryptFile } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  const report = await db.report.findUnique({
    where: { id },
    include: {
      doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
      case: { select: { id: true, caseCode: true, doctorId: true } },
      signatures: {
        include: { doctor: { select: { id: true, fullName: true, specialization: true } } },
        orderBy: { signedAt: "desc" },
      },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // v2.6 (IDOR fix): авторизация выполняется для ЛЮБОГО доступа к отчёту
  // (не только при download) — ранее JSON-контент отчёта мог читать любой
  // аутентифицированный врач по ID.
  const session = await getSessionFromRequest(req);
  if (session) {
    const isOwner = report.doctorId === session.doctorId;
    const isCaseOwner = report.case?.doctorId === session.doctorId;
    const isAdmin = session.role === "admin";
    const isSigner = report.signatures.some((s) => s.doctor?.id === session.doctorId);
    if (!isOwner && !isCaseOwner && !isAdmin && !isSigner) {
      return NextResponse.json({ error: "Not authorized to access this report" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // PDF download mode — read from private-storage (NOT /public).
  if (download) {
    if (!report.pdfPath) {
      return NextResponse.json({ error: "PDF file not available for this report" }, { status: 404 });
    }
    // pdfPath хранится как относительный путь внутри private-storage
    // (например "reports/uuid.pdf"). Старые записи могут иметь формат
    // "/uploads/reports/uuid.pdf" — нормализуем.
    let relPath = report.pdfPath;
    if (relPath.startsWith("/uploads/reports/")) {
      relPath = relPath.slice("/uploads/".length); // -> "reports/uuid.pdf"
    } else if (relPath.startsWith("/")) {
      relPath = relPath.slice(1);
    }

    // v4.3 audit fix: reports are encrypted at rest (writeEncrypted on save).
    // We NO LONGER fall back to a plaintext read — a missing/tampered .enc
    // or .meta now yields 404 instead of silently serving substituted bytes.
    // This closes a path where an attacker with filesystem write access could
    // swap a ciphertext for a different plaintext and have it served.
    let buffer: Buffer | null = null;
    try {
      const decrypted = await decryptFile(relPath);
      if (decrypted) {
        buffer = decrypted.data;
      }
    } catch (e) {
      logger.warn("reports", "decryptFile failed; refusing plaintext fallback", {
        reportId: id, error: e instanceof Error ? e.message : String(e),
      });
    }
    if (!buffer) {
      return NextResponse.json({ error: "PDF file not found in private storage" }, { status: 404 });
    }
    const fileName = `report-${report.case.caseCode}-${report.id.slice(-8)}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-cache",
      },
    });
  }

  // Report metadata
  return NextResponse.json({
    report: {
      id: report.id,
      caseId: report.caseId,
      title: report.title,
      content: report.content,
      pdfPath: report.pdfPath,
      status: report.status,
      watermark: report.watermark,
      templateId: report.templateId,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      doctor: report.doctor,
      signatures: report.signatures.map((s) => ({
        id: s.id,
        doctorId: s.doctorId,
        signatureType: s.signatureType,
        comment: s.comment,
        signedAt: s.signedAt.toISOString(),
        doctor: s.doctor,
      })),
    },
    case: { id: report.case.id, caseCode: report.case.caseCode },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.status !== "approved") {
    return NextResponse.json({ error: 'Only transition to "approved" is supported' }, { status: 400 });
  }

  const found = await db.report.findUnique({
    where: { id },
    select: { id: true, caseId: true, doctorId: true, status: true, case: { select: { doctorId: true } } },
  });
  if (!found) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Authorization: report author OR case owner OR admin OR existing signer.
  const isOwner = found.doctorId === session.doctorId;
  const isCaseOwner = found.case?.doctorId === session.doctorId;
  const isAdmin = session.role === "admin";
  if (!isOwner && !isCaseOwner && !isAdmin) {
    return NextResponse.json({ error: "Not authorized to approve this report" }, { status: 403 });
  }

  const updated = await db.report.update({
    where: { id },
    data: { status: "approved" },
    include: {
      doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
    },
  });

  // Audit — attribute to the ACTING doctor (session), not the report author.
  await appendAudit({
    caseId: found.caseId,
    doctorId: session.doctorId,
    action: "approve_report",
    details: JSON.stringify({ reportId: found.id, previousStatus: found.status, newStatus: "approved" }),
  });

  return NextResponse.json({
    report: {
      id: updated.id,
      caseId: updated.caseId,
      title: updated.title,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const found = await db.report.findUnique({
    where: { id },
    select: { id: true, caseId: true, doctorId: true, pdfPath: true, case: { select: { doctorId: true } } },
  });
  if (!found) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Authorization: report author OR case owner OR admin.
  const isOwner = found.doctorId === session.doctorId;
  const isCaseOwner = found.case?.doctorId === session.doctorId;
  const isAdmin = session.role === "admin";
  if (!isOwner && !isCaseOwner && !isAdmin) {
    return NextResponse.json({ error: "Not authorized to delete this report" }, { status: 403 });
  }

  if (found.pdfPath) {
    let relPath = found.pdfPath;
    if (relPath.startsWith("/uploads/reports/")) {
      relPath = relPath.slice("/uploads/".length);
    } else if (relPath.startsWith("/")) {
      relPath = relPath.slice(1);
    }
    await deleteFile(relPath);
  }

  await db.report.delete({ where: { id: found.id } });

  // Audit — attribute to the ACTING doctor (session), not the report author.
  await appendAudit({
    caseId: found.caseId,
    doctorId: session.doctorId,
    action: "delete_report",
    details: JSON.stringify({ reportId: found.id }),
  });

  return NextResponse.json({ success: true });
}
