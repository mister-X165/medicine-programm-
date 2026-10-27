// СППВР — File Encryption API
// POST /api/encryption — Encrypt all uploaded files
// GET /api/encryption — Get encryption status (+ E2EE coverage с v2.6.2)

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { encryptAllUploads } from "@/lib/encryption";
import { db } from "@/lib/db";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // v4.3 audit fix: encryption status leaks legacy plaintext patient count — admin.
  try {
    await requireAdmin(req);
  // SECURITY (v2.1.4): previously this checked `public/uploads/`, but the
  // storage layer (`src/lib/storage.ts`) writes ALL uploads to
  // `private-storage/uploads/`. The status endpoint therefore always
  // reported `totalFiles: 0, encryptedFiles: 0` even when files existed.
  // This made the "Encrypt All" button's "isFullyEncrypted" badge useless.
  const uploadDir = path.join(process.cwd(), "private-storage", "uploads");
  let totalFiles = 0;
  let encryptedFiles = 0;
  let unencryptedFiles = 0;

  if (existsSync(uploadDir)) {
    const files = readdirSync(uploadDir);
    for (const file of files) {
      // `.enc` files are the encrypted payload; `.meta` files are the
      // per-file key/material metadata written by `encryptFile()`. We count
      // `.enc` as encrypted; everything that is NOT `.enc` and NOT `.meta`
      // is an unencrypted original.
      if (file.endsWith(".enc")) {
        encryptedFiles++;
      } else if (!file.endsWith(".meta")) {
        unencryptedFiles++;
      }
    }
    totalFiles = encryptedFiles + unencryptedFiles;
  }

  // v2.6.2: E2EE Coverage — сервер видит ШИФРОТЕКСТ напрямую (zero-knowledge:
  // статус шифрования ≠ расшифровка). Считаем карты с enc:v1: в БД.
  const patientsAll = await db.patient.findMany({
    select: { lastName: true, notes: true, phone: true },
  });
  const e2eeEncrypted = patientsAll.filter(
    (p) =>
      typeof p.lastName === "string" && p.lastName.startsWith("enc:v1:"),
  ).length;
  const e2eeCoverage = {
    total: patientsAll.length,
    encrypted: e2eeEncrypted,
    legacy: patientsAll.length - e2eeEncrypted,
    pct: patientsAll.length > 0 ? Math.round((e2eeEncrypted / patientsAll.length) * 100) : 100,
  };

  return NextResponse.json({
    totalFiles,
    encryptedFiles,
    unencryptedFiles,
    isFullyEncrypted: unencryptedFiles === 0 && totalFiles > 0,
    algorithm: "AES-256-GCM",
    e2eeCoverage,
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

export async function POST(req: Request) {
  try {
    const session = await requireAdmin(req);

    const result = await encryptAllUploads();

    logger.info("encryption", "File encryption triggered by admin", {
      adminId: session.doctorId,
      ...result,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const message = e instanceof Error ? e.message : "Internal server error";
    logger.error("encryption", "File encryption API error", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
