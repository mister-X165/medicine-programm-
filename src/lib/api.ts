// СППВР v2.0 — клиентский API-слой
// Все запросы используют относительные пути (требование gateway)
// v2.0: добавлены ICD-10, DDI, Clinical Pathways, Consents, Signatures, Versions, Backup

import type {
  CaseSummary,
  DocumentRecord,
  AnalysisResultData,
  SystemStatus,
  ReportRecord,
  CaseShareRecord,
  SearchResultItem,
  NotificationItem,
  TemplateItem,
  TemplateSection,
  TherapyRecommendation,
  ICD10CodeMatch,
  ICD10CodeRecord,
  DDIAlert,
  OnlineDDIAlert,
  NormalizedMedication,
  DDIRecord,
  ClinicalPathwayMatch,
  ClinicalPathwayRecord,
  ConsentRecord,
  ReportSignatureRecord,
  AnalysisVersionRecord,
  BackupData,
  KnowledgeSearchResult,
  PatientSummary,
  PatientDetail,
  VitalSign,
  Medication,
  LabResult,
  Visit,
  Problem,
  Immunization,
  CarePlan,
  Examination,
  ExaminationStats,
  ExaminationResultParam,
  ClinrecMatch,
  ClinrecSearchApiResponse,
  ClinrecFullApiResponse,
  MkbRefItem,
} from "./types";

const API_BASE = "/api";

// ----------------------------------------------------------------------------
// E2EE v2.6 — шифрование на границе API-слоя (до fetch / после ответа)
// ----------------------------------------------------------------------------

import { useE2EESession } from "@/lib/e2ee/session";
import {
  encryptPatientRecord,
  decryptPatientRecord,
  PATIENT_E2EE_FIELDS,
} from "@/lib/e2ee/transform";
import { isEncryptedField, splitDek, decryptField, type CascadeKeyPair } from "@/lib/e2ee/field-crypto";
import {
  generatePdek,
  wrapPdekForOwner,
  unwrapOwnerPdek,
  unwrapGrantedPdek,
} from "@/lib/e2ee/pdek";

/** Ключи каскада master-DEK, если хранилище разблокировано. */
function e2eeKeysOrNull(): CascadeKeyPair | null {
  try {
    return useE2EESession.getState().getKeys();
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// v2.7 — маршрутизация пер-пациентных DEK (PDEK)
// ----------------------------------------------------------------------------

/** Сессия E2EE одним снимком (для атомарности проверок). */
function e2eeSnapshot() {
  const s = useE2EESession.getState();
  return s.status === "unlocked" ? s : null;
}

interface PatientCryptoMeta {
  accessRole?: "owner" | "granted" | "observer";
  wrappedPdek?: string | null;
  myGrant?: { wrappedPdek: string; grantorWrapPub: string } | null;
}

/**
 * Выбирает ключи для пациента (приоритет):
 *   1. PDEK уже в реестре сессии;
 *   2. владелец: разворачивает Patient.wrappedPdek master-DEK'ом;
 *   3. получатель: разворачивает grant своим wrapPriv (X25519 + HKDF);
 *   4. легаси: master-DEK (карты до v2.7).
 * Развёрнутый PDEK регистрируется в реестре сессии (кэш до блокировки).
 */
function patientKeysFor(raw: Record<string, unknown>): CascadeKeyPair | null {
  const s = e2eeSnapshot();
  if (!s) return null;
  const id = String(raw.id ?? "");
  if (!id) return e2eeKeysOrNull();

  // 1. Уже развёрнут
  const known = s.getPatientKeys(id);
  if (known) return known;

  const meta = raw as PatientCryptoMeta;

  // 2. Владелец: PDEK завёрнут моим master-DEK
  if (meta.accessRole === "owner" && typeof meta.wrappedPdek === "string" && s.dek) {
    try {
      const pdek = unwrapOwnerPdek(meta.wrappedPdek, s.dek);
      s.registerPdek(id, pdek);
      return s.getPatientKeys(id);
    } catch {
      // повреждённый блоб — падаем к легаси-попытке
    }
  }

  // 3. Получатель: PDEK завёрнут общим ECDH-ключом (grant)
  if (meta.myGrant && s.wrapPriv && s.wrapPubB64) {
    try {
      const pdek = unwrapGrantedPdek(meta.myGrant, s.wrapPriv, s.wrapPubB64);
      s.registerPdek(id, pdek);
      return s.getPatientKeys(id);
    } catch {
      // чужой/отозванный grant — поля останутся зашифрованными
    }
  }

  // 4. Легаси: master-DEK (пациенты, созданные до v2.7 без PDEK)
  return e2eeKeysOrNull();
}

/** Шифрование исходящих полей (форма → сервер) с маршрутизацией PDEK.
 *  Для НОВОГО пациента (patientId не задан) — генерирует PDEK и добавляет
 *  wrappedPdek в payload. Для существующего — шифрует ключом этого пациента. */
function encryptPatientOut(
  data: Record<string, unknown>,
  patientId?: string,
): Record<string, unknown> {
  const s = e2eeSnapshot();
  if (!s) {
    // Хранилище заблокировано: отправляем только НЕсекретные поля и уже
    // зашифрованные — plaintext идентификаторы не покидают браузер НИКОГДА.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if ((PATIENT_E2EE_FIELDS as readonly string[]).includes(k)) {
        if (typeof v === "string" && isEncryptedField(v)) out[k] = v;
        else if (typeof v === "string" && v === "") out[k] = "";
        else if (v == null) out[k] = v;
        else out[k] = ""; // секретное поле без ключа → не отправляем
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  let keys: CascadeKeyPair;
  let wrappedPdek: string | undefined;
  if (patientId) {
    const patientKeys = s.getPatientKeys(patientId);
    if (patientKeys) {
      keys = patientKeys;
    } else {
      // PDEK неизвестен (легаси-карта или чужая): шифруем master-DEK,
      // сервер отклонит чужие enc-поля через проверку доступа.
      keys = e2eeKeysOrNull() as CascadeKeyPair;
    }
  } else {
    // Новый пациент: генерируем PDEK и заворачиваем master-DEK'ом владельца
    const pdek = generatePdek();
    wrappedPdek = wrapPdekForOwner(pdek, s.dek as Uint8Array);
    keys = splitDek(pdek);
  }
  const out = encryptPatientRecord(data, keys);
  if (wrappedPdek) out.wrappedPdek = wrappedPdek;
  return out;
}

/** Расшифровка записи пациента с маршрутизацией PDEK (после ответа). */
function decryptPatientWithRouting(p: Record<string, unknown>): {
  data: Record<string, unknown>;
  foreignEncrypted: boolean;
} {
  const s = e2eeSnapshot();
  if (!s) {
    const marked = markForeign(p);
    return { data: marked, foreignEncrypted: marked.foreignEncrypted };
  }
  const keys = patientKeysFor(p);
  if (!keys) {
    const marked = markForeign(p);
    return { data: marked, foreignEncrypted: marked.foreignEncrypted };
  }
  const { data, foreignEncrypted, decryptedFields } = decryptPatientRecord(p, keys);
  // Легаси-карта (без PDEK) у владельца: помечаем для фоновой миграции v2.7
  const meta = p as PatientCryptoMeta;
  const legacyPdek =
    meta.accessRole === "owner" && !meta.wrappedPdek && decryptedFields > 0;
  return { data: { ...data, legacyPdek }, foreignEncrypted };
}

/** Пометка записей, недоступных для расшифровки (нет DEK). */
function markForeign<T extends Record<string, unknown>>(p: T): T & { foreignEncrypted: boolean } {
  const out: Record<string, unknown> = { ...p };
  let foreign = false;
  for (const field of PATIENT_E2EE_FIELDS) {
    if (isEncryptedField(out[field])) {
      out[field] = null;
      foreign = true;
    }
  }
  return { ...out, foreignEncrypted: foreign } as T & { foreignEncrypted: boolean };
}

/** v2.7: расшифровка одного enc-поля напоминания (ФИО в clinical-reminders).
 *  Приоритет ключей: PDEK из реестра сессии → master-DEK (легаси). */
function decryptReminderField(value: string, patientId: string): string {
  if (!isEncryptedField(value)) return value || "";
  const s = e2eeSnapshot();
  if (!s) throw new Error("vault locked");
  const known = s.getPatientKeys(patientId);
  if (known) return decryptField(value, known);
  const master = e2eeKeysOrNull();
  if (master) return decryptField(value, master);
  throw new Error("no decryption key");
}

// ---------------------------------------------------------------------------
// JWT token storage (client-side)
// ---------------------------------------------------------------------------
// The token is issued by /api/auth?action=login and verified by the edge
// middleware on every /api/* request. We persist it in localStorage so it
// survives page reloads, and inject it as `Authorization: Bearer <token>`
// on every fetch. Public endpoints (auth, health) simply ignore the header.
//
// SECURITY: the token is the user's session credential. We never expose it
// to third-party scripts and we clear it on logout.

const TOKEN_STORAGE_KEY = "sppvr-jwt";

// v2.6 (XSS-харднинг): JWT больше НЕ хранится в localStorage — только
// HttpOnly-cookie (недоступна JavaScript). Bearer-заголовок не отправляем:
// аутентификация идёт через cookie автоматически (same-origin fetch).
// Старый ключ localStorage вычищаем при загрузке (миграция).

export function setAuthToken(token: string | null): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  void token; // совместимость сигнатуры — значение игнорируется (cookie-only)
}

export function getAuthToken(): string | null {
  return null; // cookie-only: сервер сам читает HttpOnly cookie
}

// Вычистить легаси-токен из localStorage (вызывается один раз при старте).
export function purgeLegacyToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function fetchJSON<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  // v2.6: cookie-only аутентификация (credentials включены по умолчанию
  // для same-origin; Authorization-заголовок не нужен).
  const headers = new Headers(options?.headers || {});
  // Явно включаем cookies (на случай cross-origin в sandbox-превью).
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  // Если middleware отклонил АУТЕНТИФИЦИРОВАННЫЙ запрос — сессия истекла:
  // отправляем UI на повторный вход через событие.
  if (res.status === 401) {
    const isPublicEndpoint =
      url.includes("/api/auth") || url.includes("/api/health");
    if (!isPublicEndpoint) {
      window.dispatchEvent(new CustomEvent("sppvr:session-expired"));
    }
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  // Health
  getHealth: () => fetchJSON<SystemStatus>(`${API_BASE}/health`),

  // Doctors
  getDoctors: () =>
    fetchJSON<{
      doctors: Array<{
        id: string;
        fullName: string;
        specialization: string;
        doctorCode?: string;
        role?: string;
        isActive?: boolean;
        /** v2.7: публичный X25519-ключ (base64) — для передачи карт. */
        wrapPubKey?: string | null;
      }>;
      total?: number;
    }>(`${API_BASE}/doctors`),
  getDoctor: (id: string) =>
    fetchJSON<{ doctor: { id: string; fullName: string; specialization: string; doctorCode: string; role: string; isActive: boolean; hasPassword: boolean; createdAt: string; _count: { cases: number; reports: number; auditLogs: number } } }>(
      `${API_BASE}/doctors/${id}`,
    ),
  createDoctor: (data: {
    fullName: string;
    specialization: string;
    doctorCode: string;
    password?: string;
  }) =>
    fetchJSON<{ doctor: Doctor }>(`${API_BASE}/doctors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateDoctor: (id: string, data: { role?: string; isActive?: boolean; fullName?: string; specialization?: string }) =>
    fetchJSON<{ doctor: { id: string; fullName: string; specialization: string; doctorCode: string; role: string; isActive: boolean } }>(
      `${API_BASE}/doctors/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    ),
  deleteDoctor: (id: string) =>
    fetchJSON<{ success: boolean; message: string }>(`${API_BASE}/doctors/${id}`, {
      method: "DELETE",
    }),

  // Cases
  getCases: () => fetchJSON<{ cases: CaseSummary[] }>(`${API_BASE}/cases`),
  // v2.3.2 (Task 4): admins may pass `doctorId` to assign the new case to
  // another doctor (the server enforces role === "admin" before honoring it),
  // and `icd10Codes` to pre-assign ICD-10 codes. Both fields are ignored
  // for non-admin callers.
  createCase: (data: {
    birthYear?: number;
    sex?: string;
    diagnosisHint?: string;
    notes?: string;
    doctorId?: string;
    patientId?: string;
    icd10Codes?: Array<{ code: string; description: string; confidence?: number; source?: "ai" | "manual" }>;
  }) =>
    fetchJSON<{ case: CaseSummary }>(`${API_BASE}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  getCase: (id: string) =>
    fetchJSON<{ case: CaseSummary & { documents: DocumentRecord[]; analysis?: AnalysisResultData | null; reports?: ReportRecord[] } }>(
      `${API_BASE}/cases/${id}`,
    ),
  updateCase: (id: string, data: Record<string, unknown>) =>
    fetchJSON<{ case: CaseSummary }>(`${API_BASE}/cases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteCase: (id: string) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/cases/${id}`, {
      method: "DELETE",
    }),

  // Documents
  uploadDocument: (caseId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetchJSON<{ document: DocumentRecord }>(
      `${API_BASE}/cases/${caseId}/documents`,
      { method: "POST", body: fd },
    );
  },
  deleteDocument: (caseId: string, docId: string) =>
    fetchJSON<{ success: boolean }>(
      `${API_BASE}/cases/${caseId}/documents/${docId}`,
      { method: "DELETE" },
    ),

  // Analysis
  runAnalysis: (caseId: string, manual = false) =>
    fetchJSON<{ analysis: AnalysisResultData }>(
      `${API_BASE}/cases/${caseId}/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual }),
      },
    ),
  getAnalysis: (caseId: string) =>
    fetchJSON<{ analysis: AnalysisResultData | null }>(
      `${API_BASE}/cases/${caseId}/analysis`,
    ),
  updateControl: (
    caseId: string,
    data: { controlWeights?: Record<string, number>; doctorComments?: unknown[]; conclusion?: string },
  ) =>
    fetchJSON(`${API_BASE}/cases/${caseId}/analysis/control`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Recommendations
  getRecommendations: (params?: { q?: string; gene?: string; category?: string }) => {
    const url = new URL(`${API_BASE}/recommendations`, window.location.origin);
    if (params?.q) url.searchParams.set("q", params.q);
    if (params?.gene) url.searchParams.set("gene", params.gene);
    if (params?.category) url.searchParams.set("category", params.category);
    return fetchJSON<{ recommendations: Array<Record<string, unknown>>; count: number }>(
      url.toString(),
    );
  },

  // Reports
  generateReport: (caseId: string, title?: string) =>
    fetchJSON<{ report: ReportRecord }>(`${API_BASE}/cases/${caseId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  getReports: (caseId: string) =>
    fetchJSON<{ reports: ReportRecord[] }>(`${API_BASE}/cases/${caseId}/reports`),
  approveReport: (id: string) =>
    fetchJSON<{ report: ReportRecord }>(`${API_BASE}/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    }),
  deleteReport: (id: string) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/reports/${id}`, {
      method: "DELETE",
    }),
  // SECURITY (v2.1): report PDFs live in /private-storage and can only be
  // retrieved through the auth-checked endpoint. Because <a href> cannot
  // send the Authorization header, we fetch the PDF as a blob with the JWT
  // and trigger a download via an object URL.
  reportDownloadUrl: (id: string) => `${API_BASE}/reports/${id}?download=1`,
  downloadReport: async (id: string): Promise<void> => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/reports/${id}?download=1`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `report-${id.slice(-8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  },
  uploadKnowledgeDocument: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetchJSON<{ success: boolean; document: { fileName: string; fileType: string; size: number } }>(
      `${API_BASE}/knowledge/upload`,
      { method: "POST", body: fd },
    );
  },

  // Seed
  seed: () =>
    fetchJSON<{ success: boolean; count: number; admin?: { id: string; doctorCode: string; role: string; passwordSet: boolean } }>(`${API_BASE}/seed`, {
      method: "POST",
    }),

  // Auth — system init (first-run setup)
  checkSession: () =>
    fetchJSON<{
      authenticated: boolean;
      doctor?: { doctorId: string; doctorCode: string; role: string };
      message?: string;
    }>(`${API_BASE}/auth`),
  getInitStatus: () =>
    fetchJSON<{
      needsInit: boolean;
      doctorCount: number;
      adminExists: boolean;
      adminPasswordSet: boolean;
      adminActive: boolean;
      adminCode: string;
    }>(`${API_BASE}/auth/init`),
  initSystem: () =>
    fetchJSON<{
      initialized: boolean;
      scenario: "first_run" | "admin_only" | "admin_password_reset" | "already_initialized";
      message: string;
      admin?: { doctorCode: string; password: string | null; fullName: string };
      doctorCount?: number;
      recommendationsCount?: number;
    }>(`${API_BASE}/auth/init`, {
      method: "POST",
    }),

  // Auth
  login: (doctorCode: string, password: string) =>
    fetchJSON<{
      doctor: { id: string; fullName: string; specialization: string; doctorCode: string; role: string; isActive: boolean };
      token: string;
      message: string;
    }>(`${API_BASE}/auth?action=login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctorCode, password }),
    }),
  register: (data: { fullName: string; specialization: string; doctorCode: string; password: string }) =>
    fetchJSON<{
      doctor: { id: string; fullName: string; specialization: string; doctorCode: string; role: string; isActive: boolean };
      token: string;
      message: string;
    }>(`${API_BASE}/auth?action=register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  setPassword: (
    doctorId: string,
    password: string,
    oldPassword?: string,
    keyMaterial?: {
      wrappedDek: string;
      kdfSalt: string;
      kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
      checkBlob: string;
    },
  ) =>
    fetchJSON<{
      message: string;
      token: string;
      doctor: { id: string; fullName: string; doctorCode: string; role: string };
    }>(`${API_BASE}/auth?action=set-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctorId, password, oldPassword, keyMaterial }),
    }),
  logout: () =>
    fetchJSON<{ success: boolean; message: string }>(`${API_BASE}/auth?action=logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),

  // E2EE v2.6 — ключевой материал врача (zero-knowledge)
  getE2EEKeyMaterial: () =>
    fetchJSON<{
      enrolled: boolean;
      material?: {
        wrappedDek: string;
        kdfSalt: string;
        kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
        checkBlob: string;
        wrapPubKey?: string | null;
        wrappedWrapKey?: string | null;
      };
      createdAt?: string;
    }>(`${API_BASE}/auth/key`),
  enrollE2EEKey: (data: {
    wrappedDek: string;
    kdfSalt: string;
    kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
    checkBlob: string;
    wrapPubKey?: string;
    wrappedWrapKey?: string;
  }) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/auth/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  /** v2.7: до-регистрация X25519-пары у легаси-аккаунта (после unlock). */
  upgradeWrapKey: (data: { wrapPubKey: string; wrappedWrapKey: string }) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/auth/key?action=wrap-upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  rewrapE2EEKey: (data: {
    oldPassword: string;
    wrappedDek: string;
    kdfSalt: string;
    kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
    checkBlob: string;
  }) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/auth/key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Search
  searchCases: (params: {
    q?: string;
    gene?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    doctorId?: string;
    page?: number;
    limit?: number;
  }) => {
    const url = new URL(`${API_BASE}/search`, window.location.origin);
    if (params.q) url.searchParams.set("q", params.q);
    if (params.gene) url.searchParams.set("gene", params.gene);
    if (params.status) url.searchParams.set("status", params.status);
    if (params.dateFrom) url.searchParams.set("dateFrom", params.dateFrom);
    if (params.dateTo) url.searchParams.set("dateTo", params.dateTo);
    if (params.doctorId) url.searchParams.set("doctorId", params.doctorId);
    if (params.page) url.searchParams.set("page", String(params.page));
    if (params.limit) url.searchParams.set("limit", String(params.limit));
    return fetchJSON<{
      results: SearchResultItem[];
      total: number;
      page: number;
      totalPages: number;
    }>(url.toString());
  },

  // Case Sharing
  getShares: (caseId: string) =>
    fetchJSON<{ shares: CaseShareRecord[] }>(`${API_BASE}/cases/${caseId}/share`),
  shareCase: (caseId: string, toDoctorId: string, accessLevel = "read", message?: string) =>
    fetchJSON<{ share: CaseShareRecord }>(`${API_BASE}/cases/${caseId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toDoctorId, accessLevel, message }),
    }),
  revokeShare: (caseId: string, shareId: string) =>
    fetchJSON<{ success: boolean; message: string }>(
      `${API_BASE}/cases/${caseId}/share?shareId=${shareId}`,
      { method: "DELETE" },
    ),

  // System Logs (admin only)
  getLogs: (params?: {
    level?: string;
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const url = new URL(`${API_BASE}/logs`, window.location.origin);
    if (params?.level) url.searchParams.set("level", params.level);
    if (params?.category) url.searchParams.set("category", params.category);
    if (params?.search) url.searchParams.set("search", params.search);
    if (params?.limit) url.searchParams.set("limit", String(params.limit));
    if (params?.offset) url.searchParams.set("offset", String(params.offset));
    if (params?.dateFrom) url.searchParams.set("dateFrom", params.dateFrom);
    if (params?.dateTo) url.searchParams.set("dateTo", params.dateTo);
    return fetchJSON<{
      logs: Array<{
        id: string;
        level: string;
        category: string;
        message: string;
        details: string;
        createdAt: string;
      }>;
      total: number;
    }>(url.toString());
  },
  getLogStats: () =>
    fetchJSON<{
      stats: {
        total: number;
        byLevel: Record<string, number>;
        byCategory: Record<string, number>;
      };
    }>(`${API_BASE}/logs?stats=1`),
  deleteLogs: (params?: { beforeDate?: string; level?: string; category?: string }) => {
    const url = new URL(`${API_BASE}/logs`, window.location.origin);
    if (params?.beforeDate) url.searchParams.set("beforeDate", params.beforeDate);
    if (params?.level) url.searchParams.set("level", params.level);
    if (params?.category) url.searchParams.set("category", params.category);
    return fetchJSON<{ deleted: number }>(url.toString(), { method: "DELETE" });
  },
  deleteAllLogs: () =>
    fetchJSON<{ deleted: number }>(`${API_BASE}/logs`, { method: "DELETE" }),

  // Notifications
  getNotifications: (doctorId: string, unreadOnly?: boolean) => {
    const url = new URL(`${API_BASE}/notifications`, window.location.origin);
    url.searchParams.set("doctorId", doctorId);
    if (unreadOnly) url.searchParams.set("unreadOnly", "true");
    return fetchJSON<{ notifications: NotificationItem[]; count: number; unreadCount: number }>(
      url.toString(),
    );
  },
  markNotificationRead: (id: string) =>
    fetchJSON<{ notification: NotificationItem }>(`${API_BASE}/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    }),
  deleteNotification: (id: string) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/notifications/${id}`, {
      method: "DELETE",
    }),
  clearReadNotifications: (doctorId: string) =>
    fetchJSON<{ success: boolean; deleted: number }>(`${API_BASE}/notifications`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearRead: true, doctorId }),
    }),

  // Report Templates
  getTemplates: (category?: string) => {
    const url = category
      ? `${API_BASE}/templates?category=${encodeURIComponent(category)}`
      : `${API_BASE}/templates`;
    return fetchJSON<{ templates: TemplateItem[] }>(url);
  },
  getTemplate: (id: string) =>
    fetchJSON<{ template: TemplateItem }>(`${API_BASE}/templates/${id}`),
  createTemplate: (data: {
    name: string;
    description: string;
    category: string;
    sections: TemplateSection[];
    watermark?: string;
  }) =>
    fetchJSON<{ template: TemplateItem }>(`${API_BASE}/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateTemplate: (id: string, data: Partial<Omit<TemplateItem, "id" | "createdAt" | "updatedAt">>) =>
    fetchJSON<{ template: TemplateItem }>(`${API_BASE}/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteTemplate: (id: string) =>
    fetchJSON<{ success: boolean; template: TemplateItem }>(`${API_BASE}/templates/${id}`, {
      method: "DELETE",
    }),
  seedTemplates: () =>
    fetchJSON<{ success: boolean; created: number; skipped: number; total: number }>(
      `${API_BASE}/seed-templates`,
      { method: "POST" },
    ),

  // Therapy Recommendations
  generateTherapyRecommendations: (caseId: string) =>
    fetchJSON<{ therapyRecommendations: TherapyRecommendation[]; aiAvailable?: boolean }>(
      `${API_BASE}/cases/${caseId}/therapy`,
      { method: "POST" },
    ),

  // AI Chat
  sendChatMessage: (
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    caseContext?: {
      diagnosisHint?: string;
      analysisSummary?: string;
      therapyRecommendations?: string;
    },
    // NEW v2.2: optional document text/chunks passed DIRECTLY to the AI.
    // If documentText is provided, the backend chunks it (if long) and feeds
    // each chunk to the model. This lets the AI answer questions about the
    // actual document content, not just the short analysisSummary.
    document?: {
      text?: string;
      chunks?: string[];
      title?: string;
    },
  ) =>
    fetchJSON<{
      message: { role: "assistant"; content: string; timestamp: string };
      provider: string;
      meta?: {
        documentChunksProcessed: number;
        chunkingStrategy: string;
        /** v4.2: КР Минздрава, разобранные ИИ напрямую из репозитория по теме вопроса */
        ragClinrecs?: Array<{
          codeVersion: string;
          name: string;
          url: string;
          fragmentsCount: number;
          mkbString: string;
        }>;
        /** v4.2: тема, по которой выполнялся разбор репозитория */
        ragTopic?: string;
      };
    }>(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        caseContext,
        documentText: document?.text,
        documentChunks: document?.chunks,
        documentTitle: document?.title,
      }),
    }),

  // ==========================================================================
  // NEW v2.0: ICD-10
  // ==========================================================================
  getICD10Codes: (params?: { q?: string; chapter?: string; limit?: number; offset?: number }) => {
    const url = new URL(`${API_BASE}/icd10`, window.location.origin);
    if (params?.q) url.searchParams.set("q", params.q);
    if (params?.chapter) url.searchParams.set("chapter", params.chapter);
    if (params?.limit) url.searchParams.set("limit", String(params.limit));
    if (params?.offset) url.searchParams.set("offset", String(params.offset));
    return fetchJSON<{ codes: ICD10CodeRecord[]; total: number }>(url.toString());
  },
  suggestICD10Codes: (data: { diagnosisText: string; entities?: Array<{ type: string; value: string; context?: string }> }) =>
    fetchJSON<{ suggestions: ICD10CodeMatch[] }>(`${API_BASE}/icd10/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // ==========================================================================
  // NEW v2.0: Drug-Drug Interactions (DDI)
  // v5.0: online-движок с поиском по базам РФ (РЛС/Видаль/ГРЛС/КР Минздрава).
  // Для ПОТОКОВОЙ проверки (SSE) используйте streamDDICheck().
  // ==========================================================================
  checkDrugInteractions: (medications: string[], online = true) =>
    fetchJSON<{
      alerts: OnlineDDIAlert[];
      count: number;
      normalizedMedications?: NormalizedMedication[];
      summary?: string;
      pairsChecked?: number;
      pairsFromCache?: number;
      sourcesUsed?: string[];
      durationMs?: number;
      online?: boolean;
    }>(`${API_BASE}/ddi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ medications, online }),
    }),
  getDDIRecords: (params?: { severity?: string; drug?: string; limit?: number; offset?: number }) => {
    const url = new URL(`${API_BASE}/ddi`, window.location.origin);
    if (params?.severity) url.searchParams.set("severity", params.severity);
    if (params?.drug) url.searchParams.set("drug", params.drug);
    if (params?.limit) url.searchParams.set("limit", String(params.limit));
    if (params?.offset) url.searchParams.set("offset", String(params.offset));
    return fetchJSON<{ interactions: DDIRecord[]; total: number }>(url.toString());
  },

  // v2.1: Override a DDI alert for a specific case — records a clinical
  // justification, persists it on the alert, and writes an immutable audit
  // log entry (HIPAA / ФЗ-152).
  overrideDDIAlert: (
    caseId: string,
    data: { drug1: string; drug2: string; reason: string },
  ) =>
    fetchJSON<{ success: boolean; alert: DDIAlert }>(
      `${API_BASE}/cases/${caseId}/ddi-override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    ),

  // ==========================================================================
  // NEW v2.0: Clinical Pathways
  // ==========================================================================
  getPathways: (params?: { category?: string; icd10Code?: string }) => {
    const url = new URL(`${API_BASE}/pathways`, window.location.origin);
    if (params?.category) url.searchParams.set("category", params.category);
    if (params?.icd10Code) url.searchParams.set("icd10Code", params.icd10Code);
    return fetchJSON<{ pathways: ClinicalPathwayRecord[]; total: number }>(url.toString());
  },
  matchPathways: (data: { diagnosis?: string; icd10Codes?: ICD10CodeMatch[] }) =>
    fetchJSON<{ matches: ClinicalPathwayMatch[] }>(`${API_BASE}/pathways/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // ==========================================================================
  // NEW v2.0: Consents
  // ==========================================================================
  getConsents: (caseId: string) =>
    fetchJSON<{ consents: ConsentRecord[] }>(`${API_BASE}/cases/${caseId}/consents`),
  createConsent: (data: {
    caseId: string;
    consentType: "data_processing" | "ai_analysis" | "genetic_analysis" | "report_sharing" | "data_retention";
    granted: boolean;
    notes?: string;
    validUntil?: string;
  }) =>
    fetchJSON<{ consent: ConsentRecord }>(`${API_BASE}/consents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateConsent: (id: string, data: { granted?: boolean; notes?: string; validUntil?: string }) =>
    fetchJSON<{ consent: ConsentRecord }>(`${API_BASE}/consents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // ==========================================================================
  // NEW v2.0: Electronic Signatures
  // ==========================================================================
  signReport: (data: {
    reportId: string;
    signatureType: "approval" | "review" | "cosign";
    comment?: string;
  }) =>
    fetchJSON<{ signature: ReportSignatureRecord; report: ReportRecord }>(`${API_BASE}/reports/${data.reportId}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signatureType: data.signatureType,
        comment: data.comment,
      }),
    }),
  // NOTE: Report signatures are now included in the case GET response
  // (GET /api/cases/[id] → case.reports[].signatures). The dedicated
  // `getReportSignatures(reportId)` endpoint was removed because it never
  // existed server-side. Callers should read signatures off the case query.

  // ==========================================================================
  // NEW v2.0: Analysis Version History
  // ==========================================================================
  getAnalysisVersions: (analysisId: string) =>
    fetchJSON<{ versions: AnalysisVersionRecord[] }>(`${API_BASE}/analysis/${analysisId}/versions`),
  getAnalysisVersion: (analysisId: string, version: number) =>
    fetchJSON<{ version: AnalysisVersionRecord }>(
      `${API_BASE}/analysis/${analysisId}/versions/${version}`,
    ),

  // ==========================================================================
  // Audit Export (server-side) + Hash-chain verification
  // ==========================================================================
  /**
   * Fetch the server-side audit log export as a downloadable Blob.
   *
   * The server returns:
   *   - `format=csv` → `text/csv` attachment (binary, BOM-prefixed UTF-8)
   *   - `format=json` (or any non-csv value) → `application/json`
   *
   * Because CSV is binary, we cannot use `fetchJSON` here — we go straight
   * to `fetch` and return the Blob so the caller can trigger a download.
   *
   * Filters (`dateFrom`, `dateTo`, `category`, `doctorId`, `caseId`) are
   * forwarded to the server so the exported file matches what the user
   * currently sees in the UI.
   */
  exportAuditLog: async (params?: {
    dateFrom?: string;
    dateTo?: string;
    category?: string;
    doctorId?: string;
    caseId?: string;
    format?: "json" | "csv";
  }): Promise<{ blob: Blob; filename: string; contentType: string }> => {
    const url = new URL(`${API_BASE}/audit/export`, window.location.origin);
    if (params?.dateFrom) url.searchParams.set("dateFrom", params.dateFrom);
    if (params?.dateTo) url.searchParams.set("dateTo", params.dateTo);
    // The server endpoint accepts `action` for the category filter.
    if (params?.category) url.searchParams.set("action", params.category);
    if (params?.doctorId) url.searchParams.set("doctorId", params.doctorId);
    if (params?.caseId) url.searchParams.set("caseId", params.caseId);
    url.searchParams.set("format", params?.format ?? "csv");

    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url.toString(), { headers });
    if (res.status === 401) {
      setAuthToken(null);
      throw new Error("Authentication required");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";

    // Prefer the server-provided filename from Content-Disposition; fall back
    // to a sensible default derived from the format and today's date.
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="?([^";]+)"?/.exec(cd);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const ext = (params?.format ?? "csv") === "json" ? "json" : "csv";
    const filename = match?.[1] ?? `audit-export-${today}.${ext}`;

    return { blob, filename, contentType };
  },

  /**
   * Verify the WORM audit log hash-chain server-side. Returns `ok=true` when
   * every row's stored `hash` matches the recomputed SHA-256 of
   * (prevHash || canonical fields).
   */
  verifyAuditChain: () =>
    fetchJSON<{
      ok: boolean;
      verified: number;
      brokenAt: { id: string; expectedHash: string; actualHash: string } | null;
      checkedAt: string;
    }>(`${API_BASE}/audit/verify`),

  // ==========================================================================
  // NEW v2.0: Backup/Restore
  // ==========================================================================
  // GET  /api/backup        → returns the full BackupData JSON object
  // POST /api/backup        → accepts a raw BackupData JSON body, restores it
  //
  // The previous implementation incorrectly used POST for create and pointed
  // restore at a non-existent `/api/backup/restore` endpoint while wrapping
  // the payload in `{ data: <text> }`. Both are fixed below.
  createBackup: () =>
    fetchJSON<BackupData>(`${API_BASE}/backup`, {
      method: "GET",
    }),
  restoreBackup: (backup: BackupData) =>
    fetchJSON<{ success: boolean; restored: number; message: string }>(`${API_BASE}/backup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    }),

  // ==========================================================================
  // Audit Log — DEPRECATED (v2.1)
  // The clearAuditLog endpoint has been removed. The audit log is now
  // immutable (WORM) per ФЗ-152 ст. 18 ч. 3. Any call will return 405.
  // Kept here as a stub so existing imports don't break, but it always
  // throws a clear error message.
  // ==========================================================================
  clearAuditLog: async () => {
    throw new Error(
      "Audit log is immutable (WORM) since v2.1. Deletion is prohibited by ФЗ-152 ст. 18 ч. 3.",
    );
  },

  // ==========================================================================
  // File Encryption (admin only)
  // ==========================================================================
  getEncryptionStatus: () =>
    fetchJSON<{
      totalFiles: number;
      encryptedFiles: number;
      unencryptedFiles: number;
      isFullyEncrypted: boolean;
      algorithm: string;
      e2eeCoverage?: { total: number; encrypted: number; legacy: number; pct: number };
    }>(`${API_BASE}/encryption`),
  encryptAllFiles: () =>
    fetchJSON<{
      success: boolean;
      encrypted: number;
      skipped: number;
      failed: number;
    }>(`${API_BASE}/encryption`, {
      method: "POST",
    }),

  // ==========================================================================
  // NEW v2.1: Global Knowledge Search (aggregated across all 4 sources)
  // ==========================================================================
  searchKnowledge: (q: string, limit = 20) => {
    const url = new URL(`${API_BASE}/knowledge`, window.location.origin);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    return fetchJSON<{
      results: KnowledgeSearchResult[];
      counts: Record<string, number>;
    }>(url.toString());
  },

  // ==========================================================================
  // NER De-identification
  // ==========================================================================
  getNERStatus: () =>
    fetchJSON<{ available: boolean; method: string; model: string | null }>(`${API_BASE}/ner`),
  runNERDeidentify: (data: { text: string; lang?: string; mode?: string }) =>
    fetchJSON<{
      success: boolean;
      text: string;
      entities: Array<{ type: string; text: string; start: number; end: number; confidence: number; replacement: string }>;
      method: string;
      processingTimeMs: number;
      model?: string;
    }>(`${API_BASE}/ner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // ==========================================================================
  // EMR — Patients (Medical Record) v2.5.0 + E2EE v2.6
  // ==========================================================================
  // Все прямые идентификаторы шифруются каскадом AES-256-GCM-SIV +
  // ChaCha20-Poly1305 ДО fetch (encryptPatientRecord) и расшифровываются
  // сразу после ответа (decryptPatientRecord). Открытый текст не покидает
  // браузер; сервер хранит только enc:v1:… шифротекст.
  getPatients: (params?: { q?: string; status?: string }) => {
    const url = new URL(`${API_BASE}/patients`, window.location.origin);
    if (params?.q) url.searchParams.set("q", params.q);
    if (params?.status) url.searchParams.set("status", params.status);
    return fetchJSON<{ patients: Record<string, unknown>[]; count: number }>(url.toString()).then(
      (res) => {
        const patients = res.patients.map((p) => {
          const { data, foreignEncrypted } = decryptPatientWithRouting(p);
          return { ...data, foreignEncrypted };
        });
        return { patients: patients as unknown as PatientSummary[], count: res.count };
      },
    );
  },
  getPatient: (id: string) =>
    fetchJSON<{ patient: Record<string, unknown> }>(`${API_BASE}/patients/${id}`).then(
      (res) => {
        const { data, foreignEncrypted } = decryptPatientWithRouting(res.patient);
        return { patient: { ...data, foreignEncrypted } as unknown as PatientDetail };
      },
    ),
  createPatient: (data: Record<string, unknown>) => {
    const payload = encryptPatientOut(data);
    return fetchJSON<{ patient: Record<string, unknown> }>(`${API_BASE}/patients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      const { data: decrypted } = decryptPatientWithRouting(res.patient);
      return { patient: decrypted as unknown as PatientSummary };
    });
  },
  updatePatient: (id: string, data: Record<string, unknown>) => {
    const payload = encryptPatientOut(data, id);
    return fetchJSON<{ patient: Record<string, unknown> }>(`${API_BASE}/patients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      const { data: decrypted } = decryptPatientWithRouting(res.patient);
      return { patient: decrypted as unknown as PatientSummary };
    });
  },
  archivePatient: (id: string) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/patients/${id}`, { method: "DELETE" }),

  // ==========================================================================
  // v2.7 — Передача доступа к карте (PatientAccessGrant, key-wrapping X25519)
  // ==========================================================================
  /** Список активных grant'ов карты (для владельца — управление доступом). */
  getPatientGrants: (patientId: string) =>
    fetchJSON<{
      grants: Array<{
        granteeDoctorId: string;
        granteeName: string;
        granteeCode: string;
        granteeSpecialization?: string;
        grantedBy: string;
        grantedByName?: string;
        grantedAt: string;
        status: string;
      }>;
    }>(`${API_BASE}/patients/${patientId}/grants`),
  /** Передача доступа: PDEK уже пере-завёрнут под ключ получателя в браузере. */
  grantPatientAccess: (
    patientId: string,
    data: { granteeDoctorId: string; wrappedPdek: string; grantorWrapPub: string },
  ) =>
    fetchJSON<{ success: boolean; grant?: unknown }>(`${API_BASE}/patients/${patientId}/grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  /** Отзыв доступа (мгновенный, серверный). */
  revokePatientAccess: (patientId: string, granteeDoctorId: string) =>
    fetchJSON<{ success: boolean }>(
      `${API_BASE}/patients/${patientId}/grants?granteeDoctorId=${encodeURIComponent(granteeDoctorId)}`,
      { method: "DELETE" },
    ),

  // v4.1: Обследования — раздел мед. карты
  getExaminations: (patientId: string, params?: { status?: string; type?: string }) => {
    const url = new URL(`${API_BASE}/patients/${patientId}/examinations`, window.location.origin);
    if (params?.status) url.searchParams.set("status", params.status);
    if (params?.type) url.searchParams.set("type", params.type);
    return fetchJSON<{ examinations: Examination[]; stats: ExaminationStats }>(url.toString());
  },
  createExamination: (patientId: string, data: {
    name: string;
    examType?: string;
    modality?: string;
    code?: string;
    priority?: string;
    indication?: string;
    icd10?: string;
    visitId?: string | null;
    caseId?: string | null;
    scheduledAt?: string | null;
    performedAt?: string;
    clinrecCodeVersion?: string;
    clinrecName?: string;
    clinrecMkb?: string;
    notes?: string;
  }) =>
    fetchJSON<{ examination: Examination }>(`${API_BASE}/patients/${patientId}/examinations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateExamination: (id: string, data: Partial<{
    status: string;
    priority: string;
    scheduledAt: string | null;
    completedAt: string | null;
    performedAt: string;
    resultValue: string;
    resultData: ExaminationResultParam[];
    interpretation: string;
    conclusion: string;
    isAbnormal: boolean;
    notes: string;
    clinrecCodeVersion: string;
    clinrecName: string;
    clinrecMkb: string;
    cancelReason: string;
  }>) =>
    fetchJSON<{ examination: Examination }>(`${API_BASE}/examinations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteExamination: (id: string) =>
    fetchJSON<{ ok: boolean }>(`${API_BASE}/examinations/${id}`, { method: "DELETE" }),

  // v4.1: Клинические рекомендации Минздрава РФ (официальный репозиторий)
  searchMinzdravClinrecs: (params: {
    q?: string;
    mkb?: string;
    age?: number | null;
    page?: number;
    pageSize?: number;
    includeContent?: boolean;
  }) => {
    const url = new URL(`${API_BASE}/minzdrav/clinrecs`, window.location.origin);
    if (params.q) url.searchParams.set("q", params.q);
    if (params.mkb) url.searchParams.set("mkb", params.mkb);
    if (params.age) url.searchParams.set("age", String(params.age));
    if (params.page) url.searchParams.set("page", String(params.page));
    if (params.pageSize) url.searchParams.set("pageSize", String(params.pageSize));
    if (params.includeContent) url.searchParams.set("includeContent", "true");
    return fetchJSON<ClinrecSearchApiResponse>(url.toString());
  },
  getClinrecFull: (codeVersion: string, force = false) => {
    const url = new URL(`${API_BASE}/minzdrav/clinrecs/${codeVersion}`, window.location.origin);
    if (force) url.searchParams.set("force", "true");
    return fetchJSON<ClinrecFullApiResponse>(url.toString());
  },
  searchMkbRef: (q: string, limit = 20) => {
    const url = new URL(`${API_BASE}/minzdrav/mkb`, window.location.origin);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    return fetchJSON<{ items: MkbRefItem[]; total: number }>(url.toString());
  },

  // v2.5.1: Medication safety check (allergies + DDI)
  checkMedSafety: (patientId: string, drugName: string) => {
    const url = new URL(`${API_BASE}/patients/${patientId}/med-check`, window.location.origin);
    url.searchParams.set("drugName", drugName);
    return fetchJSON<{
      drugName: string;
      safetyLevel: "safe" | "caution" | "major_warning" | "contraindicated";
      allergyAlerts: Array<{ allergen: string; reaction: string; severity: string }>;
      ddiAlerts: Array<{
        interactingDrug: string;
        severity: string;
        description: string;
        mechanism: string;
        management: string;
        evidenceLevel: string;
      }>;
      activeMedications: Array<{ drugName: string; dosage: string; frequency: string }>;
    }>(url.toString());
  },

  // Vital signs
  getVitals: (patientId: string) =>
    fetchJSON<{ vitals: VitalSign[] }>(`${API_BASE}/patients/${patientId}/vitals`),
  addVital: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ vital: VitalSign }>(`${API_BASE}/patients/${patientId}/vitals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Medications
  getMedications: (patientId: string, status?: string) => {
    const url = new URL(`${API_BASE}/patients/${patientId}/medications`, window.location.origin);
    if (status) url.searchParams.set("status", status);
    return fetchJSON<{ medications: Medication[] }>(url.toString());
  },
  addMedication: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ medication: Medication }>(`${API_BASE}/patients/${patientId}/medications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Lab results
  getLabResults: (patientId: string, category?: string) => {
    const url = new URL(`${API_BASE}/patients/${patientId}/labs`, window.location.origin);
    if (category) url.searchParams.set("category", category);
    return fetchJSON<{ labResults: LabResult[] }>(url.toString());
  },
  addLabResult: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ labResult: LabResult }>(`${API_BASE}/patients/${patientId}/labs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Visits
  getVisits: (patientId: string) =>
    fetchJSON<{ visits: Visit[] }>(`${API_BASE}/patients/${patientId}/visits`),
  createVisit: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ visit: Visit }>(`${API_BASE}/patients/${patientId}/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Problems
  getProblems: (patientId: string) =>
    fetchJSON<{ problems: Problem[] }>(`${API_BASE}/patients/${patientId}/problems`),
  addProblem: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ problem: Problem }>(`${API_BASE}/patients/${patientId}/problems`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Immunizations
  getImmunizations: (patientId: string) =>
    fetchJSON<{ immunizations: Immunization[] }>(`${API_BASE}/patients/${patientId}/immunizations`),
  addImmunization: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ immunization: Immunization }>(`${API_BASE}/patients/${patientId}/immunizations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // Care plans
  getCarePlans: (patientId: string) =>
    fetchJSON<{ carePlans: CarePlan[] }>(`${API_BASE}/patients/${patientId}/careplans`),
  createCarePlan: (patientId: string, data: Record<string, unknown>) =>
    fetchJSON<{ carePlan: CarePlan }>(`${API_BASE}/patients/${patientId}/careplans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // v2.5.7: Clinical reminders (overdue labs, med reviews, upcoming visits, etc.)
  // v2.7: ФИО пациента приходит КАК ШИФРОТЕКСТ (enc:v1:lastName, enc:v1:firstName) —
  // расшифровка на клиенте с маршрутизацией PDEK; имя собирается после расшифровки.
  getClinicalReminders: () =>
    fetchJSON<{
      reminders: Array<{
        id: string;
        type: "lab_followup" | "visit_scheduled" | "med_review" | "problem_uncontrolled" | "immunization_due";
        priority: "urgent" | "high" | "medium" | "low";
        title: string;
        patientLast: string; // enc:v1:… — расшифрует клиент
        patientFirst: string; // enc:v1:… — расшифрует клиент
        patientToken: string;
        patientId: string;
        date: string;
        detail?: string;
        daysAgo?: number;
        daysUntil?: number;
      }>;
      summary: {
        total: number;
        urgent: number;
        high: number;
        medium: number;
        byType: Record<string, number>;
      };
    }>(`${API_BASE}/clinical-reminders`).then((res) => {
      const reminders = res.reminders.map((r) => {
        let patientName = "🔒 Пациент (зашифровано)";
        try {
          const last = decryptReminderField(r.patientLast, r.patientId);
          const first = decryptReminderField(r.patientFirst, r.patientId);
          if (last || first) {
            patientName = [last, first].filter(Boolean).join(" ") || patientName;
          }
        } catch {
          // чужой ключ — оставляем маску
        }
        const { patientLast: _l, patientFirst: _f, ...rest } = r;
        return { ...rest, patientName };
      });
      return { ...res, reminders };
    }),

  // v2.5.8: Patient DDI overview — all interactions for active meds
  getDdiOverview: (patientId: string) =>
    fetchJSON<{
      totalMeds: number;
      activeMedications: Array<{ id: string; drugName: string; dosage: string; frequency: string; route: string; indication: string }>;
      interactions: Array<{
        drug1: string;
        drug2: string;
        severity: string;
        description: string;
        mechanism: string;
        management: string;
        evidenceLevel: string;
      }>;
      allergyWarnings: Array<{
        medication: string;
        allergen: string;
        reaction: string;
        severity: string;
      }>;
      summary: {
        total: number;
        contraindications: number;
        major: number;
        moderate: number;
        minor: number;
        allergyConflicts: number;
      };
    }>(`${API_BASE}/patients/${patientId}/ddi-overview`),

  // v2.5.9: Patient health score — composite 0-100 score with contributing factors
  getHealthScore: (patientId: string) =>
    fetchJSON<{
      score: number;
      riskLevel: "low" | "moderate" | "high" | "critical";
      riskLabel: string;
      riskColor: string;
      factors: Array<{
        category: string;
        label: string;
        impact: "positive" | "neutral" | "negative" | "critical";
        detail: string;
        points: number;
      }>;
      age: number | null;
      totalDeduction: number;
    }>(`${API_BASE}/patients/${patientId}/health-score`),

  // v2.5.10: Batch health scores for patient list
  getHealthScoresBatch: () =>
    fetchJSON<{
      scores: Record<string, { score: number; riskLevel: string; riskLabel: string }>;
    }>(`${API_BASE}/health-scores-batch`),

  // v4.0: Global AI chat — standalone clinical assistant with patient context
  // v4.2: ИИ напрямую разбирает репозиторий КР Минздрава по теме вопроса;
  //       meta.ragClinrecs — список разобранных КР (для бейджей в UI)
  globalChat: (data: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    patientContext?: { patientId?: string };
  }) =>
    fetchJSON<{
      message: { role: "assistant"; content: string; timestamp: string };
      provider?: string;
      durationMs?: number;
      contextUsed?: boolean;
      meta?: {
        ragClinrecs?: Array<{
          codeVersion: string;
          name: string;
          url: string;
          fragmentsCount: number;
        }>;
        aiUnavailable?: boolean;
      };
    }>(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // v5.2: Differential diagnosis — несколько гипотез с аргументами ЗА/ПРОТИВ,
  // план дообследования, условные опции терапии, самопроверка ИИ,
  // КР Минздрава РФ + международные источники (см. DDxResponse в lib/types)
  differentialDiagnosis: (data: {
    symptoms: string;
    age?: number;
    sex?: string;
    history?: string;
    examiners?: string;
  }) =>
    fetchJSON<import("./types").DDxResponse>(`${API_BASE}/ai/differential-diagnosis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // v4.0: Lab interpretation
  interpretLabs: (data: {
    testResults: Array<{ name: string; value: number; unit: string; refLow?: number; refHigh?: number }>;
    patientAge?: number;
    patientSex?: string;
  }) =>
    fetchJSON<{
      summary: string;
      abnormalities: Array<{ test: string; interpretation: string; severity: string }>;
      recommendations: string[];
    }>(`${API_BASE}/ai/lab-interpretation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // v4.0: Drug interaction check
  checkDrugs: (data: {
    medications: string[];
    patientConditions?: string[];
  }) =>
    fetchJSON<{
      interactions: Array<{ drugA: string; drugB: string; severity: string; mechanism: string; recommendation: string }>;
      contraindications: Array<{ drug: string; condition: string; recommendation: string }>;
      summary: string;
    }>(`${API_BASE}/ai/drug-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
};

type Doctor = { id: string; fullName: string; specialization: string; doctorCode: string };
