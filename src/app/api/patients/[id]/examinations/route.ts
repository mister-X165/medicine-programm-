// СППВР v4.1 — API раздела «Обследования» медицинской карты
// GET  /api/patients/[id]/examinations?status=&type=&limit=
//   Список обследований пациента (с фильтрами по статусу и типу).
// POST /api/patients/[id]/examinations
//   Регистрация нового обследования, назначенного пациенту.
//   Body: { name, examType, modality?, code?, priority?, indication?, icd10?,
//           visitId?, caseId?, scheduledAt?, performedAt?, orderedById?,
//           clinrecCodeVersion?, clinrecName?, clinrecMkb?, notes? }

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { requirePatientAccess } from "@/lib/patient-access";
import { appendAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const EXAM_TYPES = new Set([
  "laboratory", "instrumental", "consultation", "functional",
  "radiology", "endoscopy", "morphological", "other",
]);
const EXAM_STATUSES = new Set([
  "ordered", "scheduled", "in_progress", "completed", "cancelled",
]);
const PRIORITIES = new Set(["routine", "urgent", "stat"]);

function serialize(e: {
  id: string; patientId: string; visitId: string | null; caseId: string | null;
  name: string; examType: string; modality: string; code: string;
  status: string; priority: string; indication: string; icd10: string;
  orderedAt: Date; scheduledAt: Date | null; completedAt: Date | null;
  performedAt: string; orderedById: string | null; performedById: string | null;
  resultValue: string; resultData: string; interpretation: string;
  conclusion: string; isAbnormal: boolean;
  clinrecCodeVersion: string; clinrecName: string; clinrecMkb: string;
  attachments: string; notes: string; createdAt: Date; updatedAt: Date;
  orderedBy?: { fullName: string } | null;
  performedBy?: { fullName: string } | null;
  visit?: { scheduledAt: Date; visitType: string } | null;
}) {
  return {
    id: e.id,
    patientId: e.patientId,
    visitId: e.visitId,
    caseId: e.caseId,
    name: e.name,
    examType: e.examType,
    modality: e.modality,
    code: e.code,
    status: e.status,
    priority: e.priority,
    indication: e.indication,
    icd10: e.icd10,
    orderedAt: e.orderedAt.toISOString(),
    scheduledAt: e.scheduledAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    performedAt: e.performedAt,
    orderedById: e.orderedById,
    performedById: e.performedById,
    resultValue: e.resultValue,
    resultData: e.resultData,
    interpretation: e.interpretation,
    conclusion: e.conclusion,
    isAbnormal: e.isAbnormal,
    clinrecCodeVersion: e.clinrecCodeVersion,
    clinrecName: e.clinrecName,
    clinrecMkb: e.clinrecMkb,
    attachments: e.attachments,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    orderedByName: e.orderedBy?.fullName ?? null,
    performedByName: e.performedBy?.fullName ?? null,
    visitInfo: e.visit ? { scheduledAt: e.visit.scheduledAt.toISOString(), visitType: e.visit.visitType } : null,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requirePatientAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const session = access.session!;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const examType = url.searchParams.get("type");
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200);

  try {
    const patient = await db.patient.findUnique({ where: { id }, select: { id: true } });
    if (!patient) {
      return NextResponse.json({ error: "Пациент не найден" }, { status: 404 });
    }

    const examinations = await db.examination.findMany({
      where: {
        patientId: id,
        ...(status && EXAM_STATUSES.has(status) ? { status } : {}),
        ...(examType && EXAM_TYPES.has(examType) ? { examType } : {}),
      },
      include: {
        orderedBy: { select: { fullName: true } },
        performedBy: { select: { fullName: true } },
        visit: { select: { scheduledAt: true, visitType: true } },
      },
      orderBy: [{ orderedAt: "desc" }],
      take: limit,
    });

    // Статистика по обследованиям
    const now = new Date();
    const stats = {
      total: examinations.length,
      ordered: examinations.filter((e) => e.status === "ordered").length,
      scheduled: examinations.filter((e) => e.status === "scheduled").length,
      inProgress: examinations.filter((e) => e.status === "in_progress").length,
      completed: examinations.filter((e) => e.status === "completed").length,
      cancelled: examinations.filter((e) => e.status === "cancelled").length,
      abnormal: examinations.filter((e) => e.isAbnormal).length,
      overdue: examinations.filter(
        (e) =>
          (e.status === "ordered" || e.status === "scheduled") &&
          e.scheduledAt != null &&
          e.scheduledAt < now,
      ).length,
      urgent: examinations.filter(
        (e) => e.priority !== "routine" && e.status !== "completed" && e.status !== "cancelled",
      ).length,
    };

    return NextResponse.json({
      examinations: examinations.map(serialize),
      stats,
    });
  } catch (e) {
    logger.error("examinations", "List failed", {
      patientId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Не удалось загрузить обследования", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requirePatientAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const session = access.session!;

  try {
    const patient = await db.patient.findUnique({ where: { id }, select: { id: true, patientToken: true } });
    if (!patient) {
      return NextResponse.json({ error: "Пациент не найден" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

    // Валидация обязательных полей
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Название обследования обязательно" }, { status: 400 });
    }
    const examType = EXAM_TYPES.has(body.examType) ? body.examType : "laboratory";
    const priority = PRIORITIES.has(body.priority) ? body.priority : "routine";

    // Если указана плановая дата — статус «запланировано»
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const validScheduled = scheduledAt && !isNaN(scheduledAt.getTime()) ? scheduledAt : null;
    const status = body.status && EXAM_STATUSES.has(body.status)
      ? body.status
      : validScheduled
        ? "scheduled"
        : "ordered";

    // Валидация связи с официальной КР Минздрава
    const clinrecCodeVersion = String(body.clinrecCodeVersion ?? "").trim();
    if (clinrecCodeVersion && !/^\d+_\d+$/.test(clinrecCodeVersion)) {
      return NextResponse.json(
        { error: "Некорректный формат кода КР Минздрава (ожидается, например, 286_3)" },
        { status: 400 },
      );
    }

    // Валидация visitId/caseId (если указаны — должны существовать и принадлежать пациенту)
    let visitId: string | null = null;
    if (body.visitId) {
      const visit = await db.visit.findFirst({
        where: { id: body.visitId, patientId: id },
        select: { id: true },
      });
      if (!visit) {
        return NextResponse.json({ error: "Указанный визит не найден у пациента" }, { status: 400 });
      }
      visitId = visit.id;
    }
    let caseId: string | null = null;
    if (body.caseId) {
      const foundCase = await db.case.findFirst({
        where: { id: body.caseId, patientId: id },
        select: { id: true },
      });
      if (!foundCase) {
        return NextResponse.json({ error: "Указанный кейс не найден у пациента" }, { status: 400 });
      }
      caseId = foundCase.id;
    }

    const examination = await db.examination.create({
      data: {
        patientId: id,
        visitId,
        caseId,
        name: name.slice(0, 300),
        examType,
        modality: String(body.modality ?? "").slice(0, 100),
        code: String(body.code ?? "").slice(0, 50),
        status,
        priority,
        indication: String(body.indication ?? "").slice(0, 500),
        icd10: String(body.icd10 ?? "").slice(0, 20).toUpperCase(),
        scheduledAt: validScheduled,
        performedAt: String(body.performedAt ?? "").slice(0, 200),
        orderedById: session.doctorId ?? null,
        clinrecCodeVersion: clinrecCodeVersion.slice(0, 20),
        clinrecName: String(body.clinrecName ?? "").slice(0, 300),
        clinrecMkb: String(body.clinrecMkb ?? "").slice(0, 200),
        notes: String(body.notes ?? "").slice(0, 2000),
      },
      include: {
        orderedBy: { select: { fullName: true } },
        performedBy: { select: { fullName: true } },
        visit: { select: { scheduledAt: true, visitType: true } },
      },
    });

    await appendAudit({
      caseId: null,
      doctorId: session.doctorId,
      action: "patient.examination.add",
      details: JSON.stringify({
        patientId: id,
        examinationId: examination.id,
        name: examination.name,
        examType,
        priority,
        clinrecCodeVersion: clinrecCodeVersion || null,
      }),
    }).catch(() => {});

    logger.info("examinations", "Examination created", {
      patientId: id,
      examinationId: examination.id,
      name: examination.name,
    });

    return NextResponse.json({ examination: serialize(examination) }, { status: 201 });
  } catch (e) {
    logger.error("examinations", "Create failed", {
      patientId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Не удалось создать обследование", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
