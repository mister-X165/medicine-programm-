// СППВР — JWT-based authentication middleware
// Uses the `jose` library for signing and verifying JWTs

import * as jose from "jose";
import { JWT_ISSUER, JWT_AUDIENCE, JWT_TTL, getJwtSecretBytes } from "./env";

// ---------------------------------------------------------------------------
// JWT Secret — sourced from the centralized env validator (src/lib/env.ts).
// No hardcoded fallback lives in this file anymore.
// ---------------------------------------------------------------------------

function getSecretKey(): Uint8Array {
  return getJwtSecretBytes();
}

// ---------------------------------------------------------------------------
// Token payload type
// ---------------------------------------------------------------------------

export interface JWTPayload {
  doctorId: string;
  doctorCode: string;
  role: string;
  /** Версия токена — сверяется с Doctor.tokenVersion (мгновенный отзыв). */
  tokenVersion?: number;
}

// ---------------------------------------------------------------------------
// signToken — creates a JWT with 8h expiry
// ---------------------------------------------------------------------------

export async function signToken(
  doctorId: string,
  doctorCode: string,
  role: string,
  tokenVersion = 0,
): Promise<string> {
  const secret = getSecretKey();

  const token = await new jose.SignJWT({ doctorId, doctorCode, role, tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID()) // уникальный идентификатор токена
    .setExpirationTime(JWT_TTL)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(secret);

  return token;
}

// ---------------------------------------------------------------------------
// verifyToken — verifies a JWT and returns the payload or null
// ---------------------------------------------------------------------------

export async function verifyToken(
  token: string
): Promise<JWTPayload | null> {
  try {
    const secret = getSecretKey();
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // Validate that the payload has the expected fields
    if (
      typeof payload.doctorId === "string" &&
      typeof payload.doctorCode === "string" &&
      typeof payload.role === "string"
    ) {
      return {
        doctorId: payload.doctorId,
        doctorCode: payload.doctorCode,
        role: payload.role,
        tokenVersion: typeof payload.tokenVersion === "number" ? payload.tokenVersion : 0,
      };
    }

    return null;
  } catch {
    // Token is invalid, expired, or malformed
    return null;
  }
}

// ---------------------------------------------------------------------------
// getSessionFromRequest — extracts JWT from Authorization Bearer header or cookie
// and re-checks the doctor account status (v2.6: instant revocation).
// ---------------------------------------------------------------------------

/** Кэш проверки аккаунта (30 с) — баланс между отзывом и нагрузкой на БД. */
const ACCOUNT_CACHE_TTL_MS = 30 * 1000;
interface AccountCheck {
  ok: boolean;
  role: string;
  tokenVersion: number;
  checkedAt: number;
}
const accountCache = new Map<string, AccountCheck>();

export async function getAccountCheck(
  doctorId: string,
): Promise<AccountCheck | null> {
  const { db } = await import("./db");
  const cached = accountCache.get(doctorId);
  if (cached && Date.now() - cached.checkedAt < ACCOUNT_CACHE_TTL_MS) {
    return cached;
  }
  const doctor = await db.doctor.findUnique({
    where: { id: doctorId },
    select: { isActive: true, role: true, tokenVersion: true },
  });
  if (!doctor) return null;
  const check: AccountCheck = {
    ok: doctor.isActive,
    role: doctor.role,
    tokenVersion: doctor.tokenVersion,
    checkedAt: Date.now(),
  };
  accountCache.set(doctorId, check);
  return check;
}

/** Инвалидирует кэш аккаунта (вызывается при изменении роли/пароля/статуса). */
export function invalidateAccountCache(doctorId?: string): void {
  if (doctorId) accountCache.delete(doctorId);
  else accountCache.clear();
}

export async function getSessionFromRequest(
  req: Request
): Promise<JWTPayload | null> {
  let token: string | null = null;

  // 1. Try Authorization: Bearer <token> header
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim() || null;
  }

  // 2. Try cookie named "token" (HttpOnly — основной механизм v2.6)
  if (!token) {
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const cookies = cookieHeader.split(";").map((c) => c.trim());
      for (const cookie of cookies) {
        if (cookie.startsWith("token=")) {
          token = cookie.slice(6).trim() || null;
        }
      }
    }
  }

  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  // v2.6: мгновенный отзыв — сверка isActive и tokenVersion с БД.
  // Деактивированный врач или врач со сменённым паролем/ролью теряет
  // доступ немедленно (а не через 2 часа, как было до v2.6).
  const account = await getAccountCheck(payload.doctorId);
  if (!account || !account.ok) return null;
  if ((payload.tokenVersion ?? 0) !== account.tokenVersion) return null;
  // Роль могла измениться после выдачи токена — доверяем БД
  if (payload.role !== account.role) {
    return { ...payload, role: account.role };
  }

  return payload;
}

// ---------------------------------------------------------------------------
// requireAuth — returns session or throws an error
// ---------------------------------------------------------------------------

export async function requireAuth(
  req: Request
): Promise<JWTPayload> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    throw new Error("Authentication required");
  }
  return session;
}

// ---------------------------------------------------------------------------
// requireAdmin — returns session if admin role or throws an error
// ---------------------------------------------------------------------------

export async function requireAdmin(
  req: Request
): Promise<JWTPayload> {
  const session = await requireAuth(req);
  if (session.role !== "admin") {
    throw new Error("Admin access required");
  }
  return session;
}
