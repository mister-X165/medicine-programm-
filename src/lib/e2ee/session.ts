"use client";

// ============================================================================
// СППВР v2.6/v2.7 — Сессионное хранилище E2EE-ключей (zustand, только память)
// ============================================================================
// DEK живёт ТОЛЬКО в оперативной памяти вкладки:
//   - никогда не записывается в localStorage / sessionStorage / cookie
//   - автоматически затирается (secureWipe) при блокировке
//   - авто-блокировка после 15 минут неактивности (enterprise policy)
//   - ручная блокировка кнопкой в шапке
//
// v2.7: дополнительно хранит в памяти:
//   - wrapPriv — приватный X25519 врача (для приёма/выдачи PDEK)
//   - pdeks    — реестр пер-пациентных ключей (patientId → 64 байта),
//               разворачиваются после unlock и при чтении grant'ов.
// Всё это затирается при блокировке/выходе.
// ============================================================================

import { create } from "zustand";
import { secureWipe } from "@/lib/crypto";
import { splitDek, wipeKeyPair, type CascadeKeyPair } from "./field-crypto";

export type E2EEStatus =
  | "checking" // идёт проверка наличия ключевого материала
  | "unavailable" // врач без ключа (легаси-аккаунт) — данные не шифруются
  | "locked" // ключ есть, но DEK не в памяти (нужен пароль)
  | "unlocking" // идёт вывод ключа (Argon2id)
  | "unlocked"; // DEK в памяти — данные расшифровываются

/** Авто-блокировка после 15 минут неактивности. */
const AUTO_LOCK_MS = 15 * 60 * 1000;
/** Интервал проверки неактивности. */
const CHECK_INTERVAL_MS = 30 * 1000;

interface E2EESessionState {
  status: E2EEStatus;
  /** DEK в памяти (null, если заблокирован). НЕ сериализуется. */
  dek: Uint8Array | null;
  /** Приватный X25519 (32 байта) для key-wrapping PDEK (v2.7). */
  wrapPriv: Uint8Array | null;
  /** Публичный X25519 (base64) — не секрет, для удобства храним рядом. */
  wrapPubB64: string | null;
  /** Пер-пациентные DEK (v2.7): patientId → 64 байта. Затираются при lock. */
  pdeks: Map<string, Uint8Array>;
  /** Время последней активности (обновляется на каждое шифрование/расшифровку). */
  lastActivityAt: number;
  unlock: (dek: Uint8Array, opts?: { wrapPriv?: Uint8Array; wrapPubB64?: string }) => void;
  lock: () => void;
  setStatus: (s: E2EEStatus) => void;
  touch: () => void;
  /** Ключи каскада master-DEK для шифрования (null если locked). */
  getKeys: () => CascadeKeyPair | null;
  /** v2.7: ключи каскада PDEK пациента (null если нет/locked). */
  getPatientKeys: (patientId: string) => CascadeKeyPair | null;
  /** v2.7: «сырой» PDEK (64 байта) для пере-заворачивания при передаче. */
  getRawPdek: (patientId: string) => Uint8Array | null;
  /** v2.7: регистрация PDEK после разворачивания. */
  registerPdek: (patientId: string, pdek: Uint8Array) => void;
  /** v2.7: приватный X25519 (после разворачивания wrappedWrapKey). */
  setWrapKeys: (priv: Uint8Array, pubB64: string) => void;
}

function wipePdeks(pdeks: Map<string, Uint8Array>): void {
  for (const pdek of pdeks.values()) secureWipe(pdek);
  pdeks.clear();
}

export const useE2EESession = create<E2EESessionState>((set, get) => ({
  status: "checking",
  dek: null,
  wrapPriv: null,
  wrapPubB64: null,
  pdeks: new Map<string, Uint8Array>(),
  lastActivityAt: Date.now(),
  unlock: (dek, opts) => {
    if (dek.length !== 64) {
      throw new Error("Некорректный DEK");
    }
    // Затираем старый DEK, если был
    const old = get().dek;
    if (old) secureWipe(old);
    const oldWrap = get().wrapPriv;
    if (oldWrap && opts?.wrapPriv !== oldWrap) secureWipe(oldWrap);
    wipePdeks(get().pdeks);
    set({
      dek,
      status: "unlocked",
      lastActivityAt: Date.now(),
      wrapPriv: opts?.wrapPriv ?? get().wrapPriv,
      wrapPubB64: opts?.wrapPubB64 ?? get().wrapPubB64,
    });
  },
  lock: () => {
    const { dek, wrapPriv, pdeks } = get();
    if (dek) secureWipe(dek);
    if (wrapPriv) secureWipe(wrapPriv);
    wipePdeks(pdeks);
    set({ dek: null, wrapPriv: null, wrapPubB64: null, pdeks: new Map(), status: "locked" });
  },
  setStatus: (s) => set({ status: s }),
  touch: () => set({ lastActivityAt: Date.now() }),
  getKeys: () => {
    const { dek, status } = get();
    if (!dek || status !== "unlocked") return null;
    return splitDek(dek);
  },
  getPatientKeys: (patientId) => {
    const { status, pdeks } = get();
    if (status !== "unlocked") return null;
    const pdek = pdeks.get(patientId);
    if (!pdek) return null;
    return splitDek(pdek);
  },
  getRawPdek: (patientId) => {
    const { status, pdeks } = get();
    if (status !== "unlocked") return null;
    return pdeks.get(patientId) ?? null;
  },
  registerPdek: (patientId, pdek) => {
    const { pdeks } = get();
    const old = pdeks.get(patientId);
    if (old && old !== pdek) secureWipe(old);
    pdeks.set(patientId, pdek);
    set({ pdeks });
  },
  setWrapKeys: (priv, pubB64) => {
    const old = get().wrapPriv;
    if (old && old !== priv) secureWipe(old);
    set({ wrapPriv: priv, wrapPubB64: pubB64 });
  },
}));

// ----------------------------------------------------------------------------
// Авто-блокировка по неактивности (запускается один раз из E2EEProvider)
// ----------------------------------------------------------------------------

let autoLockTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoLock(): () => void {
  if (autoLockTimer) return () => stopAutoLock();
  autoLockTimer = setInterval(() => {
    const { status, lastActivityAt, lock } = useE2EESession.getState();
    if (status === "unlocked" && Date.now() - lastActivityAt > AUTO_LOCK_MS) {
      lock();
    }
  }, CHECK_INTERVAL_MS);
  return () => stopAutoLock();
}

function stopAutoLock() {
  if (autoLockTimer) {
    clearInterval(autoLockTimer);
    autoLockTimer = null;
  }
}

/** Обновляет активность при любом использовании ключа. */
export function touchActivity(): void {
  useE2EESession.getState().touch();
}

// ----------------------------------------------------------------------------
// Логирование выхода ключа (для отладки — не логирует сам ключ)
// ----------------------------------------------------------------------------

export function describeE2EEStatus(status: E2EEStatus): string {
  switch (status) {
    case "checking":
      return "Проверка ключа шифрования…";
    case "unavailable":
      return "Ключ шифрования не создан";
    case "locked":
      return "Хранилище заблокировано";
    case "unlocking":
      return "Вывод ключа (Argon2id)…";
    case "unlocked":
      return "Шифрование активно";
  }
}
