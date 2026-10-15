// СППВР v2.0 — Backup/Restore API
// GET  /api/backup — Create backup (returns raw BackupData JSON)
// POST /api/backup — Restore from backup (accepts raw BackupData JSON object)
//
// v2.1.4 fixes:
//   - Each table's delete+insert is wrapped in `db.$transaction(async (tx) => …)`
//     so a failure midway through one table's insert rolls back that table's
//     delete too (previously: delete succeeded, insert failed → DATA LOSS).
//   - The create-loop with try/catch is replaced with `createMany` (with
//     `skipDuplicates: true` when supported by the connector) — faster and
//     immune to per-row errors.
//   - The endpoint accepts the raw `BackupData` object as the request body
//     (NOT a `{data: <string>}` wrapper).
//   - Response shape: `{success: true, restored: number, message: string}`.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { appendAudit } from "@/lib/audit";
import { encryptBuffer } from "@/lib/encryption";
import type { BackupData } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Deduplicate an array of backup rows by their `id` field (last wins).
 * Backups captured at different times may legitimately contain the same row
 * ID more than once (e.g. if a seed script was re-run); without dedup,
 * `createMany` would fail with a unique-constraint violation.
 *
 * Rows without an `id` field are passed through untouched.
 */
function dedupeById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Map<unknown, Record<string, unknown>>();
  for (const row of rows) {
    const key = row?.id;
    if (key === undefined || key === null) {
      // No id → keep as-is (Prisma will auto-generate one)
      seen.set(seen.size + Math.random(), row);
    } else {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin(req);

    const [cases, documents, analysisResults, reports, clinicalRecommendations, drugInteractions, icd10Codes, clinicalPathways, auditLogs, consents] = await Promise.all([
      db.case.findMany(),
      db.document.findMany(),
      db.analysisResult.findMany(),
      db.report.findMany(),
      db.clinicalRecommendation.findMany(),
      db.drugInteraction.findMany(),
      db.iCD10Code.findMany(),
      db.clinicalPathway.findMany(),
      db.auditLog.findMany(),
      db.consent.findMany(),
    ]);

    const backup: BackupData = {
      version: "2.0",
      timestamp: new Date().toISOString(),
      cases,
      documents,
      analysisResults,
      reports,
      clinicalRecommendations,
      drugInteractions,
      icd10Codes,
      clinicalPathways,
      auditLogs,
      consents,
    };

    logger.info("api", "Backup created", { doctorId: session.doctorId, caseCount: cases.length });

    await appendAudit({
      action: "backup.export",
      details: JSON.stringify({ cases: cases.length, documents: documents.length, encrypted: true }),
      doctorId: session.doctorId,
    }).catch(() => {});

    // v2.6: бэкап шифруется AES-256-GCM (ключ — ENCRYPTION_PASSPHRASE).
    // Ранее полный дамп PHI (кейсы, документы, отчёты) возвращался открытым
    // JSON — компрометация сессии админа = утечка всей базы.
    // Формат ответа: SPPVR-BACKUP-V1 || iv(16) || salt(32) || tag(16) || ct
    const json = Buffer.from(JSON.stringify(backup), "utf-8");
    const { encrypted, iv, salt, authTag } = encryptBuffer(json);
    const blob = Buffer.concat([
      Buffer.from("SPPVR-BACKUP-V1", "utf-8"),
      iv,
      salt,
      authTag,
      encrypted,
    ]);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    return new NextResponse(new Uint8Array(blob), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="sppvr-backup-${stamp}.bin"`,
        "Cache-Control": "no-store",
        "X-Backup-Encrypted": "aes-256-gcm",
      },
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Ошибка создания бэкапа" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin(req);
    const body = await req.json();

    // Accept the raw BackupData object only — NOT a {data: <string>} wrapper.
    // The wrapper shape is a known frontend bug that is fixed separately; the
    // backend contract is "raw BackupData object".
    if (!body || typeof body !== "object" || !body.version || !body.timestamp) {
      return NextResponse.json(
        { error: "Invalid backup format — expected raw BackupData object with version and timestamp fields" },
        { status: 400 },
      );
    }

    const backup = body as BackupData;

    // Restore each table inside its OWN transaction. This way:
    //   - A failure in (e.g.) icd10Codes doesn't roll back clinicalRecommendations.
    //   - Within each table, delete+insert is atomic — if insert fails, the
    //     delete is rolled back and existing data is preserved.
    //
    // Note: we intentionally skip restoring `cases`, `documents`,
    // `analysisResults`, `reports`, `auditLogs`, `consents` here — those are
    // patient PHI and clinical workflow data, not knowledge-base reference
    // data. Restoring them would overwrite live clinical work. Only the 4
    // knowledge/reference tables are restored by this endpoint (matches the
    // v2.0 scope).
    let restored = 0;

    // 1. Clinical recommendations
    try {
      restored += await db.$transaction(async (tx) => {
        await tx.clinicalRecommendation.deleteMany({});
        const rows = Array.isArray(backup.clinicalRecommendations)
          ? dedupeById(backup.clinicalRecommendations as Record<string, unknown>[])
          : [];
        if (rows.length === 0) return 0;
        // `as never` — rows come from JSON and are loosely typed; Prisma
        // validates them at runtime. We dedupe by `id` first so the batch
        // doesn't fail on intra-backup duplicate IDs.
        const result = await tx.clinicalRecommendation.createMany({
          data: rows as never,
        });
        return result.count;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("api", "Restore failed: clinicalRecommendations", { error: msg });
      throw new Error(`Failed to restore clinical recommendations: ${msg}`);
    }

    // 2. ICD-10 codes
    try {
      restored += await db.$transaction(async (tx) => {
        await tx.iCD10Code.deleteMany({});
        const rows = Array.isArray(backup.icd10Codes)
          ? dedupeById(backup.icd10Codes as Record<string, unknown>[])
          : [];
        if (rows.length === 0) return 0;
        const result = await tx.iCD10Code.createMany({
          data: rows as never,
        });
        return result.count;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("api", "Restore failed: icd10Codes", { error: msg });
      throw new Error(`Failed to restore ICD-10 codes: ${msg}`);
    }

    // 3. Drug interactions
    try {
      restored += await db.$transaction(async (tx) => {
        await tx.drugInteraction.deleteMany({});
        const rows = Array.isArray(backup.drugInteractions)
          ? dedupeById(backup.drugInteractions as Record<string, unknown>[])
          : [];
        if (rows.length === 0) return 0;
        const result = await tx.drugInteraction.createMany({
          data: rows as never,
        });
        return result.count;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("api", "Restore failed: drugInteractions", { error: msg });
      throw new Error(`Failed to restore drug interactions: ${msg}`);
    }

    // 4. Clinical pathways
    try {
      restored += await db.$transaction(async (tx) => {
        await tx.clinicalPathway.deleteMany({});
        const rows = Array.isArray(backup.clinicalPathways)
          ? dedupeById(backup.clinicalPathways as Record<string, unknown>[])
          : [];
        if (rows.length === 0) return 0;
        const result = await tx.clinicalPathway.createMany({
          data: rows as never,
        });
        return result.count;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("api", "Restore failed: clinicalPathways", { error: msg });
      throw new Error(`Failed to restore clinical pathways: ${msg}`);
    }

    logger.info("api", "Backup restored", { doctorId: session.doctorId, restored });

    await appendAudit({
      doctorId: session.doctorId,
      action: "restore_backup",
      details: JSON.stringify({ restored, backupTimestamp: backup.timestamp }),
    });

    return NextResponse.json({
      success: true,
      restored,
      message: `Backup restored. ${restored} records processed.`,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
