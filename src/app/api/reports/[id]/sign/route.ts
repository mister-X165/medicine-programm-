// СППВР v2.0 — Report Electronic Signature API
// POST /api/reports/[id]/sign — Sign report (electronic signature)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signReportSchema, validateOrThrow } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: reportId } = await params;

  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const data = validateOrThrow(signReportSchema, body);

    const report = await db.report.findUnique({
      where: { id: reportId },
      select: { id: true, caseId: true, status: true, case: { select: { doctorId: true } } },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // SECURITY (v4.3 audit fix): a doctor may only sign a report belonging to
    // a case they own (or that was actively shared with them), or an admin.
    // Previously any authenticated doctor could co-sign ANY report by cuid.
    const isCaseOwner = report.case?.doctorId === session.doctorId;
    const isAdmin = session.role === "admin";
    if (!isCaseOwner && !isAdmin) {
      const share = await db.caseShare.findFirst({
        where: { caseId: report.caseId, toDoctorId: session.doctorId, status: "active" },
      });
      if (!share) {
        return NextResponse.json(
          { error: "Not authorized to sign this report" },
          { status: 403 },
        );
      }
    }

    // Check if doctor already signed this report
    const existingSignature = await db.reportSignature.findFirst({
      where: { reportId, doctorId: session.doctorId },
    });

    if (existingSignature) {
      return NextResponse.json({ error: "You have already signed this report" }, { status: 409 });
    }

    // Create signature
    const signature = await db.reportSignature.create({
      data: {
        reportId,
        doctorId: session.doctorId,
        signatureType: data.signatureType,
        comment: data.comment || "",
      },
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true } },
      },
    });

    // Update report status to "signed" if approval signature
    if (data.signatureType === "approval") {
      await db.report.update({
        where: { id: reportId },
        data: { status: "signed" },
      });
    }

    // Audit
    await appendAudit({
      caseId: report.caseId,
      doctorId: session.doctorId,
      action: "sign_report",
      details: JSON.stringify({
        reportId,
        signatureType: data.signatureType,
        signatureId: signature.id,
      }),
    });

    logger.info("reports", "Report signed", { reportId, doctorId: session.doctorId, signatureType: data.signatureType });

    return NextResponse.json({
      signature: {
        id: signature.id,
        reportId: signature.reportId,
        doctorId: signature.doctorId,
        signatureType: signature.signatureType,
        comment: signature.comment,
        signedAt: signature.signedAt.toISOString(),
        doctor: signature.doctor,
      },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "Authentication required") {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    if (e instanceof Error && e.message.startsWith("Validation error")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
