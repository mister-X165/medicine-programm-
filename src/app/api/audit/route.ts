// СППВР v2.0 — Audit Log API
// GET /api/audit?q=...&action=...&caseId=...&doctorId=...&dateFrom=...&dateTo=...&limit=...&offset=...
//
// SECURITY (v2.1):
//   - DELETE /api/audit has been REMOVED. The audit log is append-only (WORM)
//     to comply with ФЗ-152 ст. 18 ч. 3 (protection against unauthorized
//     modification/deletion) and HIPAA §164.312(c) (integrity).
//   - Old client calls to DELETE will get HTTP 405 Method Not Allowed.
//   - For retention/archival, use /api/audit/export (read-only) to take an
//     authenticated snapshot, then contact the DBA to archive rows older
//     than the retention horizon — that operation is performed OUTSIDE the
//     application layer and is itself audited.
//
// v2.2 (Task 2-b): added `dateFrom` / `dateTo` query params (ISO 8601) so
//   the UI can filter the log by an inclusive [dateFrom, dateTo] range.
//   Both bounds are optional; passing only one creates a half-open range.
//   Invalid date strings are silently ignored to keep the response
//   backward-compatible with existing callers that omit them.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Parse an ISO 8601 date string into a Date, returning null on invalid input. */
function parseDateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    // v4.3 audit fix: the full audit log contains every doctor's IP
    // addresses and actions — admin-only (defense-in-depth; the edge proxy
    // already gates /api/audit behind admin).
    await requireAdmin(req);

    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const action = url.searchParams.get("action");
    const caseId = url.searchParams.get("caseId");
    const doctorId = url.searchParams.get("doctorId");
    const dateFrom = parseDateOrNull(url.searchParams.get("dateFrom"));
    const dateTo = parseDateOrNull(url.searchParams.get("dateTo"));
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    // Build the WHERE clause using Prisma's AND array pattern so that the
    // createdAt range composes cleanly with the other filters. Each clause
    // is only pushed when its filter is present, keeping the response
    // backward-compatible with callers that don't pass any date bounds.
    const andClauses: Record<string, unknown>[] = [];
    if (q) andClauses.push({ details: { contains: q } });
    if (action) andClauses.push({ action });
    if (caseId) andClauses.push({ caseId });
    if (doctorId) andClauses.push({ doctorId });
    if (dateFrom || dateTo) {
      const createdAtRange: Record<string, Date> = {};
      if (dateFrom) createdAtRange.gte = dateFrom;
      if (dateTo) {
        // The UI passes a calendar day (YYYY-MM-DD). We extend the upper
        // bound to the end of that day so the range is inclusive.
        const endOfDay = new Date(dateTo);
        endOfDay.setUTCHours(23, 59, 59, 999);
        createdAtRange.lte = endOfDay;
      }
      andClauses.push({ createdAt: createdAtRange });
    }

    const where: Record<string, unknown> =
      andClauses.length === 0 ? {} : andClauses.length === 1 ? andClauses[0]! : { AND: andClauses };

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        include: {
          case: { select: { id: true, caseCode: true } },
          doctor: { select: { id: true, fullName: true, doctorCode: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        details: log.details,
        createdAt: log.createdAt.toISOString(),
        case: log.case ? { id: log.case.id, caseCode: log.case.caseCode } : null,
        doctor: log.doctor ? { id: log.doctor.id, fullName: log.doctor.fullName, doctorCode: log.doctor.doctorCode } : null,
      })),
      total,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE is intentionally NOT exported. Any DELETE request will receive a
// 405 Method Not Allowed from Next.js, which is the correct behavior for
// an immutable audit log.
