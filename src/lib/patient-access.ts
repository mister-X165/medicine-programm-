// ============================================================================
// СППВР v2.6/v2.7 — Контроль доступа к записям пациентов (закрытие IDOR)
// ============================================================================
// До v2.6 маршруты /api/patients/[id]/* проверяли только сессию —
// ЛЮБОЙ аутентифицированный врач мог читать/изменять ЛЮБУЮ карту пациента
// по ID (IDOR). Теперь: доступ имеет только лечащий врач, администратор,
// врач, связанный с пациентом через Case, или врач с АКТИВНЫМ grant'ом
// (v2.7 — передача доступа с key-wrapping X25519).
//
// v2.7.1 — TTL grant'ов: активным считается только grant со status=active
// И (expiresAt IS NULL ИЛИ expiresAt > now). Истёкшие grant'ы лениво
// помечаются status=expired (+ аудит patient.grant.expire) при первом
// обращении — чтобы в журнале было видно, что доступ закончился сам.
// ============================================================================

import { db } from "@/lib/db";
import { getSessionFromRequest, type JWTPayload } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";

export interface PatientAccessResult {
  ok: boolean;
  status: number;
  error?: string;
  session: JWTPayload | null;
}

/**
 * v2.7.1 — общий фильтр АКТИВНОГО (не истёкшего) grant'а для Prisma-запросов.
 * Используется в requirePatientAccess, реестре пациентов, API grant'ов.
 */
export function activeGrantWhere(doctorId: string) {
  return {
    granteeDoctorId: doctorId,
    status: "active" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

/**
 * v2.7.1 — Ленивая экспирация: помечает истёкшие grant'ы status=expired.
 * Вызывается из точек чтения grant'ов (grants API, реестр) — без таймеров.
 * Аудит: patient.grant.expire на каждый истёкший grant.
 */
export async function expireStaleGrants(patientId?: string): Promise<number> {
  const now = new Date();
  const stale = await db.patientAccessGrant.findMany({
    where: {
      status: "active",
      expiresAt: { lt: now },
      ...(patientId ? { patientId } : {}),
    },
    select: { id: true, patientId: true, granteeDoctorId: true, patient: { select: { patientToken: true } } },
    take: 50,
  });
  if (stale.length === 0) return 0;

  await db.patientAccessGrant.updateMany({
    where: { id: { in: stale.map((g) => g.id) } },
    data: { status: "expired" },
  });

  for (const g of stale) {
    await appendAudit({
      action: "patient.grant.expire",
      details: {
        patientId: g.patientId,
        patientToken: g.patient.patientToken,
        granteeDoctorId: g.granteeDoctorId,
        reason: "ttl",
      },
    });
  }
  return stale.length;
}

/**
 * Проверяет доступ врача к пациенту:
 *   - admin: полный доступ (но PHI зашифрованы E2EE — видит только шифротекст)
 *   - лечащий врач (primaryDoctorId)
 *   - врач, ведущий Case этого пациента
 *   - v2.7: врач с активным PatientAccessGrant (переданная карта)
 */
export async function requirePatientAccess(
  req: Request,
  patientId: string,
): Promise<PatientAccessResult> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, status: 401, error: "Authentication required", session: null };
  }

  const patient = await db.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      patientToken: true,
      primaryDoctorId: true,
      cases: { select: { doctorId: true } },
      accessGrants: {
        where: activeGrantWhere(session.doctorId),
        select: { granteeDoctorId: true, expiresAt: true },
      },
    },
  });

  if (!patient) {
    return { ok: false, status: 404, error: "Patient not found", session };
  }

  if (session.role === "admin") {
    return { ok: true, status: 200, session };
  }

  const isPrimary = patient.primaryDoctorId === session.doctorId;
  const isCaseDoctor = patient.cases.some((c) => c.doctorId === session.doctorId);
  const isGranted = patient.accessGrants.some((g) => g.granteeDoctorId === session.doctorId);

  if (!isPrimary && !isCaseDoctor && !isGranted) {
    // Аудит попытки несанкционированного доступа (важно для расследований)
    await appendAudit({
      action: "patient.access.denied",
      details: {
        patientId,
        patientToken: patient.patientToken,
        reason: "not-owner",
      },
      doctorId: session.doctorId,
    });
    return {
      ok: false,
      status: 403,
      error: "Доступ к карте пациента запрещён",
      session,
    };
  }

  return { ok: true, status: 200, session };
}
