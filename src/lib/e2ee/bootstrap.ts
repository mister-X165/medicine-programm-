"use client";

// ============================================================================
// СППВР v2.6/v2.7 — Bootstrap E2EE (клиент)
// ============================================================================
// Оркестрация жизненного цикла ключей в UI:
//   afterLogin(password)     — сразу после успешного входа: пароль есть в
//                              памяти → выводим KEK, разворачиваем DEK,
//                              X25519-пары и PDEK (v2.7).
//   ensureKeyOnSession()     — восстановление сессии (перезагрузка страницы):
//                              материал есть → запрашиваем пароль (unlock).
//   unlock(password)         — разблокировка хранилища.
//   enroll(password)         — создание ключа для нового/легаси-аккаунта.
//   migrateLegacyPatients()  — пере-шифрование легаси-записей в открытом виде.
//   hydratePdeksAndMigrate() — v2.7: перевод своих карт на пер-пациентные
//                              ключи (PDEK) + разворачивание переданных карт.
// ============================================================================

import { api } from "@/lib/api";
import { useE2EESession } from "./session";
import {
  deriveKeK,
  createKeyMaterial,
  unwrapKeyMaterial,
  type KeyMaterialDTO,
  type Argon2FieldParams,
} from "./key-manager";
import { wipeKeyPair, splitDek } from "./field-crypto";
import { PATIENT_E2EE_FIELDS } from "./transform";
import {
  generatePdek,
  wrapPdekForOwner,
  generateWrapKeyPair,
  wrapKeyToB64,
  wrapX25519Priv,
  unwrapX25519Priv,
} from "./pdek";

export interface E2EEBootResult {
  ok: boolean;
  scenario: "unlocked" | "enrolled-then-unlocked" | "no-material" | "error" | "bad-password";
  error?: string;
  migrated?: number;
  pdekMigrated?: number;
  grantsUnlocked?: number;
}

/** Проверяет наличие ключевого материала на сервере. */
export async function checkKeyMaterial(): Promise<{
  enrolled: boolean;
  material?: KeyMaterialDTO & { wrapPubKey?: string | null; wrappedWrapKey?: string | null };
}> {
  try {
    const res = await api.getE2EEKeyMaterial();
    if (res.enrolled && res.material) {
      return {
        enrolled: true,
        material: {
          wrappedDek: res.material.wrappedDek,
          kdfSalt: res.material.kdfSalt,
          kdfParams: res.material.kdfParams as Argon2FieldParams,
          checkBlob: res.material.checkBlob,
          wrapPubKey: res.material.wrapPubKey ?? null,
          wrappedWrapKey: res.material.wrappedWrapKey ?? null,
        },
      };
    }
    return { enrolled: false };
  } catch {
    // 404 → не зарегистрирован; другие ошибки — трактуем как «нет материала»
    return { enrolled: false };
  }
}

// ----------------------------------------------------------------------------
// v2.7 — X25519-пара врача (для передачи карт)
// ----------------------------------------------------------------------------

/**
 * Гарантирует наличие X25519-пары в сессии:
 *   • есть wrappedWrapKey → разворачиваем master-DEK'ом;
 *   • нет (легаси-аккаунт до v2.7) → генерируем и до-регистрируем на сервере
 *     (POST /api/auth/key?action=wrap-upgrade).
 * Ошибки — мягкие: E2EE-поля продолжают работать, недоступна только передача.
 */
export async function ensureWrapKeys(
  material?: KeyMaterialDTO & { wrapPubKey?: string | null; wrappedWrapKey?: string | null },
): Promise<boolean> {
  const session = useE2EESession.getState();
  if (session.status !== "unlocked" || !session.dek) return false;
  if (session.wrapPriv && session.wrapPubB64) return true;

  const dek = session.dek;

  // 1. Разворачивание существующей пары
  if (material?.wrappedWrapKey && material?.wrapPubKey) {
    try {
      const wrapPriv = unwrapX25519Priv(material.wrappedWrapKey, dek);
      useE2EESession.getState().setWrapKeys(wrapPriv, material.wrapPubKey);
      return true;
    } catch {
      // повреждённый блоб → пробуем перегенерировать ниже (если сервер пуст)
    }
  }

  // 2. Генерация + до-регистрация (только если на сервере пары нет)
  if (material?.wrapPubKey) return false; // пара есть, но не разворачивается — не трогаем
  try {
    const { privKey, pubKey } = generateWrapKeyPair();
    const pubB64 = wrapKeyToB64(pubKey);
    const wrappedWrapKey = wrapX25519Priv(privKey, dek);
    await api.upgradeWrapKey({ wrapPubKey: pubB64, wrappedWrapKey });
    useE2EESession.getState().setWrapKeys(privKey, pubB64);
    return true;
  } catch {
    // Сервер недоступен/конфликт — передача карт будет недоступна до перезагрузки
    return false;
  }
}

/**
 * Разблокировка существующего ключа паролем (unlock после блокировки
 * или восстановления сессии).
 */
export async function unlockWithPassword(
  password: string,
  material?: KeyMaterialDTO & { wrapPubKey?: string | null; wrappedWrapKey?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const session = useE2EESession.getState();
  session.setStatus("unlocking");
  try {
    const mat = material ?? (await checkKeyMaterial()).material;
    if (!mat) {
      session.setStatus("unavailable");
      return { ok: false, error: "Ключевой материал не найден" };
    }
    const kek = await deriveKeK(password, mat.kdfSalt, mat.kdfParams);
    try {
      const dek = unwrapKeyMaterial(mat, kek);
      session.unlock(dek);
      // v2.7: X25519-пара + PDEK переданных карт (мягкие ошибки)
      await ensureWrapKeys(mat);
      return { ok: true };
    } finally {
      wipeKeyPair(kek);
    }
  } catch (e) {
    session.setStatus("locked");
    return {
      ok: false,
      error:
        e instanceof Error
          ? "Неверный пароль или повреждён ключевой материал"
          : "Ошибка разблокировки",
    };
  }
}

/**
 * Создание ключа для аккаунта без материала (первый вход в v2.6
 * или после сброса пароля администратором) + немедленная разблокировка.
 * v2.7: вместе с DEK создаётся X25519-пара для передачи карт.
 */
export async function enrollWithPassword(password: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = useE2EESession.getState();
  session.setStatus("unlocking");
  try {
    const material = await createKeyMaterial(password);
    // v2.7: X25519-пара, приватный ключ заворачивается тем же DEK
    const { privKey, pubKey } = generateWrapKeyPair();
    const pubB64 = wrapKeyToB64(pubKey);
    const kek = await deriveKeK(password, material.kdfSalt, material.kdfParams);
    try {
      const dek = unwrapKeyMaterial(material, kek);
      try {
        const wrappedWrapKey = wrapX25519Priv(privKey, dek);
        await api.enrollE2EEKey({
          wrappedDek: material.wrappedDek,
          kdfSalt: material.kdfSalt,
          kdfParams: material.kdfParams,
          checkBlob: material.checkBlob,
          wrapPubKey: pubB64,
          wrappedWrapKey,
        });
        session.unlock(dek, { wrapPriv: privKey, wrapPubB64: pubB64 });
        return { ok: true };
      } finally {
        // dek и privKey переходят в сессию — не затираем их здесь
      }
    } finally {
      wipeKeyPair(kek);
    }
  } catch (e) {
    session.setStatus("unavailable");
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Не удалось создать ключ шифрования",
    };
  }
}

/**
 * Полный флоу сразу после логина (пароль уже в памяти):
 *   1. есть материал → выводим KEK, разворачиваем DEK (unlock) + X25519
 *   2. нет материала → создаём (enroll, с X25519) + unlock
 *   3. миграции: легаси-plaintext → master-DEK → PDEK + grant-карты
 * Возвращает результат для UI (тост/диалог).
 */
export async function afterLogin(password: string): Promise<E2EEBootResult> {
  const { enrolled, material } = await checkKeyMaterial();
  if (!enrolled) {
    const res = await enrollWithPassword(password);
    if (res.ok) {
      const migrated = await migrateLegacyPatients();
      const pdek = await hydratePdeksAndMigrate();
      return {
        ok: true,
        scenario: "enrolled-then-unlocked",
        migrated,
        pdekMigrated: pdek.pdekMigrated,
        grantsUnlocked: pdek.grantsUnlocked,
      };
    }
    return { ok: false, scenario: "error", error: res.error };
  }
  const res = await unlockWithPassword(password, material);
  if (res.ok) {
    const migrated = await migrateLegacyPatients();
    const pdek = await hydratePdeksAndMigrate();
    return {
      ok: true,
      scenario: "unlocked",
      migrated,
      pdekMigrated: pdek.pdekMigrated,
      grantsUnlocked: pdek.grantsUnlocked,
    };
  }
  return { ok: false, scenario: "bad-password", error: res.error };
}

/**
 * Восстановление сессии (перезагрузка страницы): пароля нет в памяти —
 * переводим хранилище в locked (пользователь увидит UnlockDialog).
 */
export async function ensureKeyOnSessionRestore(): Promise<void> {
  const session = useE2EESession.getState();
  const { enrolled } = await checkKeyMaterial();
  // ГОНКА (v2.6.1): после входа afterLogin уже разблокировал хранилище
  // (Argon2id занимает 1–2 c, а этот GET мог быть медленным в dev).
  // Не перезаписываем «unlocked» и не трогаем DEK, если он уже в памяти.
  const current = useE2EESession.getState();
  if (current.status === "unlocked" || current.dek) return;
  current.setStatus(enrolled ? "locked" : "unavailable");
  void session;
}

/**
 * Легаси-миграция: пациенты, созданные до v2.6 (поля в открытом виде),
 * пере-шифруются DEK прямо в браузере и обновляются на сервере.
 * Выполняется автоматически после unlock; ошибки — тихо логируются
 * (миграция повторится при следующем входе).
 */
export async function migrateLegacyPatients(): Promise<number> {
  const keys = useE2EESession.getState().getKeys();
  if (!keys) return 0;
  try {
    const res = await api.getPatients();
    let migrated = 0;
    for (const p of res.patients as unknown as Record<string, unknown>[]) {
      // Легаси-plaintext мигрирует только у владельца (чужой шифротекст
      // возвращаем как есть)
      if (p.accessRole !== "owner") continue;
      const status = { needsMigration: false, legacyFields: [] as string[] };
      for (const field of PATIENT_E2EE_FIELDS) {
        const value = p[field];
        if (typeof value === "string" && value.length > 0 && !value.startsWith("enc:v1:")) {
          status.needsMigration = true;
          status.legacyFields.push(field);
        }
      }
      if (!status.needsMigration) continue;
      // Не отправляем чужой шифротекст обратно как plaintext
      const patch: Record<string, unknown> = {};
      for (const field of status.legacyFields) {
        patch[field] = p[field];
      }
      if (typeof p.birthYear === "number") patch.birthYear = p.birthYear;
      try {
        await api.updatePatient(p.id as string, patch);
        migrated++;
      } catch {
        // retry при следующем входе
      }
    }
    return migrated;
  } catch {
    return 0;
  }
}

/**
 * v2.7 — Пер-пациентные DEK:
 *   1. Свои легаси-карты (поля на master-DEK, wrappedPdek=null) переводятся
 *      на PDEK: расшифровка → новый PDEK → пере-шифрование → PATCH. После
 *      этого карту можно передавать другим врачам.
 *   2. Переданные карты (grants): PDEK уже разворачивается при расшифровке
 *      в api-слое (patientKeysFor) — здесь только считаем для тоста.
 * Вызывается автоматически после unlock.
 */
export async function hydratePdeksAndMigrate(): Promise<{
  pdekMigrated: number;
  grantsUnlocked: number;
}> {
  const session = useE2EESession.getState();
  if (session.status !== "unlocked" || !session.dek) {
    return { pdekMigrated: 0, grantsUnlocked: 0 };
  }
  const dek = session.dek;
  try {
    const res = await api.getPatients();
    let pdekMigrated = 0;
    let grantsUnlocked = 0;
    for (const p of res.patients as unknown as Record<string, unknown>[]) {
      const pid = String(p.id ?? "");
      if (!pid) continue;

      if (p.accessRole === "granted" && useE2EESession.getState().getPatientKeys(pid)) {
        grantsUnlocked++;
        continue;
      }

      // Легаси-карта владельца без PDEK — переводим на PDEK
      if (p.accessRole === "owner" && !p.wrappedPdek && !p.foreignEncrypted) {
        try {
          const pdek = generatePdek();
          const wrappedPdek = wrapPdekForOwner(pdek, dek);
          useE2EESession.getState().registerPdek(pid, pdek);
          // Пере-шифровываем расшифрованные Tier-1 поля новым PDEK
          const patch: Record<string, unknown> = {};
          for (const field of PATIENT_E2EE_FIELDS) {
            const value = p[field];
            if (typeof value === "string" && value.length > 0) {
              patch[field] = value; // расшифрованное значение (api зашифрует PDEK'ом)
            }
          }
          if (Object.keys(patch).length === 0) continue; // пустая карта — мигрировать нечего
          patch.wrappedPdek = wrappedPdek;
          await api.updatePatient(pid, patch);
          pdekMigrated++;
        } catch {
          // retry при следующем входе
        }
      }
    }
    return { pdekMigrated, grantsUnlocked };
  } catch {
    return { pdekMigrated: 0, grantsUnlocked: 0 };
  }
}

/** Полная блокировка: затираем DEK. */
export function lockVault(): void {
  useE2EESession.getState().lock();
}

/** Ре-экспорт для UI. */
export { splitDek };
