// СППВР v2.0 — System Logs API
// GET  /api/logs — Get system logs with filtering and pagination
// GET  /api/logs?stats=1 — Get log statistics
// DELETE /api/logs — Delete logs (admin-only via middleware; requires a filter)
//
// SECURITY (v2.1):
//   - DELETE is admin-only (enforced by src/middleware.ts matcher).
//   - Refuses to "delete all" without a filter — caller MUST supply at least
//     one of beforeDate / level / category. This prevents catastrophic
//     bulk-wipe from a misclicked button.
//   - SystemLog (diagnostic) is distinct from AuditLog (compliance) — the
//     latter is fully immutable (no DELETE endpoint at all).

import { NextResponse } from "next/server";
import { logger, type LogLevel, type LogCategory } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // v4.3 audit fix: system logs may contain PHI/operational detail — admin.
    await requireAdmin(req);
    const url = new URL(req.url);

    if (url.searchParams.get("stats") === "1") {
      const stats = await logger.getLogStats();
      return NextResponse.json({ stats });
    }

    const level = url.searchParams.get("level") as LogLevel | null;
    const category = url.searchParams.get("category") as LogCategory | null;
    const search = url.searchParams.get("search") || undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const dateFrom = url.searchParams.get("dateFrom") ? new Date(url.searchParams.get("dateFrom")!) : undefined;
    const dateTo = url.searchParams.get("dateTo") ? new Date(url.searchParams.get("dateTo")!) : undefined;

    const result = await logger.getLogs({
      level: level || undefined,
      category: category || undefined,
      search,
      limit,
      offset,
      dateFrom,
      dateTo,
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    // v4.3 audit fix: admin-only (defense-in-depth; proxy already gates this).
    await requireAdmin(req);
    const url = new URL(req.url);
    const beforeDate = url.searchParams.get("beforeDate")
      ? new Date(url.searchParams.get("beforeDate")!)
      : undefined;
    const level = url.searchParams.get("level") as LogLevel | null;
    const category = url.searchParams.get("category") as LogCategory | null;

    // Refuse blanket "delete everything" — caller MUST supply a filter.
    if (!beforeDate && !level && !category) {
      return NextResponse.json(
        {
          error:
            "Refusing to delete all logs without a filter. Provide at least one of: beforeDate, level, category.",
        },
        { status: 400 },
      );
    }

    const count = await logger.deleteLogs({
      beforeDate,
      level: level || undefined,
      category: category || undefined,
    });

    return NextResponse.json({ deleted: count });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
