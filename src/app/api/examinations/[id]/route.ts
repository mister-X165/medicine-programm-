// СППВР v4.1 — Управление отдельным обследованием
// PATCH  /api/examinations/[id] — обновление статуса, результатов, заключения
// DELETE /api/examinations/[id] — удаление обследования (только admin/head)
//
// PATCH Body (частичное обновление):
//   { status?, priority?, scheduledAt?, completedAt?, performedAt?,
//     performedById?, resultValue?, resultData?, interpretation?,
//     conclusion?, isAbnormal?, notes?, clinrecCodeVersion?, clinrecName?, clinrecMkb? }
//
// Автоматика:
//   • status=completed → completedAt ставится автоматически (если не задан)
//   • resultData (параметры с refLow/refHigh) → isAbnormal вычисляется,
//     если не задан явно: любой параметр вне референсного интервала → true

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { requirePatientAccess } from "@/lib/patient-access";
import { appendAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { safeJsonParse } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EXAM_STATUSES = new Set([
  "ordered", "scheduled", "in_progress", "completed", "cancelled",
]);
const PRIORITIES = new Set(["routine", "urgent", "stat"]);

interface ResultParam {
  parameter?: string;
  value?: string | number;
  unit?: string;
  refLow?: number | null;
  refHigh?: number | null;
  flag?: string;
}

/** Вычисляет признак отклонения по массиву параметров результата. */
function computeAbnormal(resultData: ResultParam[]): boolean {
  for (const p of resultData) {
    const num = typeof p.value === "number" ? p.value : parseFloat(String(p.value ?? ""));
    if (Number.isNaN(num)) continue;
    const low = typeof p.refLow === "number" ? p.refLow : null;
    const high = typeof p.refHigh === "number" ? p.refHigh : null;
    if (low != null && num < low) return true;
    if (high != null && num > high) return true;
    if (p.flag && p.flag !== "normal") return true;
  }
  return false;
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

  try {
    const existing = await db.examination.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Обследование не найдено" }, { status: 404 });
    }

    // SECURITY (v4.3 audit fix): verify the caller has access to the patient
    // who owns this examination. Previously any authenticated doctor could
    // mutate ANY examination by cuid (IDOR on PHI lab/imaging results).
    const access = await requirePatientAccess(req, existing.patientId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!EXAM_STATUSES.has(body.status)) {
        return NextResponse.json({ error: "Недопустимый статус обследования" }, { status: 400 });
      }
      data.status = body.status;
      // Автоматическая фиксация даты завершения
      if (body.status === "completed" && !existing.completedAt && !body.completedAt) {
        data.completedAt = new Date();
      }
      if (body.status === "cancelled" && body.cancelReason) {
        data.notes = `${existing.notes ? existing.notes + "\n" : ""}Причина отмены: ${String(body.cancelReason).slice(0, 500)}`;
      }
    }
    if (body.priority !== undefined && PRIORITIES.has(body.priority)) {
      data.priority = body.priority;
    }
    if (body.scheduledAt !== undefined) {
      const d = body.scheduledAt ? new Date(body.scheduledAt) : null;
      data.scheduledAt = d && !isNaN(d.getTime()) ? d : null;
    }
    if (body.completedAt !== undefined) {
      const d = body.completedAt ? new Date(body.completedAt) : null;
      data.completedAt = d && !isNaN(d.getTime()) ? d : null;
    }
    if (body.performedAt !== undefined) {
      data.performedAt = String(body.performedAt).slice(0, 200);
    }
    if (body.performedById !== undefined) {
      data.performedById = body.performedById || session.doctorId || null;
    }
    if (body.resultValue !== undefined) {
      data.resultValue = String(body.resultValue).slice(0, 5000);
    }
    if (body.resultData !== undefined) {
      // Валидируем структуру параметров результата
      const parsed = Array.isArray(body.resultData)
        ? body.resultData
        : safeJsonParse(body.resultData, [] as ResultParam[]);
      const cleaned = (parsed as ResultParam[])
        .filter((p) => p && (p.parameter || p.value !== undefined))
        .slice(0, 50)
        .map((p) => ({
          parameter: String(p.parameter ?? "").slice(0, 200),
          value: p.value,
          unit: String(p.unit ?? "").slice(0, 30),
          refLow: typeof p.refLow === "number" ? p.refLow : null,
          refHigh: typeof p.refHigh === "number" ? p.refHigh : null,
          flag: String(p.flag ?? "normal").slice(0, 20),
        }));
      data.resultData = JSON.stringify(cleaned);
      // Автовычисление признака отклонения, если не задан явно
      if (body.isAbnormal === undefined) {
        data.isAbnormal = computeAbnormal(cleaned);
      }
    }
    if (body.interpretation !== undefined) {
      data.interpretation = String(body.interpretation).slice(0, 5000);
    }
    if (body.conclusion !== undefined) {
      data.conclusion = String(body.conclusion).slice(0, 5000);
    }
    if (body.isAbnormal !== undefined) {
      data.isAbnormal = Boolean(body.isAbnormal);
    }
    if (body.notes !== undefined) {
      data.notes = String(body.notes).slice(0, 2000);
    }
    if (body.clinrecCodeVersion !== undefined) {
      const cv = String(body.clinrecCodeVersion ?? "").trim();
      if (cv && !/^\d+_\d+$/.test(cv)) {
        return NextResponse.json(
          { error: "Некорректный формат кода КР Минздрава (например, 286_3)" },
          { status: 400 },
        );
      }
      data.clinrecCodeVersion = cv.slice(0, 20);
    }
    if (body.clinrecName !== undefined) {
      data.clinrecName = String(body.clinrecName).slice(0, 300);
    }
    if (body.clinrecMkb !== undefined) {
      data.clinrecMkb = String(body.clinrecMkb).slice(0, 200);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    const updated = await db.examination.update({
      where: { id },
      data,
      include: {
        orderedBy: { select: { fullName: true } },
        performedBy: { select: { fullName: true } },
        visit: { select: { scheduledAt: true, visitType: true } },
      },
    });

    await appendAudit({
      doctorId: session.doctorId,
      action: "patient.examination.update",
      details: JSON.stringify({
        examinationId: id,
        patientId: existing.patientId,
        fields: Object.keys(data),
        statusFrom: existing.status,
        statusTo: updated.status,
      }),
    }).catch(() => {});

    return NextResponse.json({
      examination: {
        ...updated,
        orderedAt: updated.orderedAt.toISOString(),
        scheduledAt: updated.scheduledAt?.toISOString() ?? null,
        completedAt: updated.completedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        orderedByName: updated.orderedBy?.fullName ?? null,
        performedByName: updated.performedBy?.fullName ?? null,
      },
    });
  } catch (e) {
    logger.error("examinations", "Update failed", {
      id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Не удалось обновить обследование", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
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

  // Удалять записи может только администратор или заведующий отделением
  if (session.role !== "admin" && session.role !== "head") {
    return NextResponse.json(
      { error: "Удаление обследований доступно только администратору или заведующему" },
      { status: 403 },
    );
  }

  try {
    const existing = await db.examination.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Обследование не найдено" }, { status: 404 });
    }

    // SECURITY (v4.3 audit fix): even admin/head must have access to the
    // patient who owns this examination (defense-in-depth against IDOR).
    const access = await requirePatientAccess(req, existing.patientId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    await db.examination.delete({ where: { id } });

    await appendAudit({
      doctorId: session.doctorId,
      action: "patient.examination.delete",
      details: JSON.stringify({
        examinationId: id,
        patientId: existing.patientId,
        name: existing.name,
      }),
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error("examinations", "Delete failed", {
      id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Не удалось удалить обследование", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
