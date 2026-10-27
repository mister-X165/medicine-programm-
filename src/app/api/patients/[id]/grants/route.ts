// ============================================================================
// СППВР v2.7 — Передача доступа к карте пациента (PatientAccessGrant API)
// ============================================================================
// GET    /api/patients/[id]/grants — список grant'ов карты (для владельца:
//                                  управление доступом, отзыв)
// POST   /api/patients/[id]/grants — передача доступа: PDEK уже пере-завёрнут
//                                  под X25519-ключ получателя В БРАУЗЕРЕ
//                                  владельца. body: { granteeDoctorId,
//                                    wrappedPdek: enc:v1:…, grantorWrapPub }
// DELETE /api/patients/[id]/grants?granteeDoctorId=… — мгновенный отзыв.
//
// SECURITY: сервер хранит ТОЛЬКО шифротекст enc:v1:… (PDEK под общим
// ECDH-ключом передающего и получающего). Ни PDEK, ни master-DEK, ни
// приватные X25519 никогда не попадают на сервер. Отзыв — мгновенный
// (status=revoked), защита от гонки: повторная выдача = upsert.
// ============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import { requirePatientAccess, expireStaleGrants } from "@/lib/patient-access";

export const dynamic = "force-dynamic";

const ENC_FIELD_RE = /^enc:v1:[A-Za-z0-9_-]+$/;
const WRAP_PUB_RE = /^[A-Za-z0-9+/]{43}=?$/; // base64(32 байта)

// TTL: 1 час … 1 год (8760 ч). null / отсутствует — бессрочно.
const MAX_TTL_HOURS = 24 * 365;

const grantSchema = z.object({
  granteeDoctorId: z.string().min(1).max(64),
  wrappedPdek: z.string().max(8192).refine((v) => ENC_FIELD_RE.test(v), {
    message: "wrappedPdek должен быть шифротекстом enc:v1:…",
  }),
  grantorWrapPub: z.string().max(64).refine((v) => WRAP_PUB_RE.test(v), {
    message: "grantorWrapPub должен быть base64(32 байта) X25519",
  }),
  ttlHours: z
    .number()
    .int()
    .min(1)
    .max(MAX_TTL_HOURS)
    .optional()
    .nullable(),
});

// ----------------------------------------------------------------------------
// GET — активные grant'ы карты (владелец/админ)
// ----------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const access = await requirePatientAccess(req, patientId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // v2.7.1: ленивая экспирация истёкших TTL-grant'ов (до выборки)
  await expireStaleGrants(patientId);

  const grants = await db.patientAccessGrant.findMany({
    where: { patientId, status: "active" },
    select: {
      granteeDoctorId: true,
      createdAt: true,
      expiresAt: true,
      grantee: { select: { fullName: true, doctorCode: true, specialization: true, isActive: true } },
      grantor: { select: { fullName: true, doctorCode: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const result = grants
    .filter((g) => !g.expiresAt || g.expiresAt.getTime() > now)
    .map((g) => ({
      granteeDoctorId: g.granteeDoctorId,
      granteeName: g.grantee.fullName,
      granteeCode: g.grantee.doctorCode,
      granteeSpecialization: g.grantee.specialization,
      granteeActive: g.grantee.isActive,
      grantedBy: g.grantor.doctorCode,
      grantedByName: g.grantor.fullName,
      grantedAt: g.createdAt.toISOString(),
      expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
      status: "active",
    }));

  return NextResponse.json({ grants: result });
}

// ----------------------------------------------------------------------------
// POST — передача доступа (владелец карты или админ-супервайзер)
// ----------------------------------------------------------------------------

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const access = await requirePatientAccess(req, patientId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = grantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Некорректные данные grant'а",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const patient = await db.patient.findUnique({
      where: { id: patientId },
      select: { patientToken: true, primaryDoctorId: true, wrappedPdek: true },
    });
    if (!patient) {
      return NextResponse.json({ error: "Пациент не найден" }, { status: 404 });
    }

    // Только владелец может передавать доступ (админ видит шифротекст,
    // но не владеет ключом — передача от админа физически невозможна
    // без PDEK; это ограничение zero-knowledge архитектуры).
    if (patient.primaryDoctorId !== access.session!.doctorId && access.session!.role !== "admin") {
      return NextResponse.json(
        { error: "Передавать доступ может только владелец карты" },
        { status: 403 },
      );
    }

    // Грант без PDEK у карты (легаси) — бессмысленен: ключ не передать
    if (!patient.wrappedPdek) {
      return NextResponse.json(
        {
          error:
            "Карта ещё не переведена на пер-пациентный ключ (PDEK). Откройте карту для автоматической миграции и повторите.",
        },
        { status: 409 },
      );
    }

    const grantee = await db.doctor.findUnique({
      where: { id: parsed.data.granteeDoctorId },
      select: { id: true, fullName: true, doctorCode: true, isActive: true, keyMaterial: { select: { wrapPubKey: true } } },
    });
    if (!grantee || !grantee.isActive) {
      return NextResponse.json({ error: "Врач-получатель не найден или деактивирован" }, { status: 404 });
    }
    if (!grantee.keyMaterial?.wrapPubKey) {
      return NextResponse.json(
        {
          error:
            "У врача-получателя ещё нет X25519-ключа (нужно войти в систему после v2.7). Передача невозможна.",
        },
        { status: 409 },
      );
    }
    if (grantee.id === patient.primaryDoctorId) {
      return NextResponse.json({ error: "Получатель уже является владельцем карты" }, { status: 409 });
    }

    // Upsert: повторная передача тому же врачу обновляет блоб
    // (гонка с отзывом исключена — атомарный upsert)
    const expiresAt = parsed.data.ttlHours
      ? new Date(Date.now() + parsed.data.ttlHours * 3600_000)
      : null;
    const grant = await db.patientAccessGrant.upsert({
      where: {
        patientId_granteeDoctorId: {
          patientId,
          granteeDoctorId: grantee.id,
        },
      },
      create: {
        patientId,
        grantorDoctorId: access.session!.doctorId,
        granteeDoctorId: grantee.id,
        wrappedPdek: parsed.data.wrappedPdek,
        grantorWrapPub: parsed.data.grantorWrapPub,
        status: "active",
        expiresAt,
      },
      update: {
        grantorDoctorId: access.session!.doctorId,
        wrappedPdek: parsed.data.wrappedPdek,
        grantorWrapPub: parsed.data.grantorWrapPub,
        status: "active",
        expiresAt,
        revokedAt: null,
      },
    });

    await appendAudit({
      action: "patient.grant.create",
      details: {
        patientId,
        patientToken: patient.patientToken,
        granteeDoctorId: grantee.id,
        granteeCode: grantee.doctorCode,
        crypto: "x25519+hkdf-sha256+cascade",
        ttlHours: parsed.data.ttlHours ?? null,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
      doctorId: access.session!.doctorId,
    });
    logger.info("grants", "Patient access granted", {
      patientId,
      grantee: grantee.doctorCode,
      grantId: grant.id,
      ttlHours: parsed.data.ttlHours ?? null,
    });

    return NextResponse.json(
      {
        success: true,
        grant: { id: grant.id },
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("grants", "Failed to grant access", { error: msg, patientId });
    return NextResponse.json({ error: "Не удалось передать доступ" }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// DELETE — мгновенный отзыв доступа (владелец/админ)
// ----------------------------------------------------------------------------

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const access = await requirePatientAccess(req, patientId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const url = new URL(req.url);
  const granteeDoctorId = url.searchParams.get("granteeDoctorId")?.trim() || "";
  if (!granteeDoctorId) {
    return NextResponse.json({ error: "Требуется granteeDoctorId" }, { status: 400 });
  }

  const grant = await db.patientAccessGrant.findUnique({
    where: { patientId_granteeDoctorId: { patientId, granteeDoctorId } },
    select: { id: true, status: true, patient: { select: { patientToken: true } } },
  });
  if (!grant) {
    return NextResponse.json({ error: "Grant не найден" }, { status: 404 });
  }
  if (grant.status === "revoked") {
    return NextResponse.json({ success: true, alreadyRevoked: true });
  }

  await db.patientAccessGrant.update({
    where: { id: grant.id },
    data: { status: "revoked", revokedAt: new Date() },
  });

  await appendAudit({
    action: "patient.grant.revoke",
    details: {
      patientId,
      patientToken: grant.patient.patientToken,
      granteeDoctorId,
    },
    doctorId: access.session!.doctorId,
  });
  logger.info("grants", "Patient access revoked", { patientId, granteeDoctorId });

  return NextResponse.json({ success: true });
}
