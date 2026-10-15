// СППВР — Zod validation schemas for all API routes
// Uses zod v4

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Login
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  doctorCode: z.string().min(1, "Doctor code is required"),
  // NOTE: the login schema only validates the INPUT SHAPE. The password
  // strength policy (>= 10 chars) is enforced at set-password/registration
  // time (checkPasswordStrength in /api/auth). Legacy passwords may be
  // shorter than the current policy, so login must NOT reject them by length.
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// 2. Create Doctor
// ---------------------------------------------------------------------------

export const createDoctorSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  specialization: z.string().min(2, "Specialization must be at least 2 characters"),
  doctorCode: z.string().min(2, "Doctor code must be at least 2 characters"),
  // Role is optional on input — server always hardcodes "doctor" for new
  // accounts. Only an admin can elevate via PATCH /api/doctors/[id].
  role: z.enum(["admin", "doctor"], { message: "Role must be 'admin' or 'doctor'" }).optional(),
});

// ---------------------------------------------------------------------------
// 3. Update Doctor (partial of create + isActive)
// ---------------------------------------------------------------------------

export const updateDoctorSchema = createDoctorSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// 4. Create Case
// ---------------------------------------------------------------------------

export const createCaseSchema = z.object({
  diagnosisHint: z.string().optional(),
  birthYear: z.number().min(1900).max(2030).optional(),
  sex: z.enum(["М", "Ж"], { message: "Sex must be 'М' or 'Ж'" }).optional(),
  notes: z.string().optional(),
  // v2.3.2 (Task 4): admin can pre-assign ICD-10 codes when manually creating
  // a case. Persisted as JSON string in the `icd10Codes` column. The `source`
  // field is constrained to "ai" | "manual" so historical AI suggestions stay
  // distinguishable from manual admin selections.
  icd10Codes: z
    .array(
      z.object({
        code: z.string(),
        description: z.string(),
        confidence: z.number().min(0).max(1).optional().default(1),
        source: z.enum(["ai", "manual"]).optional().default("manual"),
      }),
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// 5. Update Case (partial of create + status)
// ---------------------------------------------------------------------------

export const updateCaseSchema = createCaseSchema.partial().extend({
  status: z.enum(["new", "uploaded", "analyzing", "analyzed", "reported"], {
    message: "Invalid case status",
  }),
});

// ---------------------------------------------------------------------------
// 6. Share Case
// ---------------------------------------------------------------------------

export const shareCaseSchema = z.object({
  toDoctorId: z.string({ message: "Target doctor ID is required" }),
  accessLevel: z.enum(["read", "comment"], {
    message: "Access level must be 'read' or 'comment'",
  }),
  message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 7. Generate Report
// ---------------------------------------------------------------------------

export const generateReportSchema = z.object({
  title: z.string().min(1, "Report title is required"),
  templateId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 8. Control Panel
// ---------------------------------------------------------------------------

export const controlPanelSchema = z.object({
  controlWeights: z.record(z.string(), z.number()),
  doctorComments: z.array(
    z.object({
      author: z.string(),
      text: z.string(),
      ts: z.string(),
    })
  ),
  conclusion: z.string().optional(),
  /**
   * v5.1 (audit 9 / partial 5): hard workflow gate for therapy options.
   * PATCH /api/cases/[id]/analysis/control с этим полем добавляет
   * (action="confirm_dx") или убирает (action="unconfirm_dx") диагноз
   * из `structured.confirmedDx`. Используется UI-гейтом для разблокировки
   * TherapyOption'ов соответствующих `targetDx`.
   */
  confirmDx: z.object({
    action: z.enum(["confirm_dx", "unconfirm_dx"]),
    diagnosis: z.string().min(3).max(200),
    /** Необязательное обоснование, чем подтверждено (результаты анализов). */
    evidence: z.string().max(2000).optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// 9. Search
// ---------------------------------------------------------------------------

export const searchSchema = z.object({
  q: z.string().optional(),
  gene: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// 10. Consent
// ---------------------------------------------------------------------------

export const createConsentSchema = z.object({
  // caseId is taken from the URL path; we still accept it in the body for
  // backwards compatibility but it's optional.
  caseId: z.string({ message: "Case ID is required" }).optional(),
  consentType: z.enum(
    ["data_processing", "ai_analysis", "genetic_analysis", "report_sharing", "data_retention"],
    { message: "Invalid consent type" },
  ),
  granted: z.boolean(),
  notes: z.string().optional(),
  validUntil: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 11. Electronic Signature
// ---------------------------------------------------------------------------

export const signReportSchema = z.object({
  reportId: z.string().optional(), // Accept in body for backward compat, but URL param is authoritative
  signatureType: z.enum(["approval", "review", "cosign"], {
    message: "Signature type must be 'approval', 'review', or 'cosign'",
  }),
  comment: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 12. ICD-10 Suggestion
// ---------------------------------------------------------------------------

export const suggestICD10Schema = z.object({
  diagnosisText: z.string().min(1, "Diagnosis text is required"),
  entities: z.array(z.object({
    type: z.string(),
    value: z.string(),
    context: z.string().optional(),
  })).optional(),
});

// ---------------------------------------------------------------------------
// 13. Drug Interaction Check
// ---------------------------------------------------------------------------

export const checkDDISchema = z.object({
  medications: z.array(z.string()).min(1, "At least one medication is required")
    .max(16, "Максимум 16 препаратов за одну проверку"),
  // v5.0: онлайн-режим (по умолчанию true — потоковый поиск в базах РФ)
  online: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// 14. Clinical Pathway Match
// ---------------------------------------------------------------------------

export const matchPathwaySchema = z.object({
  diagnosis: z.string().optional(),
  icd10Codes: z.array(z.object({
    code: z.string(),
    description: z.string(),
    confidence: z.number(),
    source: z.string(),
  })).optional(),
});

// ---------------------------------------------------------------------------
// 15. Backup
// ---------------------------------------------------------------------------

export const restoreBackupSchema = z.object({
  data: z.string().min(1, "Backup data is required"),
});

// ---------------------------------------------------------------------------
// Helper: validateOrThrow
// ---------------------------------------------------------------------------

export function validateOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Validation error: ${result.error.issues.map((i) => i.message).join(", ")}`
    );
  }
  return result.data;
}
