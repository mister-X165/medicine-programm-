// СППВР — Edge authentication proxy (Next.js 16 convention)
// ============================================================================
// This file is the single source of truth for "is this endpoint reachable
// without auth?" It runs on every /api/* request and:
//   1. Allows public routes (auth, health, GET /api/doctors for status badge,
//      read-only knowledge endpoints).
//   2. Verifies the JWT from `Authorization: Bearer <token>` or `token` cookie.
//   3. Attaches the session to request headers (x-doctor-id, x-doctor-code,
//      x-doctor-role) so route handlers can read it without re-parsing the JWT.
//   4. Enforces admin-only access on sensitive routes (POST /api/doctors,
//      PATCH/DELETE /api/doctors/[id], /api/seed*, /api/encryption, /api/logs,
//      /api/backup, /api/audit/export, /api/audit/verify).
//
// SECURITY (incident 2025-09-07):
//   - The insecure DEV_SECRET fallback has been REMOVED. If JWT_SECRET is
//     missing or weak, EVERY request fails closed with 503 (except /api/health
//     for monitoring). Compromised historical values are hard-banned.
//   - Per-IP rate limiting at the edge blunts credential-stuffing / brute
//     force against the public auth endpoints.
//
// Compliance: ФЗ-152 ст. 18 ч. 3 (protection of PДn from unauthorized access),
// HIPAA §164.312(a)(1) (access control).

import { NextResponse, type NextRequest } from "next/server";
import * as jose from "jose";

// ---------------------------------------------------------------------------
// JWT secret — sourced from process.env. We inline the validation here
// because the edge runtime cannot import the full env.ts module (it uses
// Node `crypto` indirectly through some transitive imports).
// ---------------------------------------------------------------------------

const JWT_ISSUER = "sppvr-cdss";
const JWT_AUDIENCE = "sppvr-cdss-api";
const JWT_TTL = "2h";
const JWT_TTL_SECONDS = 2 * 60 * 60;
// Скользящее продление: если до истечения токена осталось меньше часа,
// перевыпускаем JWT и обновляем cookie (врач не вылетает посреди смены).
const RENEW_THRESHOLD_SECONDS = 60 * 60;

const MIN_SECRET_LENGTH = 64;

// Values leaked in the 2025-09-07 incident — permanently banned.
const COMPROMISED_SECRETS = new Set([
  "a0e9637b6af37e00d3dd8fdd518668a0b629446048345c12",
  "ede4978e4fd082139f5f9b7b0737186cf350d85644971481",
  "dev-only-jwt-secret-CHANGE-ME-before-deployment-32chars-min",
  "dev-only-encryption-key-CHANGE-ME-before-deployment-32chars",
]);

function getJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (
    fromEnv &&
    fromEnv.length >= MIN_SECRET_LENGTH &&
    !COMPROMISED_SECRETS.has(fromEnv) &&
    !/^(.)\1+$/.test(fromEnv)
  ) {
    return fromEnv;
  }
  // Fail closed: no dev fallback anymore. isAuthConfigured() will refuse
  // every request with 503.
  return "";
}

function getSecretKey(): Uint8Array {
  const secret = getJwtSecret();
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Per-IP rate limiting (edge, in-memory, single instance).
// Blunt bucket: fixed window. Auth endpoints get a much stricter budget than
// the general API surface. Non-blocking cleanup runs on every check.
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number;
}

const AUTH_LIMIT = 20; // /api/auth requests per window per IP
const AUTH_WINDOW_MS = 60_000; // 1 min
const GENERAL_LIMIT = 300; // all other /api requests per window per IP
const GENERAL_WINDOW_MS = 60_000; // 1 min
const MAX_TRACKED_IPS = 10_000;

const rateBuckets = new Map<string, RateBucket>();

function clientIp(req: NextRequest): string {
  // Caddy (gateway) sets x-real-ip / x-forwarded-for on every proxied request.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic cleanup: drop expired buckets; if the map grew too large,
  // drop the oldest half to bound memory in a flood scenario.
  if (rateBuckets.size > MAX_TRACKED_IPS) {
    for (const [k, v] of rateBuckets) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
    if (rateBuckets.size > MAX_TRACKED_IPS) {
      const keys = [...rateBuckets.keys()].slice(0, Math.floor(MAX_TRACKED_IPS / 2));
      for (const k of keys) rateBuckets.delete(k);
    }
  }

  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}

// ---------------------------------------------------------------------------
// Public route checks — anything matching is reachable WITHOUT auth.
// ---------------------------------------------------------------------------

function isPublicRoute(pathname: string, method: string): boolean {
  // 1. Auth & health — always public (rate-limited above).
  //    v2.6: /api/auth/key — НЕ публичный (требует сессию), но начинается с
  //    /api/auth — поэтому проверка ниже отсекает его до общего правила.
  if (pathname === "/api/auth/key") return false;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname === "/api/health") return true;
  // v2.3: network status is public so the system-status badge can show
  // "Нет интернета" before login.
  if (pathname === "/api/network/status") return true;

  // 2. GET /api/doctors — public for the system-status badge. The route
  //    handler returns only non-sensitive fields (no passwordHash). POST is
  //    still admin-only (handled below).
  if (pathname === "/api/doctors" && method === "GET") return true;

  // 3. Read-only knowledge base endpoints — public so the login screen and
  //    the system-status badge can poll them.
  //    SECURITY (v2.1.4): /api/search is NO LONGER public — it returns PHI
  //    (caseCode, diagnosisHint, doctorName, matchedGenes, matchedMutations)
  //    for ALL cases. Now it requires a valid JWT; the route handler scopes
  //    results by session.doctorId for non-admins.
  //    NOTE: /api/knowledge is also NOT public — the route handler requires
  //    auth (getSessionFromRequest). It was previously in this allowlist by
  //    mistake; removed for consistency.
  if (method === "GET") {
    if (pathname === "/api/recommendations") return true;
    if (pathname === "/api/icd10") return true;
    if (pathname === "/api/ddi") return true;
    if (pathname === "/api/pathways") return true;
    if (pathname === "/api/templates") return true;
  }

  return false;
}

// In production with no JWT_SECRET configured, fail every request closed.
function isAuthConfigured(): boolean {
  return getJwtSecret().length > 0;
}

async function extractSession(req: NextRequest): Promise<jose.JWTPayload | null> {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const session = await verifyJwt(token);
      if (session) return session;
    }
  }

  // 2. Cookie "token" (HttpOnly, SameSite=Strict — set at login)
  const cookieToken = req.cookies.get("token")?.value;
  if (cookieToken) {
    const session = await verifyJwt(cookieToken);
    if (session) return session;
  }

  return null;
}

async function verifyJwt(token: string): Promise<jose.JWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecretKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (
      typeof payload.doctorId === "string" &&
      typeof payload.doctorCode === "string" &&
      typeof payload.role === "string"
    ) {
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Скользящее продление JWT (edge): сохраняет doctorId/doctorCode/role и
// tokenVersion, чтобы отзыв через инкремент tokenVersion продолжал работать.
// ---------------------------------------------------------------------------
async function signRenewedToken(payload: jose.JWTPayload): Promise<string> {
  const tokenVersion =
    typeof payload.tokenVersion === "number" ? payload.tokenVersion : 0;
  return await new jose.SignJWT({
    doctorId: payload.doctorId,
    doctorCode: payload.doctorCode,
    role: payload.role,
    tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(JWT_TTL)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(getSecretKey());
}

function shouldRenew(payload: jose.JWTPayload): boolean {
  if (typeof payload.exp !== "number") return false;
  const remainingSeconds = payload.exp - Math.floor(Date.now() / 1000);
  return remainingSeconds < RENEW_THRESHOLD_SECONDS;
}

// ---------------------------------------------------------------------------
// Admin-only route checks — any logged-in doctor is not enough.
// ---------------------------------------------------------------------------

function isAdminRequired(pathname: string, method: string): boolean {
  // Doctor management — only admins can create/modify/delete doctor profiles.
  // (Self-registration is handled via POST /api/auth?action=register, which
  // is a public route and not subject to this check.)
  if (pathname === "/api/doctors" && method === "POST") return true;
  if (pathname.startsWith("/api/doctors/") && (method === "PATCH" || method === "DELETE")) return true;

  // Seeding & templates — template mutations are admin-only (create,
  //  update, delete). GET /api/templates remains public so the login screen
  //  and report-panel can list available templates before auth.
  if (pathname === "/api/seed" && method === "POST") return true;
  if (pathname === "/api/seed-templates" && method === "POST") return true;
  if (pathname === "/api/templates" && method === "POST") return true;
  if (pathname.startsWith("/api/templates/") && (method === "PATCH" || method === "DELETE")) return true;

  // Encryption management
  if (pathname.startsWith("/api/encryption")) return true;

  // System logs (DELETE especially — can wipe logs)
  if (pathname.startsWith("/api/logs")) return true;

  // Backup/restore
  if (pathname.startsWith("/api/backup")) return true;

  // v2.6: полный журнал аудита — только администратор (ранее любой врач
  // мог читать действия коллег с их IP-адресами). Экспорт и верификация
  // цепочки были закрыты ранее — теперь весь /api/audit.
  if (pathname === "/api/audit" || pathname.startsWith("/api/audit/")) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Proxy entry point (Next.js 16 convention — formerly "middleware")
// ---------------------------------------------------------------------------

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Only enforce on /api/* routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Production safety net: if JWT_SECRET is missing/weak/compromised, refuse
  // all API traffic except /api/health (so monitoring can still probe).
  if (!isAuthConfigured() && !pathname.startsWith("/api/health")) {
    return NextResponse.json(
      {
        error:
          "Server misconfigured: JWT_SECRET is not set. Authentication is unavailable.",
      },
      { status: 503 },
    );
  }

  // Per-IP rate limiting. The auth endpoints get a strict budget (brute-force
  // protection); everything else a generous one. Rate limits apply to every
  // caller, including authenticated ones (simplest DoS shield).
  const ip = clientIp(req);
  const isAuthCall = pathname.startsWith("/api/auth");
  if (isAuthCall) {
    if (rateLimited(`auth:${ip}`, AUTH_LIMIT, AUTH_WINDOW_MS)) {
      return NextResponse.json(
        { error: "Слишком много запросов к авторизации. Повторите через минуту.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
  } else {
    if (rateLimited(`api:${ip}`, GENERAL_LIMIT, GENERAL_WINDOW_MS)) {
      return NextResponse.json(
        { error: "Too many requests", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
  }

  // Public allowlist
  if (isPublicRoute(pathname, method)) {
    return NextResponse.next();
  }

  // Everything else requires a valid session
  const session = await extractSession(req);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required", code: "NO_TOKEN" },
      { status: 401 },
    );
  }

  // Admin-only endpoints
  if (isAdminRequired(pathname, method) && session.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  // Attach session info as request headers for downstream route handlers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-doctor-id", session.doctorId as string);
  requestHeaders.set("x-doctor-code", session.doctorCode as string);
  requestHeaders.set("x-doctor-role", session.role as string);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Скользящее продление: если токен близок к истечению — перевыпускаем и
  // обновляем HttpOnly-cookie. Новый cookie действует со следующего запроса;
  // tokenVersion сохраняется, поэтому инкремент tokenVersion (смена пароля/
  // роли/деактивация) по-прежнему мгновенно отзывает сессию на роут-хендлерах.
  if (shouldRenew(session)) {
    const renewed = await signRenewedToken(session);
    res.cookies.set({
      name: "token",
      value: renewed,
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: JWT_TTL_SECONDS,
    });
  }

  return res;
}

// ---------------------------------------------------------------------------
// Matcher — run proxy only on /api/* routes
// ---------------------------------------------------------------------------

export const config = {
  matcher: ["/api/:path*"],
};
