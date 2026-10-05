// СППВР v2.0 — System initialization API (first-run setup)
// GET  /api/auth/init — Check if system needs initialization
// POST /api/auth/init — Initialize system (create admin, seed data)
//
// SECURITY (v2.1): Admin password is no longer hardcoded. On first run we
// generate a cryptographically random one-time password, write it to the
// response ONCE (so the operator can capture it from a trusted client), and
// then it must be rotated at first login. The password is never persisted in
// source code or repeated in any subsequent API response.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { logger } from "@/lib/logger";
import { clinicalRecommendations, CLINICAL_RECOMMENDATIONS_COUNT } from "@/lib/seed/clinical-recommendations";
import { icd10Codes, ICD10_CODES_COUNT } from "@/lib/seed/icd10-codes";
import { drugInteractions, DRUG_INTERACTIONS_COUNT } from "@/lib/seed/drug-interactions";
import { clinicalPathways, CLINICAL_PATHWAYS_COUNT } from "@/lib/seed/clinical-pathways";
import {
  DEMO_PATIENT,
  DEMO_CASE,
  DEMO_VISIT,
  DEMO_VITAL_SIGNS,
  DEMO_MEDICATIONS,
  DEMO_LAB_RESULTS,
  DEMO_PROBLEMS,
  DEMO_CARE_PLAN,
  DEMO_ANALYSIS,
  DEMO_CONSENT,
  DEMO_NOTIFICATION,
} from "@/lib/seed/demo-patient";

export const dynamic = "force-dynamic";

const ADMIN_DOCTOR_CODE = "ADMIN";
const ADMIN_FULL_NAME = "System Administrator";
const ADMIN_SPECIALIZATION = "Administrator";

// v4.3 audit fix: POST /api/auth/init is reachable without authentication
// (the edge proxy allowlists /api/auth/*). Previously the FIRST caller to
// reach a fresh deployment captured the one-time admin password. Now:
//   - If INIT_BOOTSTRAP_TOKEN is set in .env, POST requires it (Bearer or
//     X-Bootstrap-Token). This lets the operator gate first-run setup.
//   - Otherwise, POST is only allowed from localhost (x-real-ip / x-forwarded-for
//     is 127.0.0.1 / ::1), which is the operator's terminal.
function isLocalhostRequest(req: Request): boolean {
  const real = req.headers.get("x-real-ip");
  if (real && (real === "127.0.0.1" || real === "::1" || real === "localhost")) return true;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0].trim();
    if (first === "127.0.0.1" || first === "::1" || first === "localhost") return true;
  }
  return false;
}

function checkBootstrapAuth(req: Request): { ok: boolean; status: number; error?: string } {
  const token = process.env.INIT_BOOTSTRAP_TOKEN;
  if (token) {
    const bearer = req.headers.get("authorization")?.startsWith("Bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null;
    const header = req.headers.get("x-bootstrap-token")?.trim();
    if (bearer !== token && header !== token) {
      return { ok: false, status: 401, error: "Bootstrap token required (INIT_BOOTSTRAP_TOKEN)" };
    }
    return { ok: true, status: 200 };
  }
  // No token configured — require localhost.
  if (!isLocalhostRequest(req)) {
    return { ok: false, status: 403, error: "System initialization is only available from localhost (set INIT_BOOTSTRAP_TOKEN to allow remote setup)" };
  }
  return { ok: true, status: 200 };
}

const DEFAULT_DOCTOR = {
  fullName: "Demo Doctor",
  specialization: "Oncologist-Geneticist",
  doctorCode: "VR-001",
} as const;

// ---------------------------------------------------------------------------
// One-time password generation — 18 chars, base32-ish (avoids ambiguous chars)
// ---------------------------------------------------------------------------

function generateOneTimeAdminPassword(): string {
  // 12 bytes of entropy → 24 base32 chars; we trim to 18 for usability.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
  const bytes = randomBytes(18);
  let out = "";
  for (let i = 0; i < 18; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  // Insert hyphens every 6 chars for readability: XXXXXX-XXXXXX-XXXXXX
  return `${out.slice(0, 6)}-${out.slice(6, 12)}-${out.slice(12, 18)}`;
}

// ---------------------------------------------------------------------------
// Chunked bulk insert helper — SQLite + Prisma's $transaction with N create()
// calls explodes the SQL plan cache and triggers "too many SQL variables"
// errors on large arrays. We chunk by BATCH_SIZE.
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;

async function bulkCreate<T>(
  factory: (item: T) => Promise<unknown>,
  items: readonly T[],
): Promise<number> {
  let created = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    // Use a regular loop inside the batch — $transaction's interactive form
    // also bloats the plan, so we just await sequentially in chunks of 50.
    for (const item of batch) {
      await factory(item);
      created++;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// GET /api/auth/init — initialization status (NEVER returns the password)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const doctorCount = await db.doctor.count();
    // v4.3 audit fix: return ONLY whether initialization is needed. Previously
    // this leaked adminExists / adminPasswordSet / adminActive / adminCode —
    // reconnaissance gold for an attacker deciding whether to attempt the
    // bootstrap. The frontend only needs `needsInit`.
    return NextResponse.json({
      needsInit: doctorCount === 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/init — initialize system
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: gate first-run setup behind a bootstrap token or
    // localhost. Prevents an attacker from capturing the one-time admin
    // password on a fresh deployment before the operator does.
    const auth = checkBootstrapAuth(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const doctorCount = await db.doctor.count();

    // Scenario 3: already initialized — refuse to re-init via this endpoint.
    // Password reset must use the dedicated /api/auth?action=set-password flow.
    if (doctorCount > 0) {
      const existingAdmin = await db.doctor.findUnique({
        where: { doctorCode: ADMIN_DOCTOR_CODE },
      });
      if (existingAdmin) {
        return NextResponse.json({
          initialized: false,
          scenario: "already_initialized",
          message:
            "System already initialized. Admin exists. Use password reset flow if you forgot the admin password.",
          admin: { doctorCode: ADMIN_DOCTOR_CODE, password: null, fullName: ADMIN_FULL_NAME, passwordSet: !!existingAdmin.passwordHash },
          doctorCount,
        });
      }
    }

    // Generate one-time admin password for THIS initialization only.
    const oneTimePassword = generateOneTimeAdminPassword();
    const adminPasswordHash = await bcrypt.hash(oneTimePassword, 12);

    // ─── Scenario 1: First run (empty DB) — full seed ───────────────────
    if (doctorCount === 0) {
      await db.doctor.create({ data: { ...DEFAULT_DOCTOR } });

      await db.doctor.create({
        data: {
          fullName: ADMIN_FULL_NAME,
          specialization: ADMIN_SPECIALIZATION,
          doctorCode: ADMIN_DOCTOR_CODE,
          role: "admin",
          passwordHash: adminPasswordHash,
          isActive: true,
        },
      });

      // Seed clinical KB in chunks
      const recCount = await bulkCreate(
        (rec) =>
          db.clinicalRecommendation.create({
            data: {
              title: rec.title,
              category: rec.category,
              gene: rec.gene ?? null,
              mutation: rec.mutation ?? null,
              content: rec.content,
              keywords: rec.keywords,
              source: rec.source,
              evidenceLevel: rec.evidenceLevel,
            },
          }),
        clinicalRecommendations,
      );

      const icdCount = await bulkCreate(
        (code) =>
          db.iCD10Code.create({
            data: {
              code: code.code,
              description: code.description,
              chapter: code.chapter,
              block: code.block,
              parentCode: code.parentCode,
            },
          }),
        icd10Codes,
      );

      const ddiCount = await bulkCreate(
        (di) =>
          db.drugInteraction.create({
            data: {
              drug1: di.drug1,
              drug2: di.drug2,
              severity: di.severity,
              description: di.description,
              mechanism: di.mechanism,
              management: di.management,
              evidenceLevel: di.evidenceLevel,
              source: di.source,
            },
          }),
        drugInteractions,
      );

      const pathwayCount = await bulkCreate(
        (cp) =>
          db.clinicalPathway.create({
            data: {
              name: cp.name,
              icd10Code: cp.icd10Code,
              category: cp.category,
              description: cp.description,
              steps: JSON.stringify(cp.steps),
              criteria: JSON.stringify(cp.criteria),
              medications: JSON.stringify(cp.medications),
              monitoring: JSON.stringify(cp.monitoring),
              source: cp.source,
              version: cp.version,
            },
          }),
        clinicalPathways,
      );

      // ── Seed demo patient with full EMR ──────────────────────────────
      const demoDoctor = await db.doctor.findFirst({ where: { doctorCode: DEFAULT_DOCTOR.doctorCode } });
      const demoDoctorId = demoDoctor!.id;

      const patient = await db.patient.create({
        data: {
          patientToken: DEMO_PATIENT.token,
          lastName: DEMO_PATIENT.lastName,
          firstName: DEMO_PATIENT.firstName,
          middleName: DEMO_PATIENT.middleName,
          // v2.6: birthDate — String (E2EE-поле). Демо-данные создаются в
          // открытом виде и автоматически пере-шифруются при первом входе
          // врача (легаси-миграция в браузере).
          birthDate: DEMO_PATIENT.birthDate,
          birthYear: new Date(DEMO_PATIENT.birthDate).getFullYear(),
          sex: DEMO_PATIENT.sex,
          bloodType: DEMO_PATIENT.bloodType,
          height: DEMO_PATIENT.height,
          weight: DEMO_PATIENT.weight,
          nationality: DEMO_PATIENT.nationality,
          occupation: DEMO_PATIENT.occupation,
          smokingStatus: DEMO_PATIENT.smokingStatus,
          alcoholUse: DEMO_PATIENT.alcoholUse,
          allergies: DEMO_PATIENT.allergies,
          chronicDiseases: DEMO_PATIENT.chronicDiseases,
          familyHistory: DEMO_PATIENT.familyHistory,
          status: DEMO_PATIENT.status,
          notes: DEMO_PATIENT.notes,
          primaryDoctorId: demoDoctorId,
        },
      });

      const demoCase = await db.case.create({
        data: {
          caseCode: DEMO_CASE.caseCode,
          patientToken: DEMO_CASE.patientToken,
          birthYear: DEMO_CASE.birthYear,
          sex: DEMO_CASE.sex,
          status: DEMO_CASE.status,
          diagnosisHint: DEMO_CASE.diagnosisHint,
          notes: DEMO_CASE.notes,
          doctorId: demoDoctorId,
          patientId: patient.id,
          icd10Codes: JSON.stringify([
            { code: "C50.9", description: "Злокачественное новообразование молочной железы" },
            { code: "C77.3", description: "Поражение лимфоузлов подмышечной области" },
          ]),
        },
      });

      // Visit
      await db.visit.create({
        data: {
          patientId: patient.id,
          doctorId: demoDoctorId,
          caseId: demoCase.id,
          visitType: DEMO_VISIT.visitType,
          status: DEMO_VISIT.status,
          chiefComplaint: DEMO_VISIT.chiefComplaint,
          visitReason: DEMO_VISIT.visitReason,
          soapSubjective: DEMO_VISIT.soapSubjective,
          soapObjective: DEMO_VISIT.soapObjective,
          soapAssessment: DEMO_VISIT.soapAssessment,
          soapPlan: DEMO_VISIT.soapPlan,
          diagnosis: DEMO_VISIT.diagnosis,
          prescriptions: DEMO_VISIT.prescriptions,
          scheduledAt: new Date(DEMO_VISIT.scheduledAt),
          startedAt: new Date(DEMO_VISIT.startedAt),
          completedAt: new Date(DEMO_VISIT.completedAt),
          durationMin: DEMO_VISIT.durationMin,
        },
      });

      // Vital signs (4 readings for trends)
      for (const vs of DEMO_VITAL_SIGNS) {
        await db.vitalSign.create({
          data: {
            patientId: patient.id,
            recordedById: demoDoctorId,
            recordedAt: new Date(vs.recordedAt),
            systolicBP: vs.systolicBP,
            diastolicBP: vs.diastolicBP,
            heartRate: vs.heartRate,
            respiratoryRate: vs.respiratoryRate,
            temperature: vs.temperature,
            oxygenSaturation: vs.oxygenSaturation,
            height: vs.height,
            weight: vs.weight,
            bmi: vs.bmi,
            painScore: vs.painScore ?? 0,
            notes: vs.notes,
          },
        });
      }

      // Medications (5 drugs, including completed chemo)
      for (const med of DEMO_MEDICATIONS) {
        await db.medication.create({
          data: {
            patientId: patient.id,
            prescriberId: demoDoctorId,
            drugName: med.drugName,
            brandName: med.brandName,
            form: med.form,
            dosage: med.dosage,
            route: med.route,
            frequency: med.frequency,
            duration: med.duration,
            startDate: new Date(med.startDate),
            endDate: med.endDate ? new Date(med.endDate) : null,
            status: med.status,
            indication: med.indication,
            notes: med.notes,
          },
        });
      }

      // Lab results (15 tests)
      for (const lab of DEMO_LAB_RESULTS) {
        await db.labResult.create({
          data: {
            patientId: patient.id,
            testName: lab.testName,
            testCode: lab.testCode,
            category: lab.category,
            value: lab.value,
            numericValue: lab.numericValue,
            unit: lab.unit,
            refRangeLow: lab.refRangeLow,
            refRangeHigh: lab.refRangeHigh,
            flag: lab.flag,
            specimen: lab.specimen,
            collectedAt: new Date(lab.collectedAt),
            notes: lab.notes ?? "",
          },
        });
      }

      // Problems (5 diagnoses)
      for (const prob of DEMO_PROBLEMS) {
        await db.problem.create({
          data: {
            patientId: patient.id,
            title: prob.title,
            icd10: prob.icd10,
            category: prob.category,
            status: prob.status,
            severity: prob.severity,
            onsetDate: new Date(prob.onsetDate),
            description: prob.description,
            isPrimary: prob.isPrimary,
          },
        });
      }

      // Care plan
      await db.carePlan.create({
        data: {
          patientId: patient.id,
          problemId: (await db.problem.findFirst({ where: { patientId: patient.id, isPrimary: true } }))!.id,
          title: DEMO_CARE_PLAN.title,
          type: DEMO_CARE_PLAN.type,
          status: DEMO_CARE_PLAN.status,
          goals: DEMO_CARE_PLAN.goals,
          interventions: DEMO_CARE_PLAN.interventions,
          doctorId: demoDoctorId,
          notes: DEMO_CARE_PLAN.notes,
        },
      });

      // AI Analysis result
      await db.analysisResult.create({
        data: {
          caseId: demoCase.id,
          ...DEMO_ANALYSIS,
        },
      });

      // Consent
      await db.consent.create({
        data: {
          caseId: demoCase.id,
          doctorId: demoDoctorId,
          consentType: DEMO_CONSENT.consentType,
          granted: DEMO_CONSENT.granted,
          notes: DEMO_CONSENT.notes,
        },
      });

      // Notification for demo doctor
      await db.notification.create({
        data: {
          doctorId: demoDoctorId,
          type: DEMO_NOTIFICATION.type,
          title: DEMO_NOTIFICATION.title,
          message: DEMO_NOTIFICATION.message,
          caseId: demoCase.id,
        },
      });

      logger.info("init", "System initialized (first_run)", {
        doctorCount: 2,
        recCount,
        icdCount,
        ddiCount,
        pathwayCount,
        demoPatient: DEMO_PATIENT.token,
        demoCase: DEMO_CASE.caseCode,
      });

      return NextResponse.json({
        initialized: true,
        scenario: "first_run",
        message:
          "System initialized. Admin, demo doctor, and demo patient (EMR + case + AI analysis) created. SAVE the admin password now — it will not be shown again.",
        admin: {
          doctorCode: ADMIN_DOCTOR_CODE,
          password: oneTimePassword, // shown exactly once
          fullName: ADMIN_FULL_NAME,
          mustRotate: true,
        },
        doctorCount: 2,
        counts: {
          recommendations: recCount,
          icd10Codes: icdCount,
          drugInteractions: ddiCount,
          clinicalPathways: pathwayCount,
          expected: {
            recommendations: CLINICAL_RECOMMENDATIONS_COUNT,
            icd10Codes: ICD10_CODES_COUNT,
            drugInteractions: DRUG_INTERACTIONS_COUNT,
            clinicalPathways: CLINICAL_PATHWAYS_COUNT,
          },
          demoPatient: DEMO_PATIENT.token,
          demoCase: DEMO_CASE.caseCode,
        },
      });
    }

    // ─── Scenario 2: Doctors exist but no admin — create admin only ──────
    await db.doctor.create({
      data: {
        fullName: ADMIN_FULL_NAME,
        specialization: ADMIN_SPECIALIZATION,
        doctorCode: ADMIN_DOCTOR_CODE,
        role: "admin",
        passwordHash: adminPasswordHash,
        isActive: true,
      },
    });

    logger.info("init", "Admin created (admin_only)", { doctorCount: doctorCount + 1 });

    return NextResponse.json({
      initialized: true,
      scenario: "admin_only",
      message:
        "Admin profile created with a one-time password. Existing data preserved. SAVE the password now — it will not be shown again.",
      admin: {
        doctorCode: ADMIN_DOCTOR_CODE,
        password: oneTimePassword, // shown exactly once
        fullName: ADMIN_FULL_NAME,
        mustRotate: true,
      },
      doctorCount: doctorCount + 1,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    logger.error("init", "Init failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
