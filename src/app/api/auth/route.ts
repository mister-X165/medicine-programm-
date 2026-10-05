// СППВР v2.0 — Authentication API
// POST /api/auth?action=login     — Login with doctorCode + password (returns JWT)
// POST /api/auth?action=register  — Self-register a new doctor (returns JWT)
// POST /api/auth?action=set-password — Set/change password
// GET  /api/auth                  — Check session
//
// SECURITY (incident 2025-09-07 hardening):
//   - Account lockout: 5 failed logins → account locked for 15 minutes
//     (persisted in DB, survives restarts). Successful login resets counters.
//   - Generic error messages for failed logins (no user enumeration:
//     "unknown code" and "wrong password" are indistinguishable).
//   - Failed logins and lockouts are written to the audit log with the
//     caller's IP (x-real-ip / x-forwarded-for from the gateway).
//   - New passwords must be >= 10 chars and contain a letter and a digit.
//   - bcrypt cost raised 10 → 12.
//   - On success the JWT is ALSO set as an HttpOnly, SameSite=Strict cookie
//     (in addition to the response body token) so the edge proxy can
//     authenticate browser requests even if localStorage is unavailable.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { signToken, getSessionFromRequest, invalidateAccountCache } from "@/lib/auth";
import { loginSchema, validateOrThrow } from "@/lib/validation";
import { appendAudit } from "@/lib/audit";
import { REGISTRATION_OPEN, JWT_TTL_SECONDS } from "@/lib/env";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 12;

// ---------------------------------------------------------------------------
// Account lockout policy
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Per-IP registration throttle (in-memory; the edge proxy already limits
// /api/auth to 20 req/min/IP — this is a slower, longer budget for account
// creation spam).
// ---------------------------------------------------------------------------

const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 5 registrations per hour per IP

const registerBuckets = new Map<string, { count: number; resetAt: number }>();

function registerLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = registerBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    registerBuckets.set(ip, { count: 1, resetAt: now + REGISTER_WINDOW_MS });
    return false;
  }
  bucket.count++;
  return bucket.count > REGISTER_LIMIT;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

interface PasswordCheck {
  ok: boolean;
  error?: string;
}

function checkPasswordStrength(password: string): PasswordCheck {
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

/** Generic message for every failed credential check — prevents user
 *  enumeration (an attacker cannot distinguish "no such doctor" from
 *  "wrong password"). */
const INVALID_CREDENTIALS = "Неверный код врача или пароль";

function tokenCookie(maxAgeSeconds: number) {
  return {
    name: "token",
    value: "", // filled by caller
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// POST /api/auth — authentication and password management
export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "login";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ─── LOGIN ─────────────────────────────────────────────────────────────
  if (action === "login") {
    try {
      const { doctorCode, password } = validateOrThrow(loginSchema, body);
      const ip = clientIp(req);

      const doctor = await db.doctor.findUnique({
        where: { doctorCode },
      });

      // Generic 401 for both "not found" and "bad password" — no enumeration.
      if (!doctor) {
        await appendAudit({
          doctorId: undefined,
          action: "login_failed",
          details: JSON.stringify({ doctorCode, reason: "unknown_code", ip }),
        }).catch(() => {});
        return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
      }

      if (!doctor.isActive) {
        return NextResponse.json({ error: "Профиль деактивирован. Обратитесь к администратору." }, { status: 403 });
      }

      // Account lockout check (persisted in DB — survives restarts).
      if (doctor.lockedUntil && doctor.lockedUntil.getTime() > Date.now()) {
        const minutesLeft = Math.ceil((doctor.lockedUntil.getTime() - Date.now()) / 60000);
        return NextResponse.json(
          {
            error: `Аккаунт временно заблокирован после неудачных попыток входа. Повторите через ${minutesLeft} мин.`,
            code: "ACCOUNT_LOCKED",
          },
          { status: 423 },
        );
      }

      if (!doctor.passwordHash) {
        return NextResponse.json({ error: "Password not set. Set password first." }, { status: 403 });
      }

      const match = await bcrypt.compare(password, doctor.passwordHash);
      if (!match) {
        // Count the failure; lock the account after MAX_FAILED_ATTEMPTS.
        const attempts = (doctor.failedLoginAttempts || 0) + 1;
        const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
        await db.doctor.update({
          where: { id: doctor.id },
          data: {
            failedLoginAttempts: shouldLock ? 0 : attempts,
            lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
          },
        });

        await appendAudit({
          doctorId: doctor.id,
          action: shouldLock ? "account_locked" : "login_failed",
          details: JSON.stringify({
            doctorCode,
            reason: "bad_password",
            attempt: attempts,
            ip,
            lockoutMinutes: shouldLock ? LOCKOUT_DURATION_MS / 60000 : undefined,
          }),
        }).catch(() => {});

        if (shouldLock) {
          logger.warn("auth", "Account locked after repeated failed logins", { doctorCode, ip });
          return NextResponse.json(
            {
              error: `Слишком много неудачных попыток входа. Аккаунт заблокирован на ${LOCKOUT_DURATION_MS / 60000} минут.`,
              code: "ACCOUNT_LOCKED",
            },
            { status: 423 },
          );
        }

        return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
      }

      const token = await signToken(doctor.id, doctor.doctorCode, doctor.role, doctor.tokenVersion);

      // Successful login: reset brute-force counters, record lastLoginAt.
      await db.doctor.update({
        where: { id: doctor.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      logger.info("auth", "Login successful", { doctorCode: doctor.doctorCode, role: doctor.role, ip });

      await appendAudit({
        doctorId: doctor.id,
        action: "login",
        details: JSON.stringify({ doctorCode: doctor.doctorCode, role: doctor.role, ip }),
      });

      await db.notification.create({
        data: {
          doctorId: doctor.id,
          type: "system",
          title: "Login",
          message: "You have logged into СППВР",
        },
      }).catch(() => {});

      const res = NextResponse.json({
        doctor: {
          id: doctor.id,
          fullName: doctor.fullName,
          specialization: doctor.specialization,
          doctorCode: doctor.doctorCode,
          role: doctor.role,
          isActive: doctor.isActive,
        },
        token,
        message: "Authentication successful",
      });
      // Hardened session cookie (HttpOnly → невидим для XSS, Strict → защита от CSRF)
      const cookie = tokenCookie(JWT_TTL_SECONDS);
      cookie.value = token;
      res.cookies.set(cookie);
      return res;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Validation error")) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      logger.error("auth", "Login error", { error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 });
    }
  }

  // ─── LOGOUT (v2.6) ─────────────────────────────────────────────────
  // Инвалидация HttpOnly cookie (серверная — клиент сам не может удалить
  // HttpOnly cookie надёжно).
  if (action === "logout") {
    const session = await getSessionFromRequest(req);
    if (session) {
      await appendAudit({
        doctorId: session.doctorId,
        action: "logout",
        details: JSON.stringify({ doctorCode: session.doctorCode }),
      }).catch(() => {});
    }
    const res = NextResponse.json({ success: true, message: "Выход выполнен" });
    res.cookies.set({
      name: "token",
      value: "",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0, // мгновенное удаление
    });
    return res;
  }

  // ─── REGISTER ─────────────────────────────────────────────────────────
  // v2.6 (enterprise): публичная саморегистрация ЗАКРЫТА по умолчанию.
  // Новых врачей создаёт администратор (POST /api/doctors). Включить для
  // стенда: REGISTRATION_OPEN=true в .env.
  if (action === "register") {
    if (!REGISTRATION_OPEN) {
      return NextResponse.json(
        {
          error: "Саморегистрация отключена администратором. Обратитесь к администратору системы для создания учётной записи.",
          code: "REGISTRATION_CLOSED",
        },
        { status: 403 },
      );
    }
    try {
      const ip = clientIp(req);
      if (registerLimited(ip)) {
        return NextResponse.json(
          { error: "Слишком много регистраций с этого адреса. Повторите через час.", code: "RATE_LIMITED" },
          { status: 429 },
        );
      }

      const { fullName, specialization, doctorCode, password } = body as {
        fullName?: string;
        specialization?: string;
        doctorCode?: string;
        password?: string;
      };

      // Validate required fields
      if (!fullName || fullName.trim().length < 2) {
        return NextResponse.json({ error: "ФИО должно содержать минимум 2 символа" }, { status: 400 });
      }
      if (!specialization || specialization.trim().length < 2) {
        return NextResponse.json({ error: "Специализация должна содержать минимум 2 символа" }, { status: 400 });
      }
      if (!doctorCode || doctorCode.trim().length < 2) {
        return NextResponse.json({ error: "Код врача должен содержать минимум 2 символа" }, { status: 400 });
      }
      // SECURITY (2025-09-07): password minimum raised 4 → 10 with complexity.
      const strength = checkPasswordStrength(String(password || ""));
      if (!strength.ok) {
        return NextResponse.json({ error: strength.error }, { status: 400 });
      }

      // Check for duplicate doctorCode
      const existing = await db.doctor.findUnique({ where: { doctorCode: doctorCode.trim() } });
      if (existing) {
        return NextResponse.json(
          { error: `Врач с кодом "${doctorCode.trim()}" уже существует. Выберите другой код.` },
          { status: 409 },
        );
      }

      // Create the doctor with hashed password — role is always "doctor"
      const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);
      const doctor = await db.doctor.create({
        data: {
          fullName: fullName.trim(),
          specialization: specialization.trim(),
          doctorCode: doctorCode.trim(),
          passwordHash,
          role: "doctor",
          isActive: true,
        },
      });

      const token = await signToken(doctor.id, doctor.doctorCode, doctor.role, doctor.tokenVersion);

      logger.info("auth", "Self-registration successful", { doctorCode: doctor.doctorCode, ip });

      await appendAudit({
        doctorId: doctor.id,
        action: "register",
        details: JSON.stringify({ doctorCode: doctor.doctorCode, fullName: doctor.fullName, ip }),
      });

      const res = NextResponse.json({
        doctor: {
          id: doctor.id,
          fullName: doctor.fullName,
          specialization: doctor.specialization,
          doctorCode: doctor.doctorCode,
          role: doctor.role,
          isActive: doctor.isActive,
        },
        token,
        message: "Регистрация успешна",
      });
      const cookie = tokenCookie(JWT_TTL_SECONDS);
      cookie.value = token;
      res.cookies.set(cookie);
      return res;
    } catch (e) {
      logger.error("auth", "Registration error", { error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Ошибка регистрации" },
        { status: 500 },
      );
    }
  }

  // ─── SET PASSWORD ──────────────────────────────────────────────────────
  // SECURITY (v2.1.4): requires a valid session; authorizes either
  // self-change (session.doctorId === doctorId) or admin override.
  // SECURITY (2025-09-07): new passwords must satisfy the strength policy.
  if (action === "set-password") {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }

      const { doctorId, password, oldPassword, keyMaterial } = body as {
        doctorId?: string;
        password?: string;
        oldPassword?: string;
        // v2.6 (E2EE): новое «заворачивание» DEK под новый пароль —
        // применяется АТОМАРНО вместе со сменой пароля (иначе ключ
        // становится недоступным при частичном сбое).
        keyMaterial?: {
          wrappedDek?: string;
          kdfSalt?: string;
          kdfParams?: { memoryKiB?: number; iterations?: number; parallelism?: number };
          checkBlob?: string;
        };
      };

      // Effective doctorId: admin may target any doctor; non-admins can only
      // change their own password (ignore body.doctorId if it differs).
      const effectiveDoctorId = session.role === "admin" && doctorId ? String(doctorId) : session.doctorId;

      if (session.doctorId !== effectiveDoctorId && session.role !== "admin") {
        return NextResponse.json({ error: "Not authorized to change this doctor's password" }, { status: 403 });
      }

      if (!password) {
        return NextResponse.json({ error: "password is required" }, { status: 400 });
      }
      const strength = checkPasswordStrength(String(password));
      if (!strength.ok) {
        return NextResponse.json({ error: strength.error }, { status: 400 });
      }

      const doctor = await db.doctor.findUnique({ where: { id: effectiveDoctorId } });
      if (!doctor) {
        return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
      }

      // Self-change requires the old password. Admin override does NOT (admin
      // is resetting on behalf of the doctor, e.g. recovery flow).
      if (session.doctorId === doctor.id) {
        if (doctor.passwordHash && oldPassword) {
          const match = await bcrypt.compare(String(oldPassword), doctor.passwordHash);
          if (!match) {
            return NextResponse.json({ error: "Invalid old password" }, { status: 401 });
          }
        } else if (doctor.passwordHash && !oldPassword) {
          return NextResponse.json({ error: "Old password required to change password" }, { status: 400 });
        }
      }

      // v2.6: валидация формата ключевого материала (если передан)
      let kmValid: { wrappedDek: string; kdfSalt: string; kdfParamsJson: string; checkBlob: string } | null = null;
      if (keyMaterial) {
        const km = keyMaterial;
        if (
          !km.wrappedDek || !/^enc:v1:[A-Za-z0-9_-]+$/.test(km.wrappedDek) ||
          !km.checkBlob || !/^enc:v1:[A-Za-z0-9_-]+$/.test(km.checkBlob) ||
          !km.kdfSalt || !/^[A-Za-z0-9+/]+={0,2}$/.test(km.kdfSalt) || km.kdfSalt.length < 16 ||
          !km.kdfParams ||
          typeof km.kdfParams.memoryKiB !== "number" || km.kdfParams.memoryKiB < 8 * 1024 || km.kdfParams.memoryKiB > 1024 * 1024 ||
          typeof km.kdfParams.iterations !== "number" || km.kdfParams.iterations < 1 || km.kdfParams.iterations > 16 ||
          typeof km.kdfParams.parallelism !== "number" || km.kdfParams.parallelism < 1 || km.kdfParams.parallelism > 16
        ) {
          return NextResponse.json({ error: "Некорректный ключевой материал E2EE" }, { status: 400 });
        }
        kmValid = {
          wrappedDek: km.wrappedDek,
          kdfSalt: km.kdfSalt,
          checkBlob: km.checkBlob,
          kdfParamsJson: JSON.stringify({
            memoryKiB: km.kdfParams.memoryKiB,
            iterations: km.kdfParams.iterations,
            parallelism: km.kdfParams.parallelism,
          }),
        };
      }

      const hash = await bcrypt.hash(String(password), BCRYPT_COST);
      // v2.6: смена пароля инвалидирует ВСЕ ранее выданные токены
      // (tokenVersion++ → мгновенный отзыв сессий на других устройствах).
      // Пароль + ключевой материал E2EE обновляются в ОДНОЙ транзакции.
      const updated = await db.$transaction(async (tx) => {
        const doc = await tx.doctor.update({
          where: { id: doctor.id },
          data: { passwordHash: hash, tokenVersion: { increment: 1 } },
        });
        if (kmValid) {
          await tx.doctorKeyMaterial.upsert({
            where: { doctorId: doctor.id },
            create: { doctorId: doctor.id, ...kmValid },
            update: { ...kmValid },
          });
        }
        return doc;
      });
      invalidateAccountCache(doctor.id);

      logger.info("auth", "Password changed", {
        doctorCode: doctor.doctorCode,
        changedBy: session.doctorCode,
        isAdminOverride: session.role === "admin" && session.doctorId !== doctor.id,
      });
      await appendAudit({
        doctorId: session.doctorId,
        caseId: undefined,
        action: "set_password",
        details: JSON.stringify({
          targetDoctorCode: doctor.doctorCode,
          targetDoctorId: doctor.id,
          isAdminOverride: session.role === "admin" && session.doctorId !== doctor.id,
        }),
      });

      // If an admin is resetting another doctor's password, do NOT mint a new
      // token for that doctor — the admin keeps their own session. Only return
      // a fresh token when the doctor is changing their own password.
      if (session.doctorId === doctor.id) {
        const token = await signToken(doctor.id, doctor.doctorCode, doctor.role, updated.tokenVersion);
        const res = NextResponse.json({
          message: "Password set",
          token,
          doctor: {
            id: doctor.id,
            fullName: doctor.fullName,
            doctorCode: doctor.doctorCode,
            role: doctor.role,
          },
        });
        const cookie = tokenCookie(JWT_TTL_SECONDS);
        cookie.value = token;
        res.cookies.set(cookie);
        return res;
      }

      return NextResponse.json({
        message: `Password reset for ${doctor.doctorCode}`,
        doctor: {
          id: doctor.id,
          fullName: doctor.fullName,
          doctorCode: doctor.doctorCode,
          role: doctor.role,
        },
      });
    } catch (e) {
      logger.error("auth", "Password change error", { error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: e instanceof Error ? e.message : "Internal server error" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// GET /api/auth — check current session
export async function GET(req: Request) {
  const session = await getSessionFromRequest(req);
  if (session) {
    return NextResponse.json({ authenticated: true, doctor: session });
  }
  return NextResponse.json({ authenticated: false, message: "No active session" });
}
