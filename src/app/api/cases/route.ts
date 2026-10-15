// СППВР v2.0 — Cases API
// GET  /api/cases — List all cases
// POST /api/cases — Create new case
//
// SECURITY (v2.1):
//   - Authentication is enforced by src/middleware.ts (every /api/* route
//     requires a valid JWT except /api/auth and /api/health).
//   - The case is always attributed to the authenticated doctor from the
//     session token. The legacy `doctorId` field in the request body is
//     IGNORED — accepting it would let any doctor file cases under a
//     colleague's name (privilege attribution bug).
//   - Admins may optionally specify `doctorId` to assign a case to another
//     doctor (e.g. when importing historical cases).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateCaseCode, safeJsonParse } from "@/lib/utils";
import { createCaseSchema, validateOrThrow } from "@/lib/validation";
import { getSessionFromRequest } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Middleware already verified the JWT; re-extract the session to scope
  // the query (a regular doctor only sees their own cases; admins see all).
  // SECURITY (audit 6-b / #1): if the session can't be re-resolved here
  // (e.g. doctor was deactivated or password changed mid-flight, the JWT
  // was revoked at DB level via tokenVersion bump, or the DB is unreachable)
  // we MUST reject the request with 401. Previously the route silently fell
  // back to `where = {}` (admin scope) and returned every case in the DB —
  // a cross-doctor PHI leak.
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  const where = session.role !== "admin" ? { doctorId: session.doctorId } : {};

  const cases = await db.case.findMany({
    where,
    include: {
      doctor: { select: { id: true, fullName: true, specialization: true } },
      _count: { select: { documents: true, reports: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const result = cases.map((c) => ({
    id: c.id,
    caseCode: c.caseCode,
    patientToken: c.patientToken,
    birthYear: c.birthYear,
    sex: c.sex,
    status: c.status,
    diagnosisHint: c.diagnosisHint,
    notes: c.notes,
    icd10Codes: safeJsonParse(c.icd10Codes, []),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    doctor: c.doctor,
    _count: c._count,
  }));

  return NextResponse.json({ cases: result });
}

export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const data = validateOrThrow(createCaseSchema, body);

    // Determine the owning doctor. Admins may reassign via body.doctorId;
    // everyone else is bound to their own session identity.
    const requestedDoctorId = (body as Record<string, unknown>).doctorId as string | undefined;
    let docId = session.doctorId;
    if (requestedDoctorId && session.role === "admin") {
      docId = requestedDoctorId;
    }

    // Verify the chosen doctor actually exists.
    const owner = await db.doctor.findUnique({ where: { id: docId }, select: { id: true } });
    if (!owner) {
      return NextResponse.json({ error: "Owning doctor not found. Run initialization." }, { status: 400 });
    }

    const caseCode = generateCaseCode();
    const patientToken = `PT-${Date.now().toString(36).toUpperCase()}`;

    // v2.3.2 (Task 4): persist ICD-10 codes manually pre-assigned by admin.
    // The column is a JSON-encoded string (see prisma/schema.prisma); we
    // normalize to {code, description, confidence, source} objects and
    // strip anything that would break the GET serializer's safeJsonParse.
    const icd10CodesRaw = Array.isArray(data.icd10Codes) ? data.icd10Codes : [];
    const icd10Codes = JSON.stringify(
      icd10CodesRaw.map((c) => ({
        code: String(c.code),
        description: String(c.description),
        confidence: typeof c.confidence === "number" ? c.confidence : 1,
        source: c.source === "ai" ? "ai" : "manual",
      })),
    );

    // v2.5.1: optional link to an EMR Patient record. When patientId is
    // provided, the case is associated with the patient's medical card and
    // we pre-fill demographics from the patient record (if not overridden).
    const patientIdRaw = (body as Record<string, unknown>).patientId as string | undefined;
    let patientId: string | null = null;
    let birthYear = data.birthYear ?? null;
    let sex = data.sex ?? null;
    if (patientIdRaw) {
      const patient = await db.patient.findUnique({
        where: { id: patientIdRaw },
        select: { id: true, birthDate: true, sex: true, lastName: true, firstName: true },
      });
      if (patient) {
        patientId = patient.id;
        if (!birthYear && patient.birthDate) {
          birthYear = new Date(patient.birthDate).getFullYear();
        }
        if (!sex && patient.sex) {
          // v2.7.2 (audit fix): E2EE-миграция может оставить произвольную строку —
          // приводим к допустимому значению перечисления.
          sex = patient.sex === "М" || patient.sex === "Ж" ? patient.sex : null;
        }
      }
    }

    const newCase = await db.case.create({
      data: {
        caseCode,
        patientToken,
        birthYear,
        sex,
        diagnosisHint: data.diagnosisHint ?? null,
        notes: data.notes ?? null,
        icd10Codes,
        doctorId: docId,
        patientId,
        status: "new",
      },
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true } },
      },
    });

    await appendAudit({
      caseId: newCase.id,
      doctorId: session.doctorId,
      action: "create_case",
      details: JSON.stringify({
        caseCode,
        owner: docId,
        icd10Count: icd10CodesRaw.length,
        reassigned: requestedDoctorId && session.role === "admin" && requestedDoctorId !== session.doctorId,
        patientId,
      }),
    });

    logger.info("cases", "Case created", { caseCode, owner: docId });

    return NextResponse.json({ case: newCase }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Validation error")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
