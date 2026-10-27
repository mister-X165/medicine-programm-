// ============================================================================
// СППВР v2.6 — Трансформация сущностей для E2EE (шифрование на границе API)
// ============================================================================
// Перехватывает данные ИЗ форм ДО fetch (шифрование) и ПОСЛЕ ответа
// (расшифровка). Открытый текст никогда не покидает браузер.
//
// Tier 1 (E2EE, прямые идентификаторы — ФЗ-152 / HIPAA Safe Harbor):
//   ФИО, полная дата рождения, телефон, email, адрес, СНИЛС, ОМС, ДМС,
//   национальность, профессия, заметки.
// Tier 2 (клинические данные, псевдонимизированы patientToken):
//   пол, группа крови, аллергии, хронические заболевания, показатели —
//   остаются доступными серверной CDSS-логике (проверки ЛСВ, health-score).
// ============================================================================

import { isEncryptedField, encryptField, decryptField, type CascadeKeyPair } from "./field-crypto";
import { touchActivity } from "./session";

/** Поля пациента, шифруемые на этапе ввода (Tier 1). */
export const PATIENT_E2EE_FIELDS = [
  "lastName",
  "firstName",
  "middleName",
  "birthDate",
  "phone",
  "email",
  "address",
  "snils",
  "omiPolicy",
  "insuranceNumber",
  "nationality",
  "occupation",
  "notes",
] as const;

export type PatientE2EEField = (typeof PATIENT_E2EE_FIELDS)[number];

// ----------------------------------------------------------------------------
// Шифрование записи (исходящие данные: форма → API)
// ----------------------------------------------------------------------------

export function encryptPatientRecord(
  data: Record<string, unknown>,
  keys: CascadeKeyPair,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of PATIENT_E2EE_FIELDS) {
    const value = out[field];
    if (typeof value === "string" && value.length > 0 && !isEncryptedField(value)) {
      out[field] = encryptField(value, keys);
    } else if (value === undefined) {
      delete out[field];
    }
  }
  // birthYear вычисляем из открытой даты (для серверной аналитики возраста)
  if (typeof out.birthDate === "string" && !isEncryptedField(out.birthDate)) {
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(out.birthDate);
    if (m) out.birthYear = Number(m[1]);
  }
  touchActivity();
  return out;
}

// ----------------------------------------------------------------------------
// Расшифровка записи (входящие данные: API → UI)
// ----------------------------------------------------------------------------

export interface DecryptResult<T> {
  data: T;
  /** Сколько полей расшифровано. */
  decryptedFields: number;
  /** Поля, зашифрованные чужим ключом (нет DEK для расшифровки). */
  foreignEncrypted: boolean;
}

export function decryptPatientRecord<
  T extends Record<string, unknown>,
>(data: T, keys: CascadeKeyPair): DecryptResult<T> {
  const out: Record<string, unknown> = { ...data };
  let decryptedFields = 0;
  let foreignEncrypted = false;

  for (const field of PATIENT_E2EE_FIELDS) {
    const value = out[field];
    if (isEncryptedField(value)) {
      try {
        out[field] = decryptField(value, keys);
        decryptedFields++;
      } catch {
        // Чужой ключ (данные другого врача) или повреждение:
        // НЕ показываем мусор — помечаем и скрываем
        out[field] = null;
        foreignEncrypted = true;
      }
    }
  }
  touchActivity();
  return { data: out as T, decryptedFields, foreignEncrypted };
}

// ----------------------------------------------------------------------------
// Проверки легаси-данных (незашифрованные записи для миграции)
// ----------------------------------------------------------------------------

export interface PatientMigrationStatus {
  needsMigration: boolean;
  legacyFields: string[];
}

/** Поля, которые всё ещё в открытом виде (легаси до v2.6). */
export function detectLegacyPatient(data: Record<string, unknown>): PatientMigrationStatus {
  const legacyFields: string[] = [];
  for (const field of PATIENT_E2EE_FIELDS) {
    const value = data[field];
    if (typeof value === "string" && value.length > 0 && !isEncryptedField(value)) {
      legacyFields.push(field);
    }
    // birthDate после смены схемы: null-строка у легаси записей
    if (field === "birthDate" && typeof value === "string" && value.length === 0) {
      legacyFields.push(field);
    }
  }
  return { needsMigration: legacyFields.length > 0, legacyFields };
}

/**
 * Миграция одной легаси-записи: шифрует открытые поля.
 * birthDate нормализуется к ISO "YYYY-MM-DD" (легаси-форматы: timestamp-строка
 * "-56764800000" или полная ISO-строка с временем) перед шифрованием.
 */
export function migrateLegacyPatient(
  data: Record<string, unknown>,
  keys: CascadeKeyPair,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PATIENT_E2EE_FIELDS) {
    let value = data[field];
    if (field === "birthDate" && typeof value === "string" && value && !isEncryptedField(value)) {
      value = normalizeLegacyBirthDate(value);
      if (!value) continue; // непарсируемая дата — не шифруем мусор
    }
    if (typeof value === "string" && value.length > 0 && !isEncryptedField(value)) {
      out[field] = encryptField(value, keys);
    }
  }
  // birthYear для серверной аналитики возраста
  if (data.birthYear == null && out.birthDate) {
    const year = extractYear(String(data.birthDate));
    if (year) out.birthYear = year;
  }
  touchActivity();
  return out;
}

/** Нормализация легаси-даты к "YYYY-MM-DD". */
function normalizeLegacyBirthDate(raw: string): string | null {
  let d: Date;
  if (/^-?\d{10,}$/.test(raw)) {
    d = new Date(Number(raw));
  } else {
    d = new Date(raw);
  }
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractYear(raw: string): number | null {
  if (/^-?\d{4,}$/.test(raw)) {
    const d = new Date(Number(raw));
    return isNaN(d.getTime()) ? null : d.getUTCFullYear();
  }
  const m = /^(\d{4})/.exec(raw);
  return m ? Number(m[1]) : null;
}

/** Пациентский возраст из расшифрованной даты (точный, клиентский).
 *  Легаси-форматы: ISO-строка, timestamp-строка ("-56764800000"). */
export function calcAgeFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate || isEncryptedField(birthDate)) return null;
  let d: Date;
  if (/^-?\d{10,}$/.test(birthDate)) {
    // легаси: timestamp в строковом виде (после смены типа DateTime → String)
    d = new Date(Number(birthDate));
  } else {
    d = new Date(birthDate);
  }
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}
