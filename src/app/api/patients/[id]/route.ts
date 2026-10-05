// СППВР v2.6.0 — Patient detail API + E2EE + IDOR fix
// GET    /api/patients/[id] — полная карта (шифротекст полей расшифрует клиент)
// PATCH  /api/patients/[id] — обновление (шифротекст passthrough)
// DELETE /api/patients/[id] — архивирование (soft delete)

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { activeGrantWhere, requirePatientAccess } from "@/lib/patient-access";
import { appendAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ENC_FIELD = z
  .string()
  .max(8192)
  .refine((v) => v === "" || v.startsWith("enc:v1:"), {
    message: "Поле должно быть шифротекстом enc:v1: (E2EE)",
  });

const updatePatientSchema = z
  .object({
    lastName: ENC_FIELD.optional(),
    firstName: ENC_FIELD.optional(),
    middleName: ENC_FIELD.optional(),
    birthDate: ENC_FIELD.nullable().optional(),
    birthYear: z.number().int().min(1850).max(2100).nullable().optional(),
    sex: z.enum(["М", "Ж", ""]).optional(),
    bloodType: z.string().max(16).optional(),
    phone: ENC_FIELD.optional(),
    email: ENC_FIELD.optional(),
    address: ENC_FIELD.optional(),
    snils: ENC_FIELD.optional(),
    omiPolicy: ENC_FIELD.optional(),
    insuranceNumber: ENC_FIELD.optional(),
    nationality: ENC_FIELD.optional(),
    occupation: ENC_FIELD.optional(),
    notes: ENC_FIELD.optional(),
    smokingStatus: z.enum(["never", "former", "current", "unknown"]).optional(),
    alcoholUse: z.enum(["none", "occasional", "moderate", "heavy", "unknown"]).optional(),
    height: z.number().min(0).max(300).optional(),
    weight: z.number().min(0).max(1000).optional(),
    status: z.enum(["active", "archived", "deceased"]).optional(),
    allergies: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    chronicDiseases: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    familyHistory: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    primaryDoctorId: z.string().max(64).optional(),
    // v2.7: PDEK карты, завёрнутый master-DEK владельца — устанавливается
    // при фоновом переводе легаси-карты на пер-пациентный ключ.
    wrappedPdek: z
      .string()
      .max(8192)
      .refine((v) => v.startsWith("enc:v1:"), {
        message: "wrappedPdek должен быть шифротекстом enc:v1:",
      })
      .optional(),
  })
  .strict(); // unknown fields отклоняются (mass-assignment guard)

function safeParseArr(raw: string | null | undefined, fallback: unknown[] = []) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
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

  const patient = await db.patient.findUnique({
    where: { id },
    include: {
      primaryDoctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
      // v2.7: активный (не истёкший) grant текущего врача (переданная карта)
      accessGrants: {
        where: activeGrantWhere(access.session!.doctorId),
        select: {
          wrappedPdek: true,
          grantorWrapPub: true,
          createdAt: true,
          expiresAt: true,
          grantor: { select: { fullName: true, doctorCode: true } },
        },
      },
      visits: {
        include: { doctor: { select: { id: true, fullName: true, specialization: true } } },
        orderBy: { scheduledAt: "desc" },
        take: 50,
      },
      vitalSigns: { orderBy: { recordedAt: "desc" }, take: 100 },
      medications: { orderBy: { startDate: "desc" }, take: 100 },
      immunizations: { orderBy: { administeredAt: "desc" }, take: 50 },
      labResults: { orderBy: { collectedAt: "desc" }, take: 200 },
      problems: { orderBy: { createdAt: "desc" } },
      carePlans: { orderBy: { createdAt: "desc" } },
      examinations: {
        include: {
          orderedBy: { select: { fullName: true } },
          performedBy: { select: { fullName: true } },
        },
        orderBy: { orderedAt: "desc" },
        take: 200,
      },
      cases: {
        select: { id: true, caseCode: true, status: true, diagnosisHint: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  // v2.7 — крипто-мета для маршрутизации PDEK на клиенте
  const isOwner = patient.primaryDoctorId === access.session!.doctorId;
  const myGrant = patient.accessGrants[0];
  const accessRole = isOwner ? "owner" : myGrant ? "granted" : "observer";
  const { accessGrants: _g, ...patientRest } = patient;

  const result = {
    ...patientRest,
    birthDate: patient.birthDate, // enc:v1:… — расшифрует клиент
    allergies: safeParseArr(patient.allergies),
    chronicDiseases: safeParseArr(patient.chronicDiseases),
    familyHistory: safeParseArr(patient.familyHistory),
    deathDate: patient.deathDate?.toISOString() ?? null,
    visits: patient.visits.map((v) => ({
      ...v,
      scheduledAt: v.scheduledAt.toISOString(),
      startedAt: v.startedAt?.toISOString() ?? null,
      completedAt: v.completedAt?.toISOString() ?? null,
      diagnosis: safeParseArr(v.diagnosis),
      prescriptions: safeParseArr(v.prescriptions),
    })),
    vitalSigns: patient.vitalSigns.map((v) => ({
      ...v, recordedAt: v.recordedAt.toISOString(),
    })),
    medications: patient.medications.map((m) => ({
      ...m, startDate: m.startDate.toISOString(), endDate: m.endDate?.toISOString() ?? null,
    })),
    immunizations: patient.immunizations.map((i) => ({
      ...i, administeredAt: i.administeredAt.toISOString(), nextDoseDate: i.nextDoseDate?.toISOString() ?? null,
    })),
    labResults: patient.labResults.map((l) => ({
      ...l, collectedAt: l.collectedAt.toISOString(), resultedAt: l.resultedAt?.toISOString() ?? null,
    })),
    problems: patient.problems.map((p) => ({
      ...p, onsetDate: p.onsetDate?.toISOString() ?? null, resolvedDate: p.resolvedDate?.toISOString() ?? null,
    })),
    carePlans: patient.carePlans.map((c) => ({
      ...c,
      startDate: c.startDate.toISOString(), endDate: c.endDate?.toISOString() ?? null,
      goals: safeParseArr(c.goals), interventions: safeParseArr(c.interventions),
    })),
    examinations: patient.examinations.map((e) => ({
      ...e,
      orderedAt: e.orderedAt.toISOString(),
      scheduledAt: e.scheduledAt?.toISOString() ?? null,
      completedAt: e.completedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      resultData: safeParseArr(e.resultData),
      attachments: safeParseArr(e.attachments),
      orderedByName: e.orderedBy?.fullName ?? null,
      performedByName: e.performedBy?.fullName ?? null,
    })),
    cases: patient.cases.map((c) => ({
      ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    })),
    // v2.7 крипто-мета (zero-knowledge: только шифротекст и публичные ключи)
    accessRole,
    wrappedPdek: isOwner ? patient.wrappedPdek : null,
    myGrant: myGrant
      ? {
          wrappedPdek: myGrant.wrappedPdek,
          grantorWrapPub: myGrant.grantorWrapPub,
          grantorName: myGrant.grantor.fullName,
          grantorCode: myGrant.grantor.doctorCode,
          grantedAt: myGrant.createdAt.toISOString(),
        }
      : null,
  };

  return NextResponse.json({ patient: result });
}

export async function PATCH(
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
    const raw = await req.json();
    const parsed = updatePatientSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Некорректные данные", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const data: Record<string, unknown> = {};
    const assign = (k: string, v: unknown) => {
      if (v !== undefined) data[k] = v;
    };
    assign("lastName", body.lastName);
    assign("firstName", body.firstName);
    assign("middleName", body.middleName);
    assign("birthDate", body.birthDate);
    assign("birthYear", body.birthYear);
    assign("sex", body.sex);
    assign("bloodType", body.bloodType);
    assign("phone", body.phone);
    assign("email", body.email);
    assign("address", body.address);
    assign("snils", body.snils);
    assign("omiPolicy", body.omiPolicy);
    assign("insuranceNumber", body.insuranceNumber);
    assign("nationality", body.nationality);
    assign("occupation", body.occupation);
    assign("notes", body.notes);
    assign("smokingStatus", body.smokingStatus);
    assign("alcoholUse", body.alcoholUse);
    assign("height", body.height);
    assign("weight", body.weight);
    assign("status", body.status);
    if (body.allergies !== undefined) data.allergies = JSON.stringify(body.allergies);
    if (body.chronicDiseases !== undefined) data.chronicDiseases = JSON.stringify(body.chronicDiseases);
    if (body.familyHistory !== undefined) data.familyHistory = JSON.stringify(body.familyHistory);
    if (body.primaryDoctorId !== undefined) data.primaryDoctorId = body.primaryDoctorId;

    // v2.7: PDEK устанавливает ТОЛЬКО владелец (миграция легаси-карты);
    // чужой врач не может подменить ключ карты.
    if (body.wrappedPdek !== undefined) {
      const pdekOwner = await db.patient.findUnique({
        where: { id },
        select: { primaryDoctorId: true },
      });
      if (!pdekOwner || pdekOwner.primaryDoctorId !== session.doctorId) {
        return NextResponse.json(
          { error: "PDEK карты может установить только владелец" },
          { status: 403 },
        );
      }
      data.wrappedPdek = body.wrappedPdek;
    }

    const patient = await db.patient.update({ where: { id }, data });

    await appendAudit({
      action: "patient.update",
      details: { patientId: id, fields: Object.keys(data) },
      doctorId: session.doctorId,
    });

    return NextResponse.json({ patient });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to update patient", { error: msg, patientId: id });
    return NextResponse.json({ error: "Не удалось обновить карту пациента" }, { status: 500 });
  }
}

export async function DELETE(
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
    // Soft delete — архивирование (сохранение мед. записей для комплаенса)
    const patient = await db.patient.update({
      where: { id },
      data: { status: "archived" },
    });

    await appendAudit({
      action: "patient.archive",
      details: { patientId: id, patientToken: patient.patientToken },
      doctorId: session.doctorId,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to archive patient", { error: msg, patientId: id });
    return NextResponse.json({ error: "Не удалось архивировать пациента" }, { status: 500 });
  }
}
