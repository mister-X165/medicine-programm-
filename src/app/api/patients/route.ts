// СППВР v2.6.0 — Patients API (EMR) + E2EE
// GET  /api/patients — список пациентов (по сфере врача)
// POST /api/patients — создание пациента
//
// E2EE: прямые идентификаторы приходят КАК ШИФРОТЕКСТ ("enc:v1:…") из
// браузера. Сервер валидирует формат шифротекста, но не может расшифровать.
// Поиск по ФИО/СНИЛС выполняется на клиенте ПОСЛЕ расшифровки.
// birthYear — открытое поле для возрастной аналитики (аналогично Case).

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSessionFromRequest } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { activeGrantWhere } from "@/lib/patient-access";

export const dynamic = "force-dynamic";

// ----------------------------------------------------------------------------
// Валидация (Zod v4) — закрывает mass-assignment и инъекции типов
// ----------------------------------------------------------------------------

const ENC_FIELD = z
  .string()
  .max(8192)
  .refine((v) => v === "" || v.startsWith("enc:v1:"), {
    message: "Поле должно быть шифротекстом enc:v1: (E2EE)",
  });

const createPatientSchema = z.object({
  patientToken: z.string().max(32).regex(/^[А-Яа-яA-Za-z0-9\-]+$/).optional(),
  lastName: ENC_FIELD.default(""),
  firstName: ENC_FIELD.default(""),
  middleName: ENC_FIELD.default(""),
  birthDate: ENC_FIELD.nullable().default(null), // enc:v1:… или null
  birthYear: z.number().int().min(1850).max(2100).nullable().optional(),
  sex: z.enum(["М", "Ж", ""]).default(""),
  bloodType: z.string().max(16).default(""),
  phone: ENC_FIELD.default(""),
  email: ENC_FIELD.default(""),
  address: ENC_FIELD.default(""),
  snils: ENC_FIELD.default(""),
  omiPolicy: ENC_FIELD.default(""),
  insuranceNumber: ENC_FIELD.default(""),
  nationality: ENC_FIELD.default(""),
  occupation: ENC_FIELD.default(""),
  smokingStatus: z.enum(["never", "former", "current", "unknown"]).default("unknown"),
  alcoholUse: z.enum(["none", "occasional", "moderate", "heavy", "unknown"]).default("unknown"),
  allergies: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  chronicDiseases: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  familyHistory: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  height: z.number().min(0).max(300).default(0),
  weight: z.number().min(0).max(1000).default(0),
  notes: ENC_FIELD.default(""),
  primaryDoctorId: z.string().max(64).optional(),
  // v2.7: пер-пациентный DEK, завёрнутый master-DEK владельца (enc:v1:…).
  // Генерируется в браузере при создании карты — сервер видит только шифротекст.
  wrappedPdek: z.string().max(8192).refine((v) => v.startsWith("enc:v1:"), {
    message: "wrappedPdek должен быть шифротекстом enc:v1:",
  }).optional(),
});

function safeParseArr(raw: string | null | undefined, fallback: unknown[] = []) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// Возраст по году рождения (открытое поле); точный возраст считает клиент
// после расшифровки полной даты.
function calcAgeFromYear(birthYear: number | null | undefined): number | null {
  if (!birthYear || birthYear < 1850) return null;
  return new Date().getFullYear() - birthYear;
}

export async function GET(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status") || "all";

  const where: Record<string, unknown> = {};
  if (session.role !== "admin") {
    // v2.7: в сферу врача входят: свои пациенты, пациенты его Case'ов
    // и карты, доступ к которым передан ему через активный (не истёкший) grant.
    where.OR = [
      { primaryDoctorId: session.doctorId },
      { cases: { some: { doctorId: session.doctorId } } },
      { accessGrants: { some: activeGrantWhere(session.doctorId) } },
    ];
  }
  if (status !== "all") where.status = status;
  // E2EE: поиск по ФИО/СНИЛС невозможен на сервере (шифротекст) —
  // фильтрация выполняется на клиенте. Ищем только по псевдониму.
  if (q) {
    where.patientToken = { contains: q };
  }

  const patients = await db.patient.findMany({
    where,
    include: {
      primaryDoctor: { select: { id: true, fullName: true, specialization: true } },
      // v2.7: активный (не истёкший) grant для текущего врача (переданная карта)
      accessGrants: {
        where: activeGrantWhere(session.doctorId),
        select: {
          wrappedPdek: true,
          grantorWrapPub: true,
          grantorDoctorId: true,
          createdAt: true,
          expiresAt: true,
          grantor: { select: { fullName: true, doctorCode: true } },
        },
      },
      _count: {
        select: { visits: true, cases: true, medications: true, problems: true, labResults: true, vitalSigns: true, immunizations: true, accessGrants: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const result = patients.map((p) => {
    // v2.7 — крипто-мета для маршрутизации PDEK на клиенте:
    const isOwner = p.primaryDoctorId === session.doctorId;
    const myGrant = p.accessGrants[0];
    const accessRole = isOwner ? "owner" : myGrant ? "granted" : "observer";
    return {
      id: p.id,
      patientToken: p.patientToken,
      lastName: p.lastName,
      firstName: p.firstName,
      middleName: p.middleName,
      birthDate: p.birthDate, // enc:v1:… — расшифрует клиент
      birthYear: p.birthYear,
      age: calcAgeFromYear(p.birthYear), // приблизительный (по году)
      sex: p.sex,
      bloodType: p.bloodType,
      phone: p.phone, // enc:v1:…
      email: p.email, // enc:v1:…
      address: p.address, // enc:v1:… (v2.6.1: добавлено для легаси-миграции)
      snils: p.snils, // enc:v1:…
      omiPolicy: p.omiPolicy, // enc:v1:…
      insuranceNumber: p.insuranceNumber, // enc:v1:… (v2.6.1)
      nationality: p.nationality, // enc:v1:… (v2.6.1)
      occupation: p.occupation, // enc:v1:…
      smokingStatus: p.smokingStatus,
      alcoholUse: p.alcoholUse,
      allergies: safeParseArr(p.allergies),
      chronicDiseases: safeParseArr(p.chronicDiseases),
      familyHistory: safeParseArr(p.familyHistory),
      height: p.height,
      weight: p.weight,
      notes: p.notes, // enc:v1:… (v2.6.1)
      status: p.status,
      primaryDoctor: p.primaryDoctor,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      _count: p._count,
      // v2.7 крипто-мета (zero-knowledge: только шифротекст и публичные ключи)
      accessRole,
      wrappedPdek: isOwner ? p.wrappedPdek : null, // расшифрует только владелец
      myGrant: myGrant
        ? {
            wrappedPdek: myGrant.wrappedPdek,
            grantorWrapPub: myGrant.grantorWrapPub,
            grantorName: myGrant.grantor.fullName,
            grantorCode: myGrant.grantor.doctorCode,
            grantedAt: myGrant.createdAt.toISOString(),
            expiresAt: myGrant.expiresAt ? myGrant.expiresAt.toISOString() : null,
          }
        : null,
    };
  });

  return NextResponse.json({ patients: result, count: result.length });
}

export async function POST(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const raw = await req.json();
    const parsed = createPatientSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Некорректные данные пациента", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const year = new Date().getFullYear();
    const count = await db.patient.count();
    const patientToken = body.patientToken || `П-${year}-${String(count + 1).padStart(4, "0")}`;

    // birthYear: приоритет — явное поле (клиент вычислил до шифрования даты)
    const birthYear =
      body.birthYear ??
      (typeof body.birthDate === "string" && /^\d{4}/.test(body.birthDate)
        ? Number(body.birthDate.slice(0, 4))
        : null);

    const data: Record<string, unknown> = {
      patientToken,
      lastName: body.lastName,
      firstName: body.firstName,
      middleName: body.middleName,
      sex: body.sex,
      birthDate: body.birthDate,
      birthYear,
      bloodType: body.bloodType,
      phone: body.phone,
      email: body.email,
      address: body.address,
      snils: body.snils,
      omiPolicy: body.omiPolicy,
      insuranceNumber: body.insuranceNumber,
      nationality: body.nationality,
      occupation: body.occupation,
      smokingStatus: body.smokingStatus,
      alcoholUse: body.alcoholUse,
      allergies: JSON.stringify(body.allergies),
      chronicDiseases: JSON.stringify(body.chronicDiseases),
      familyHistory: JSON.stringify(body.familyHistory),
      height: body.height,
      weight: body.weight,
      notes: body.notes,
      primaryDoctorId: body.primaryDoctorId || session.doctorId,
      // v2.7: PDEK карты, завёрнутый master-DEK создателя (enc:v1:…)
      wrappedPdek: body.wrappedPdek ?? null,
    };

    const patient = await db.patient.create({ data: data as import("@prisma/client").Prisma.PatientUncheckedCreateInput });

    await appendAudit({
      action: "patient.create",
      details: { patientId: patient.id, patientToken: patient.patientToken, e2ee: true },
      doctorId: session.doctorId,
    });

    logger.info("patients", "Patient created", { patientId: patient.id, patientToken });

    return NextResponse.json({ patient }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("patients", "Failed to create patient", { error: msg });
    // Санитизация: наружу только общий текст (без деталей Prisma)
    return NextResponse.json({ error: "Не удалось создать карту пациента" }, { status: 500 });
  }
}
