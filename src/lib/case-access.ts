// СППВР v2.1.4 — Case access helper
// ============================================================================
// Shared ownership check used by all `/api/cases/[id]/*` mutation routes.
//
// Previously most case routes only verified that the case existed, NOT that
// the requesting session had rights to it. Any logged-in doctor could PATCH,
// DELETE, upload documents to, share, generate reports for, or trigger
// therapy recommendations on ANY other doctor's case (IDOR).
//
// This helper extracts the session and enforces:
//   - 401 if no session
//   - admin sessions always pass
//   - non-admin sessions must own the case (case.doctorId === session.doctorId)
//   - non-admin sessions may also access cases that have been actively shared
//     with them via CaseShare (status: "active", toDoctorId: session.doctorId)
//     for read operations only; all mutations require owner/admin.
//
// Returns either `{ok: true, session}` (caller proceeds) or
// `{ok: false, response}` (caller returns the response directly).

import { NextResponse } from "next/server";
import { db } from "./db";
import { getSessionFromRequest, type JWTPayload } from "./auth";

export type CaseAccessResult =
  | { ok: true; session: JWTPayload }
  | { ok: false; response: NextResponse };

export async function requireCaseAccess(
  caseId: string,
  req: Request,
  permission: "read" | "edit" | "share" | "delete" = req.method === "GET" || req.method === "HEAD" ? "read" : "edit",
): Promise<CaseAccessResult> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      ),
    };
  }

  // Admins can access any case.
  if (session.role === "admin") {
    return { ok: true, session };
  }

  const c = await db.case.findUnique({
    where: { id: caseId },
    select: { doctorId: true },
  });
  if (!c) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Case not found" }, { status: 404 }),
    };
  }

  if (c.doctorId !== session.doctorId) {
    // Check if case is actively shared with this doctor.
    const share = await db.caseShare.findFirst({
      where: { caseId, toDoctorId: session.doctorId, status: "active" },
    });
    // Current shares grant read/comment only; mutations remain owner/admin only.
    if (!share || permission !== "read") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Not authorized to access this case" },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, session };
}

