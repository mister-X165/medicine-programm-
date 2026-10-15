// СППВР v2.0 — Analysis Control Panel API
// PATCH /api/cases/[id]/analysis/control
//   - controlWeights: factor weights (doctor adjusts manually)
//   - doctorComments: doctor comments
//   - conclusion: override conclusion
//
// SECURITY (v4.3 audit fix): previously this route had NO authentication and
// NO ownership check — any authenticated doctor could overwrite the clinical
// conclusion of ANY case by cuid, and the audit entry was attributed to the
// case OWNER (audit forgery). Now: enforces requireCaseAccess and attributes
// the audit to the acting session.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import { requireCaseAccess } from "@/lib/case-access";
import { controlPanelSchema, validateOrThrow } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_CONCLUSION_LEN = 20000;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  // Authorization: must have access to this case (owner / shared / admin).
  const access = await requireCaseAccess(caseId, req);
  if (!access.ok) return access.response;
  const { session } = access;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate the body shape; allow partial control-panel updates.
  const parsed = controlPanelSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Validation error: ${parsed.error.issues.map((i) => i.message).join(", ")}` },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await db.analysisResult.findUnique({
    where: { caseId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (data.controlWeights) {
    updates.controlWeights = JSON.stringify(data.controlWeights);
  }
  if (data.doctorComments) {
    updates.doctorComments = JSON.stringify(data.doctorComments);
  }
  if (data.conclusion !== undefined) {
    updates.conclusion = String(data.conclusion).slice(0, MAX_CONCLUSION_LEN);
  }

  // v5.1 (audit 9 / partial 5): hard workflow gate for therapy options.
  // Подтверждение/отмена подтверждения диагноза сохраняется в
  // `structured.confirmedDx` — UI использует его, чтобы разблокировать
  // TherapyOption'ы с соответствующим `targetDx`. До подтверждения
  // карточки терапии отображаются «замороженными» и недоступны.
  if (data.confirmDx) {
    const currentStructured = (() => {
      try {
        return existing.structured
          ? (JSON.parse(existing.structured) as {
              confirmedDx?: string[];
              differential?: Array<{ diagnosis?: string }>;
            })
          : {};
      } catch {
        return {};
      }
    })();

    const dxList: string[] = Array.isArray(currentStructured.confirmedDx)
      ? [...currentStructured.confirmedDx]
      : [];
    const targetDx = data.confirmDx.diagnosis.trim();
    const already = dxList.some((d) => d.toLowerCase() === targetDx.toLowerCase());

    if (data.confirmDx.action === "confirm_dx") {
      if (!already) dxList.push(targetDx);
    } else {
      // unconfirm_dx
      if (already) {
        const idx = dxList.findIndex((d) => d.toLowerCase() === targetDx.toLowerCase());
        if (idx >= 0) dxList.splice(idx, 1);
      }
    }

    // Merge structured: preserve existing fields, update confirmedDx.
    const merged = { ...currentStructured, confirmedDx: dxList };
    updates.structured = JSON.stringify(merged);

    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: data.confirmDx.action,
      details: JSON.stringify({
        diagnosis: targetDx,
        evidence: data.confirmDx.evidence ?? null,
        confirmedCount: dxList.length,
      }),
    });

    logger.info("analysis", "Diagnosis confirmation toggled", {
      caseId,
      action: data.confirmDx.action,
      diagnosis: targetDx,
      confirmedCount: dxList.length,
      by: session.doctorCode,
    });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await db.analysisResult.update({
    where: { caseId },
    data: updates,
  });

  // Audit — attribute to the ACTING doctor (session), not the case owner.
  // (Skip if confirmDx already audited above to avoid double entries.)
  if (!data.confirmDx) {
    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "control_panel_edit",
      details: JSON.stringify({ fields: Object.keys(updates) }),
    });
  }

  logger.info("analysis", "Control panel updated", {
    caseId,
    fields: Object.keys(updates),
    by: session.doctorCode,
  });

  // Re-parse structured for the response so the client sees the new
  // confirmedDx list immediately.
  const structuredOut = (() => {
    try {
      return updated.structured ? JSON.parse(updated.structured) : null;
    } catch {
      return null;
    }
  })();

  return NextResponse.json({
    analysis: {
      controlWeights: JSON.parse(updated.controlWeights || "{}"),
      doctorComments: JSON.parse(updated.doctorComments || "[]"),
      conclusion: updated.conclusion,
      structured: structuredOut,
    },
  });
}
