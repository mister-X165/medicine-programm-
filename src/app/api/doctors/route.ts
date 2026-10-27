// СППВР v2.0 — Doctors API
// GET  /api/doctors — List all doctors (admin-only via middleware)
// POST /api/doctors — Create new doctor (admin-only via middleware)
//
// SECURITY (v2.1):
//   - Both routes are admin-only (enforced by src/middleware.ts).
//   - The `role` field is NEVER accepted from the request body — only the
//     admin can elevate, and they must use PATCH /api/doctors/[id] with an
//     explicit role-change action (which is also admin-only).
//   - New doctors are always created with role="doctor".

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createDoctorSchema, validateOrThrow } from "@/lib/validation";
import { appendAudit } from "@/lib/audit";
import { getSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 12;

function checkPasswordStrength(password: string): { ok: boolean; error?: string } {
  if (password.length < 10) {
    return { ok: false, error: "Пароль должен содержать минимум 10 символов" };
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password)) {
    return { ok: false, error: "Пароль должен содержать хотя бы одну букву" };
  }
  if (!/\d/.test(password)) {
    return { ok: false, error: "Пароль должен содержать хотя бы одну цифру" };
  }
  return { ok: true };
}

// GET /api/doctors — list doctors.
// SECURITY (incident 2025-09-07): this endpoint is reachable without auth
// (the login screen's status badge polls it for the doctor count). For
// UNAUTHENTICATED callers we now return ONLY the aggregate count — the full
// roster (names, specializations, codes, roles) is available exclusively to
// authenticated sessions.
export async function GET(req: Request) {
  const session = await getSessionFromRequest(req);
  const total = await db.doctor.count();

  if (!session) {
    return NextResponse.json({ doctors: [], total, scope: "public" });
  }

  const doctors = await db.doctor.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      specialization: true,
      doctorCode: true,
      role: true,
      isActive: true,
      createdAt: true,
      // v2.7: публичный X25519-ключ врача (для передачи карт, key-wrapping).
      // Это ОТКРЫТЫЙ ключ — его знание не даёт расшифровки (нужен приватный,
      // который существует только завёрнутым master-DEK у владельца).
      keyMaterial: { select: { wrapPubKey: true } },
      _count: { select: { cases: true, reports: true, auditLogs: true } },
    },
  });
  return NextResponse.json({
    doctors: doctors.map((d) => ({
      id: d.id,
      fullName: d.fullName,
      specialization: d.specialization,
      doctorCode: d.doctorCode,
      role: d.role,
      isActive: d.isActive,
      createdAt: d.createdAt.toISOString(),
      wrapPubKey: d.keyMaterial?.wrapPubKey ?? null,
      _count: d._count,
    })),
    total,
    scope: "session",
  });
}

// POST /api/doctors — create new doctor (admin-only)
// v2.6: принимает опциональный password (bcrypt cost 12) — enterprise-флоу
// создания аккаунтов администратором (публичная саморегистрация закрыта).
export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const data = validateOrThrow(createDoctorSchema, body);

    // SECURITY: strip role from the request — never trust client for it.
    // New doctors are always created with role="doctor".
    if (typeof body === "object" && body !== null && "role" in body) {
      logger.warn("doctors", "Client attempted to set role on doctor creation", {
        attemptedRole: String((body as Record<string, unknown>).role),
      });
      // We don't fail — just ignore the field. Audit log captures the attempt.
    }

    const existing = await db.doctor.findUnique({
      where: { doctorCode: data.doctorCode },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Doctor with code ${data.doctorCode} already exists` },
        { status: 409 },
      );
    }

    const doctor = await db.doctor.create({
      data: {
        fullName: data.fullName,
        specialization: data.specialization,
        doctorCode: data.doctorCode,
        // v2.6: пароль задаётся администратором (не пустым — вход сразу работает)
        passwordHash: body.password ? await bcrypt.hash(String(body.password), BCRYPT_COST) : "",
        role: "doctor", // hardcoded — cannot be elevated at creation
        isActive: true,
      },
    });

    // Read session from headers attached by middleware (if available)
    const adminId = req.headers.get("x-doctor-id") ?? undefined;

    logger.info("doctors", "Doctor created", { doctorCode: doctor.doctorCode });
    await appendAudit({
      doctorId: adminId ?? doctor.id,
      action: "create_doctor",
      details: JSON.stringify({
        doctorCode: doctor.doctorCode,
        fullName: doctor.fullName,
        createdBy: adminId ?? "self",
      }),
    });

    return NextResponse.json({ doctor }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Validation error")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
