// СППВР v2.2 — Audit Log Hash-Chain Integrity Verification
// GET /api/audit/verify — walks the WORM hash-chain and reports the first
// broken link (if any). Used by the UI's "Проверить целостность" button.
//
// SECURITY: read-only, requires authentication. The verification itself
// never mutates the audit log; it only recomputes SHA-256 hashes of each
// row and compares them to the stored `hash` column.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { verifyAuditChain } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // v4.3 audit fix: chain verification is a CPU-intensive admin operation.
    const session = await requireAdmin(req);

    const result = await verifyAuditChain();

    logger.info("audit", "Audit chain verification performed", {
      doctorId: session.doctorId,
      ok: result.ok,
      verified: result.verified,
    });

    return NextResponse.json({
      ok: result.ok,
      verified: result.verified,
      brokenAt: result.brokenAt,
      checkedAt: new Date().toISOString(),
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
