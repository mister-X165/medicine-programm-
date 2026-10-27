// СППВР v2.0 — Audit Export API
// GET /api/audit/export?format=csv|pdf — Export audit log as CSV or PDF

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // v4.3 audit fix: audit export contains every doctor's IPs/actions — admin.
    const session = await requireAdmin(req);

    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "csv";
    const action = url.searchParams.get("action");
    const caseId = url.searchParams.get("caseId");
    const doctorId = url.searchParams.get("doctorId");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    // v2.2 (Task 2-b): build with AND array so date range + doctor filter
    // compose cleanly. The export honors the same filter contract as the
    // main /api/audit GET handler so the exported file matches the UI view.
    const andClauses: Record<string, unknown>[] = [];
    if (action) andClauses.push({ action });
    if (caseId) andClauses.push({ caseId });
    if (doctorId) andClauses.push({ doctorId });
    if (dateFrom || dateTo) {
      const createdAtRange: Record<string, Date> = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (!Number.isNaN(d.getTime())) createdAtRange.gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        if (!Number.isNaN(d.getTime())) {
          d.setUTCHours(23, 59, 59, 999);
          createdAtRange.lte = d;
        }
      }
      if (Object.keys(createdAtRange).length > 0) {
        andClauses.push({ createdAt: createdAtRange });
      }
    }
    const where: Record<string, unknown> =
      andClauses.length === 0
        ? {}
        : andClauses.length === 1
          ? andClauses[0]!
          : { AND: andClauses };

    const logs = await db.auditLog.findMany({
      where,
      include: {
        case: { select: { id: true, caseCode: true } },
        doctor: { select: { id: true, fullName: true, doctorCode: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    if (format === "csv") {
      const headers = ["ID", "Date", "Action", "Details", "Case Code", "Doctor", "Doctor Code"];
      const rows = logs.map((log) => [
        log.id,
        log.createdAt.toISOString(),
        log.action,
        `"${(log.details || "").replace(/"/g, '""')}"`,
        log.case?.caseCode || "",
        log.doctor?.fullName || "",
        log.doctor?.doctorCode || "",
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const bom = "\uFEFF";
      const buffer = Buffer.from(bom + csv, "utf-8");

      logger.info("audit", "Audit log exported as CSV", { count: logs.length, doctorId: session.doctorId });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    // JSON format — return a structured JSON document. (Full PDF export
    // would use the pdf-generator module; for now JSON is the second
    // supported format alongside CSV.)
    if (format === "json") {
      const payload = {
        format: "json",
        exportedAt: new Date().toISOString(),
        count: logs.length,
        logs: logs.map((log) => ({
          id: log.id,
          action: log.action,
          details: log.details,
          createdAt: log.createdAt.toISOString(),
          caseCode: log.case?.caseCode ?? null,
          doctorName: log.doctor?.fullName ?? null,
          doctorCode: log.doctor?.doctorCode ?? null,
        })),
      };
      const buffer = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
      logger.info("audit", "Audit log exported as JSON", { count: logs.length, doctorId: session.doctorId });
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.json"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    // Unknown format — fall back to JSON metadata so the caller gets a
    // useful response instead of a silent CSV.
    return NextResponse.json({
      format,
      message: "Unsupported format. Use format=csv or format=json.",
      count: logs.length,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
