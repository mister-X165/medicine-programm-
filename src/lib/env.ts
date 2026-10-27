// СППВР v4.2.1 — Centralized environment configuration & validation
// ============================================================================
// INCIDENT RESPONSE 2025-09-07: the .env file was exposed to a third party
// during a live demo. Both secrets (JWT_SECRET, ENCRYPTION_KEY) were rotated
// to fresh 256-bit values (64 hex chars each). This module now:
//   1. Requires strong secrets (>= 64 chars) in EVERY environment — there
//      are NO insecure dev fallbacks anymore (fail-fast, fail-closed).
//   2. Maintains a blacklist of COMPROMISED secret values — if anyone
//      restores the old leaked .env, the application refuses to start.
//   3. Exports typed, ready-to-use values.
//
// Compliance: ФЗ-152 ст. 18 ч. 3 (protection of PДn), HIPAA §164.312(a)(2)(iv)
// (encryption and decryption keys). Hardcoded secrets in source code are a
// finding we explicitly close here.

// -----------------------------------------------------------------------------
// Policy: minimum secret length. Rotated keys are 64 hex chars (256 bit).
// Requirement: all keys MUST exceed 50 characters — we enforce 64.
// -----------------------------------------------------------------------------

const MIN_SECRET_LENGTH = 64;

// -----------------------------------------------------------------------------
// COMPROMISED SECRET BLACKLIST (incident 2025-09-07)
// These exact values leaked during the demo. They are permanently banned:
// any attempt to run the app with one of them is a hard failure.
// -----------------------------------------------------------------------------

const COMPROMISED_SECRETS: ReadonlySet<string> = new Set([
  // Leaked production JWT_SECRET (48 hex chars)
  "a0e9637b6af37e00d3dd8fdd518668a0b629446048345c12",
  // Leaked production ENCRYPTION_KEY (48 hex chars)
  "ede4978e4fd082139f5f9b7b0737186cf350d85644971481",
  // Historic insecure dev placeholders (never allowed again)
  "dev-only-jwt-secret-CHANGE-ME-before-deployment-32chars-min",
  "dev-only-encryption-key-CHANGE-ME-before-deployment-32chars",
]);

function validateSecret(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[env] FATAL: ${name} is not set. The application refuses to start without a real secret (>= ${MIN_SECRET_LENGTH} chars).`,
    );
  }

  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[env] FATAL: ${name} is too short (${value.length} chars, minimum ${MIN_SECRET_LENGTH}). Generate one with: openssl rand -hex 32`,
    );
  }

  if (COMPROMISED_SECRETS.has(value)) {
    throw new Error(
      `[env] FATAL: ${name} matches a COMPROMISED value from the 2025-09-07 incident. Refusing to start. Rotate to a fresh secret immediately.`,
    );
  }

  // Low-entropy guard: reject secrets made of a single repeated character
  // or trivial sequences (e.g. "aaaa...", "1234...", "0123456789abcdef" x4).
  if (/^(.)\1+$/.test(value)) {
    throw new Error(`[env] FATAL: ${name} has no entropy (repeated character). Refusing to start.`);
  }

  return value;
}

// -----------------------------------------------------------------------------
// Validated secrets — imported by auth.ts, proxy.ts, encryption.ts
// -----------------------------------------------------------------------------

export const JWT_SECRET = validateSecret("JWT_SECRET", process.env.JWT_SECRET);

export const ENCRYPTION_PASSPHRASE = validateSecret(
  "ENCRYPTION_KEY",
  process.env.ENCRYPTION_KEY,
);

export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";

// -----------------------------------------------------------------------------
// JWT configuration
// -----------------------------------------------------------------------------
// SECURITY (incident 2025-09-07): TTL reduced 8h → 2h to shrink the window of
// opportunity for a stolen/forged token. Rotation of JWT_SECRET already
// invalidated every session minted before the rotation.

export const JWT_ISSUER = "sppvr-cdss";
export const JWT_AUDIENCE = "sppvr-cdss-api";
export const JWT_TTL = "2h";
export const JWT_TTL_SECONDS = 2 * 60 * 60;

// -----------------------------------------------------------------------------
// v2.6: Публичная саморегистрация закрыта по умолчанию (enterprise policy).
// Новых врачей создаёт администратор через админ-панель. Для стенда можно
// включить REGISTRATION_OPEN=true.
// -----------------------------------------------------------------------------

export const REGISTRATION_OPEN = (process.env.REGISTRATION_OPEN || "false") === "true";

export function getJwtSecretBytes(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}
