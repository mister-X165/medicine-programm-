// СППВР v2.1 — DDI Override API
// ============================================================================
// POST /api/cases/[id]/ddi-override
//   Body: { drug1: string, drug2: string, reason: string }
//
// Lets a doctor formally OVERRIDE a Drug-Drug Interaction alert with a
// documented clinical justification. The override is:
//   1. Persisted on the matching alert inside analysis.ddiAlerts (JSON)
//   2. Recorded in the immutable audit log via appendAudit (HIPAA / ФЗ-152)
//
// Authorization: only the case's owner doctor OR an admin may override.
// Validation: `reason` MUST be at least 10 characters (meaningful clinical
// justification, not a one-word ack).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import { getSessionFromRequest } from "@/lib/auth";
import { safeJsonParse } from "@/lib/utils";
import type { DDIAlert } from "@/lib/types";

export const dynamic = "force-dynamic";

const MIN_REASON_LENGTH = 10;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  // 1. Authentication
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  // 2. Parse & validate body
  let body: { drug1?: string; drug2?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const drug1 = typeof body.drug1 === "string" ? body.drug1.trim() : "";
  const drug2 = typeof body.drug2 === "string" ? body.drug2.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!drug1 || !drug2) {
    return NextResponse.json(
      { error: "drug1 and drug2 are required" },
      { status: 400 },
    );
  }
  if (reason.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      {
        error: `Clinical justification must be at least ${MIN_REASON_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  // 3. Load analysis with case (to check ownership)
  const analysis = await db.analysisResult.findUnique({
    where: { caseId },
    include: { case: { select: { doctorId: true } } },
  });
  if (!analysis) {
    return NextResponse.json(
      { error: "Analysis not found for this case" },
      { status: 404 },
    );
  }

  // 4. Authorization — owner doctor OR admin
  const isOwner = analysis.case.doctorId === session.doctorId;
  const isAdmin = session.role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: "Forbidden: only the case owner or an admin may override DDI alerts" },
      { status: 403 },
    );
  }

  // 5. Load current ddiAlerts array
  const ddiAlerts = safeJsonParse<DDIAlert[]>(analysis.ddiAlerts, []);

  // 6. Find the matching alert (case-insensitive on drug1 + drug2).
  //    Match in either order (drug1+drug2 OR drug2+drug1) so the doctor
  //    doesn't need to remember which way the pair was originally stored.
  const d1l = drug1.toLowerCase();
  const d2l = drug2.toLowerCase();
  const alertIndex = ddiAlerts.findIndex(
    (a) =>
      (a.drug1?.toLowerCase() === d1l && a.drug2?.toLowerCase() === d2l) ||
      (a.drug1?.toLowerCase() === d2l && a.drug2?.toLowerCase() === d1l),
  );

  if (alertIndex === -1) {
    return NextResponse.json(
      { error: `No DDI alert found for ${drug1} + ${drug2}` },
      { status: 404 },
    );
  }

  const alert = ddiAlerts[alertIndex];

  // 7. Apply the override
  const overriddenAt = new Date().toISOString();
  const overrideRecord = {
    overridden: true,
    overrideReason: reason,
    overriddenBy: session.doctorId,
    overriddenAt,
  };
  ddiAlerts[alertIndex] = {
    ...alert,
    override: overrideRecord,
  };

  // 8. Persist back to the analysis (JSON string column)
  await db.analysisResult.update({
    where: { caseId },
    data: { ddiAlerts: JSON.stringify(ddiAlerts) },
  });

  // 9. Audit log entry (immutable, hash-chained)
  await appendAudit({
    caseId,
    doctorId: session.doctorId,
    action: "ddi_override",
    details: {
      drug1: alert.drug1,
      drug2: alert.drug2,
      reason,
      alertSeverity: alert.severity,
    },
  });

  logger.info("ddi", "DDI alert overridden", {
    caseId,
    drug1: alert.drug1,
    drug2: alert.drug2,
    doctorId: session.doctorId,
  });

  // 10. Return the updated alert
  return NextResponse.json({ success: true, alert: ddiAlerts[alertIndex] });
}
