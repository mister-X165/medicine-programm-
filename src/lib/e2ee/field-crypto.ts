// ============================================================================
// СППВР v2.6 — E2EE шифрование полей на этапе ввода (клиент)
// ============================================================================
// Интеграция движка CryptoVault (src/lib/crypto) в медицинское приложение.
//
// Архитектура (enterprise, zero-knowledge):
//   Пароль врача (никогда не покидает браузер в открытом виде)
//     → Argon2id (hash-wasm, WASM) → KEK (64 байта = 2×256 бит)
//     → разворачивает DEK (64 случайных байта, сгенерирован в браузере)
//     → DEK хранится ТОЛЬКО в памяти вкладки (никогда не персистится)
//     → каждое PII-поле шифруется каскадом:
//         c1 = AES-256-GCM-SIV(key1, nonce1, plaintext)   [+16 B тег]
//         c2 = ChaCha20-Poly1305(key2, nonce2, c1)        [+16 B тег]
//     → на сервер уходит только "enc:v1:<base64(nonce1||nonce2||c2)>"
//
// Формат значения: "enc:v1:" + base64( nonce1(12) || nonce2(12) || c2 )
// Префикс позволяет отличать шифротекст от легаси-открытого-текста.
// ============================================================================

import { gcmsiv } from "@noble/ciphers/aes.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes, secureWipe, constantTimeEqual } from "@/lib/crypto";

export const FIELD_ENC_PREFIX = "enc:v1:";
const NONCE_SIZE = 12;
const TAG_OVERHEAD = 16 + 16; // два AEAD-тега каскада

/** Пара ключей каскада (AES-256-GCM-SIV + ChaCha20-Poly1305). */
export interface CascadeKeyPair {
  aesKey: Uint8Array; // 32 байта
  chachaKey: Uint8Array; // 32 байта
}

/** Валидирует и разбирает DEK (64 байта). */
export function splitDek(dek: Uint8Array): CascadeKeyPair {
  if (dek.length !== 64) {
    throw new Error(`DEK должен быть 64 байта, получено ${dek.length}`);
  }
  return { aesKey: dek.slice(0, 32), chachaKey: dek.slice(32, 64) };
}

/** Определяет, является ли значение шифротекстом E2EE. */
export function isEncryptedField(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(FIELD_ENC_PREFIX);
}

// ----------------------------------------------------------------------------
// Шифрование одного поля (текст) каскадом AES-GCM-SIV + ChaCha20-Poly1305
// ----------------------------------------------------------------------------

export function encryptField(plaintext: string, keys: CascadeKeyPair): string {
  if (typeof plaintext !== "string") {
    throw new Error("encryptField: ожидается строка");
  }
  const pt = new TextEncoder().encode(plaintext);

  // Случайные nonce для каждого шифра — независимые поля не связаны
  // counter-пространством, поэтому уникальность гарантируется CSPRNG
  // (вероятность коллизии 96-битного nonce ≈ 2^-48 при 2^32 полях).
  const nonce1 = randomBytes(NONCE_SIZE);
  const nonce2 = randomBytes(NONCE_SIZE);

  try {
    // Слой 1: AES-256-GCM-SIV (nonce-misuse resistant, NIST SP 800-38D)
    const c1 = gcmsiv(keys.aesKey, nonce1).encrypt(pt);
    // Слой 2: ChaCha20-Poly1305 (RFC 8439)
    const c2 = chacha20poly1305(keys.chachaKey, nonce2).encrypt(c1);
    // Промежуточный c1 — секрет: затираем
    secureWipe(c1);

    // Сборка: nonce1 || nonce2 || c2
    const blob = new Uint8Array(NONCE_SIZE * 2 + c2.length);
    blob.set(nonce1, 0);
    blob.set(nonce2, NONCE_SIZE);
    blob.set(c2, NONCE_SIZE * 2);
    return FIELD_ENC_PREFIX + toBase64Url(blob);
  } finally {
    secureWipe(nonce1);
    secureWipe(nonce2);
    secureWipe(pt);
  }
}

// ----------------------------------------------------------------------------
// Расшифровка одного поля. Оба AEAD-тега проверяются ДО возврата открытого
// текста (fail-closed). Ошибка → DecryptionFieldError, plaintext не выдан.
// ----------------------------------------------------------------------------

export class DecryptionFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionFieldError";
  }
}

export function decryptField(ciphertext: string, keys: CascadeKeyPair): string {
  if (!isEncryptedField(ciphertext)) {
    throw new DecryptionFieldError("Значение не является шифротекстом enc:v1");
  }
  const blob = fromBase64Url(ciphertext.slice(FIELD_ENC_PREFIX.length));
  if (blob.length < NONCE_SIZE * 2 + TAG_OVERHEAD) {
    throw new DecryptionFieldError("Шифротекст слишком короткий (повреждён?)");
  }
  const nonce1 = blob.subarray(0, NONCE_SIZE);
  const nonce2 = blob.subarray(NONCE_SIZE, NONCE_SIZE * 2);
  const c2 = blob.subarray(NONCE_SIZE * 2);

  // Слой 2 (внешний) — ChaCha20-Poly1305
  let c1: Uint8Array;
  try {
    c1 = chacha20poly1305(keys.chachaKey, nonce2).decrypt(c2);
  } catch {
    throw new DecryptionFieldError(
      "ChaCha20-Poly1305: проверка тега не пройдена (слой 2)",
    );
  }
  // Слой 1 (внутренний) — AES-256-GCM-SIV
  let pt: Uint8Array;
  try {
    pt = gcmsiv(keys.aesKey, nonce1).decrypt(c1);
  } catch {
    secureWipe(c1);
    throw new DecryptionFieldError(
      "AES-256-GCM-SIV: проверка тега не пройдена (слой 1)",
    );
  }
  secureWipe(c1);
  try {
    return new TextDecoder().decode(pt);
  } finally {
    secureWipe(pt);
  }
}

// ----------------------------------------------------------------------------
// Заворачивание/разворачивание DEK ключом KEK (тоже каскад)
// ----------------------------------------------------------------------------

export function wrapDek(dek: Uint8Array, kek: CascadeKeyPair): string {
  // DEK — 64 случайных байта; шифруем их hex-представление как "поле"
  const dekHex = toHex(dek);
  return encryptField(dekHex, kek);
}

export function unwrapDek(wrapped: string, kek: CascadeKeyPair): Uint8Array {
  const dekHex = decryptField(wrapped, kek);
  const dek = fromHex(dekHex);
  if (dek.length !== 64) {
    secureWipe(dek);
    throw new DecryptionFieldError(
      "Завёрнутый DEK имеет неверную длину — материал повреждён",
    );
  }
  return dek;
}

/** Верификационный блоб: шифруем известную константу KEK'ом. */
export const KEY_CHECK_PLAINTEXT = "SPPVR-E2EE-CHECK-V1";

export function makeCheckBlob(kek: CascadeKeyPair): string {
  return encryptField(KEY_CHECK_PLAINTEXT, kek);
}

export function verifyCheckBlob(checkBlob: string, kek: CascadeKeyPair): boolean {
  try {
    const decoded = decryptField(checkBlob, kek);
    return constantTimeEqual(
      new TextEncoder().encode(decoded),
      new TextEncoder().encode(KEY_CHECK_PLAINTEXT),
    );
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Утилиты base64url (без padding, безопасно для JSON/URL)
// ----------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new DecryptionFieldError("Некорректный hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Затирает пару ключей каскада. */
export function wipeKeyPair(keys: CascadeKeyPair): void {
  secureWipe(keys.aesKey);
  secureWipe(keys.chachaKey);
}
