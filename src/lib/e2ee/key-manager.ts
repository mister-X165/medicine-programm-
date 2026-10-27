// ============================================================================
// СППВР v2.6 — Менеджер ключей E2EE (браузер)
// ============================================================================
// Управляет жизненным циклом ключей шифрования врача:
//   1. deriveKeK(password, salt, params) — Argon2id → 64 байта (2×256 бит)
//   2. createKeyMaterial(password) — генерирует DEK + заворачивает KEK'ом
//   3. enrollKeyMaterial(password) — отправляет шифротекст на сервер
//   4. unlockWithPassword(password) — KEK → разворачивание DEK → память
//
// v2.7: Argon2id выполняется В WEB WORKER'Е — UI не блокируется на время
// вывода ключа (0.7–1.5 с). При недоступности worker'а — автоматический
// фолбэк на главный поток (функциональность сохраняется).
//
// ПАРАМИТРЫ ARGON2: 64 MiB / 3 итерации / p=4 — компромисс между защитой
// от GPU-перебора (~×2 стоимость против fast) и задержкой входа (~0.7-1.5 c
// в WASM). Параметры хранятся в key material — unlock самодостаточен.
// ============================================================================

import { argon2id } from "hash-wasm";
import { randomBytes, secureWipe } from "@/lib/crypto";
import { argon2idOffThread } from "./worker-kdf";
import {
  splitDek,
  wrapDek,
  unwrapDek,
  makeCheckBlob,
  verifyCheckBlob,
  wipeKeyPair,
  type CascadeKeyPair,
} from "./field-crypto";

export interface Argon2FieldParams {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export const E2EE_ARGON2_PARAMS: Argon2FieldParams = {
  memoryKiB: 64 * 1024, // 64 MiB
  iterations: 3,
  parallelism: 4,
};

export interface KeyMaterialDTO {
  wrappedDek: string; // enc:v1:…
  kdfSalt: string; // base64 (16 байт)
  kdfParams: Argon2FieldParams;
  checkBlob: string; // enc:v1:…
}

/** Выводит KEK (64 байта) из пароля через Argon2id — В БРАУЗЕРЕ (worker). */
export async function deriveKeK(
  password: string,
  saltB64: string,
  params: Argon2FieldParams,
): Promise<CascadeKeyPair> {
  const salt = fromB64(saltB64);
  if (salt.length < 16) {
    throw new Error("Соль KDF должна быть ≥ 16 байт");
  }
  const passwordBytes = new TextEncoder().encode(password);
  try {
    // v2.7: сначала пробуем worker (UI остаётся отзывчивым),
    // при недоступности — фолбэк на главный поток
    let output: Uint8Array | null = null;
    try {
      output = await argon2idOffThread({
        password: passwordBytes,
        salt,
        memoryKiB: params.memoryKiB,
        iterations: params.iterations,
        parallelism: params.parallelism,
      });
    } catch {
      output = null;
    }
    if (!output) {
      output = (await argon2id({
        password: passwordBytes,
        salt,
        parallelism: params.parallelism,
        memorySize: params.memoryKiB,
        hashLength: 64, // 32 (AES) + 32 (ChaCha)
        iterations: params.iterations,
        outputType: "binary",
      })) as unknown as Uint8Array;
    }
    return splitDek(output);
  } finally {
    secureWipe(passwordBytes);
  }
}

/**
 * Полный цикл создания ключевого материала для нового врача:
 * генерирует DEK, выводит KEK из пароля, заворачивает DEK и
 * создаёт верификационный блоб. Возвращает DTO для сервера.
 */
export async function createKeyMaterial(
  password: string,
): Promise<KeyMaterialDTO> {
  const salt = randomBytes(16);
  const kek = await deriveKeK(password, toB64(salt), E2EE_ARGON2_PARAMS);
  try {
    const dek = randomBytes(64); // 32+32 байта для каскада
    try {
      return {
        wrappedDek: wrapDek(dek, kek),
        kdfSalt: toB64(salt),
        kdfParams: { ...E2EE_ARGON2_PARAMS },
        checkBlob: makeCheckBlob(kek),
      };
    } finally {
      secureWipe(dek);
    }
  } finally {
    wipeKeyPair(kek);
  }
}

/**
 * Разворачивание DEK из материала с проверкой KEK.
 * Возвращает DEK (64 байта) или бросает ошибку (неверный пароль/повреждено).
 */
export function unwrapKeyMaterial(
  material: KeyMaterialDTO,
  kek: CascadeKeyPair,
): Uint8Array {
  if (!verifyCheckBlob(material.checkBlob, kek)) {
    throw new Error(
      "Неверный пароль или повреждённый ключевой материал (проверка KEK не пройдена)",
    );
  }
  return unwrapDek(material.wrappedDek, kek);
}

/**
 * Пере-заворачивание DEK под НОВЫЙ пароль (смена пароля):
 * разворачивает старым KEK, заворачивает новым.
 */
export async function rewrapKeyMaterial(
  material: KeyMaterialDTO,
  oldPassword: string,
  newPassword: string,
): Promise<KeyMaterialDTO> {
  const oldKek = await deriveKeK(oldPassword, material.kdfSalt, material.kdfParams);
  try {
    const dek = unwrapKeyMaterial(material, oldKek);
    try {
      const newSalt = randomBytes(16);
      const newKek = await deriveKeK(newPassword, toB64(newSalt), E2EE_ARGON2_PARAMS);
      try {
        return {
          wrappedDek: wrapDek(dek, newKek),
          kdfSalt: toB64(newSalt),
          kdfParams: { ...E2EE_ARGON2_PARAMS },
          checkBlob: makeCheckBlob(newKek),
        };
      } finally {
        wipeKeyPair(newKek);
      }
    } finally {
      secureWipe(dek);
    }
  } finally {
    wipeKeyPair(oldKek);
  }
}

// ----------------------------------------------------------------------------
// base64 утилиты
// ----------------------------------------------------------------------------

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
