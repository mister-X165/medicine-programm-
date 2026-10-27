// ============================================================================
// СППВР v2.7 — Пер-пациентные DEK (PDEK) + key-wrapping для передачи карт
// ============================================================================
// КРИПТОСХЕМА (zero-knowledge, server never sees keys):
//
//   У каждого врача — ПАРА X25519 для распределения ключей:
//     wrapPriv (32 байта)  — секрет, живёт завёрнутым master-DEK в БД
//     wrapPub  (32 байта)  — открытый, хранится в БД в base64
//
//   У каждой карты пациента — СВОЙ PDEK (64 случайных байта):
//     • Tier-1 поля карты шифруются PDEK (а не master-DEK врача)
//     • wrappedPdek = enc:v1:<PDEK под master-DEK владельца>      (в Patient)
//     • Grant: wrappedPdek' = enc:v1:<PDEK под KEK_grant>          (в PatientAccessGrant)
//
//   KEK_grant выводится ОБЕИМИ сторонами детерминированно:
//     shared  = X25519(мой wrapPriv, их wrapPub)          // классический ECDH
//     salt    = SHA-256(grantorPub ‖ granteePub)           // оба ключа публичны
//     KEK     = HKDF-SHA256(shared, salt, "SPPVR-GRANT-V1", 64 байта)
//     → splitDek → каскад AES-256-GCM-SIV + ChaCha20-Poly1305 (как wrapDek)
//
//   Передача доступа: владелец разворачивает PDEK своим master-DEK,
//   пере-заворачивает под KEK_grant и отправляет enc:v1:-блоб на сервер.
//   Получатель выводит KEK_grant своим wrapPriv + публичным wrapPub владельца
//   и разворачивает PDEK. MASTER-DEK владельца НИКОГДА не покидает браузер.
//
// Compliance: ФЗ-152 ст. 18 ч. 3, HIPAA §164.312(a)(2)(iv) (распределение
// ключей), NIST SP 800-56A (ECDH X25519), RFC 7748, RFC 5869 (HKDF).
// ============================================================================

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, secureWipe } from "@/lib/crypto";
import {
  splitDek,
  wrapDek,
  unwrapDek,
  encryptField,
  decryptField,
  type CascadeKeyPair,
} from "./field-crypto";

const HKDF_INFO = "SPPVR-GRANT-V1";
export const PDEK_LENGTH = 64;

// ----------------------------------------------------------------------------
// Пара X25519 врача
// ----------------------------------------------------------------------------

export interface WrapKeyPair {
  privKey: Uint8Array; // 32 байта — секрет
  pubKey: Uint8Array; // 32 байта — открытый
}

/** Генерирует новую пару X25519 для распределения PDEK. */
export function generateWrapKeyPair(): WrapKeyPair {
  const privKey = x25519.utils.randomSecretKey();
  const pubKey = x25519.getPublicKey(privKey);
  return { privKey, pubKey };
}

/** base64 ↔ bytes (стандартный, с padding — для публичных ключей в БД). */
export function wrapKeyToB64(pubKey: Uint8Array): string {
  let s = "";
  for (let i = 0; i < pubKey.length; i++) s += String.fromCharCode(pubKey[i]);
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ----------------------------------------------------------------------------
// Вывод KEK_grant (обе стороны получают ОДИНАКОВЫЙ ключ)
// ----------------------------------------------------------------------------

function deriveGrantKek(
  myWrapPriv: Uint8Array,
  peerWrapPubB64: string,
  myPubB64: string,
): CascadeKeyPair {
  const peerPub = b64ToBytes(peerWrapPubB64);
  const myPub = b64ToBytes(myPubB64);
  // Соль: конкатенация публичных ключей (упорядоченная канонически по байтам),
  // чтобы обе стороны получили одинаковый salt независимо от направления.
  const [a, b] = compareBytes(myPub, peerPub) < 0 ? [myPub, peerPub] : [peerPub, myPub];
  const saltInput = new Uint8Array(a.length + b.length);
  saltInput.set(a, 0);
  saltInput.set(b, a.length);
  const salt = sha256(saltInput);

  const shared = x25519.getSharedSecret(myWrapPriv, peerPub);
  const kek64 = hkdf(sha256, shared, salt, new TextEncoder().encode(HKDF_INFO), PDEK_LENGTH);
  secureWipe(shared);
  return splitDek(kek64);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// ----------------------------------------------------------------------------
// Заворачивание PDEK (владелец → получатель; владелец → сам себя)
// ----------------------------------------------------------------------------

export interface GrantWrap {
  /** PDEK, завёрнутый KEK_grant — уходит на сервер. */
  wrappedPdek: string;
  /** Публичный X25519 передающего (base64) — нужен получателю для ECDH. */
  grantorWrapPub: string;
}

/**
 * Пере-заворачивание PDEK под врача-получателя.
 * Вызывается ВЛАДЕЛЬЦЕМ карты в его браузере: PDEK уже развёрнут
 * master-DEK'ом и существует только в памяти.
 */
export function wrapPdekForGrantee(
  pdek: Uint8Array,
  myWrapPriv: Uint8Array,
  myWrapPubB64: string,
  granteeWrapPubB64: string,
): GrantWrap {
  const kek = deriveGrantKek(myWrapPriv, granteeWrapPubB64, myWrapPubB64);
  try {
    return {
      wrappedPdek: wrapDek(pdek, kek),
      grantorWrapPub: myWrapPubB64,
    };
  } finally {
    secureWipe(kek.aesKey);
    secureWipe(kek.chachaKey);
  }
}

/**
 * Разворачивание PDEK из grant'а — вызывается ПОЛУЧАТЕЛЕМ в его браузере:
 * KEK_grant = ECDH(мой wrapPriv, публичный ключ передающего).
 * Salt выводится из пары публичных ключей (канонически упорядоченной) —
 * обе стороны получают одинаковый KEK.
 */
export function unwrapGrantedPdek(
  grant: { wrappedPdek: string; grantorWrapPub: string },
  myWrapPriv: Uint8Array,
  myWrapPubB64: string,
): Uint8Array {
  const kek = deriveGrantKek(myWrapPriv, grant.grantorWrapPub, myWrapPubB64);
  try {
    return unwrapDek(grant.wrappedPdek, kek);
  } finally {
    secureWipe(kek.aesKey);
    secureWipe(kek.chachaKey);
  }
}

/**
 * Заворачивание PDEK под master-DEK владельца (хранится в Patient.wrappedPdek).
 * masterDek — 64 байта (развёрнут в памяти сессии владельца).
 */
export function wrapPdekForOwner(pdek: Uint8Array, masterDek: Uint8Array): string {
  const kek = splitDek(masterDek);
  return wrapDek(pdek, kek);
}

/** Разворачивание PDEK владельцем (master-DEK в памяти). */
export function unwrapOwnerPdek(wrappedPdek: string, masterDek: Uint8Array): Uint8Array {
  const kek = splitDek(masterDek);
  return unwrapDek(wrappedPdek, kek);
}

// ----------------------------------------------------------------------------
// Заворачивание приватного X25519 (32 байта) master-DEK'ом врача
// ----------------------------------------------------------------------------

/** Заворачивает приватный X25519 (32 байта) под master-DEK (enc:v1:…). */
export function wrapX25519Priv(privKey: Uint8Array, masterDek: Uint8Array): string {
  if (privKey.length !== 32) {
    throw new Error("wrapX25519Priv: ожидается 32 байта");
  }
  const kek = splitDek(masterDek);
  return encryptField(toHex(privKey), kek);
}

/** Разворачивает приватный X25519 из enc:v1:… (проверка длины 32). */
export function unwrapX25519Priv(wrapped: string, masterDek: Uint8Array): Uint8Array {
  const kek = splitDek(masterDek);
  const hex = decryptField(wrapped, kek);
  const priv = fromHex(hex);
  if (priv.length !== 32) {
    secureWipe(priv);
    throw new Error("unwrapX25519Priv: неверная длина ключа");
  }
  return priv;
}

// ----------------------------------------------------------------------------
// hex-утилиты (локальные, для заворачивания бинарных ключей как полей)
// ----------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("Некорректный hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Генерация нового PDEK
// ----------------------------------------------------------------------------

/** Новый PDEK — 64 CSPRNG-байта (32 AES + 32 ChaCha для каскада). */
export function generatePdek(): Uint8Array {
  return randomBytes(PDEK_LENGTH);
}

/** Затирает PDEK/приватный ключ из памяти. */
export { secureWipe as wipePdek };
