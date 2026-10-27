// СППВР — Prisma client singleton
// ============================================================================
// Auto-configures DATABASE_URL if missing so the app works out-of-the-box
// without a .env file (common on fresh Windows clones). The path is made
// Windows-safe by converting backslashes to forward slashes.

import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Auto-configure DATABASE_URL (Windows-safe, cross-platform)
// ---------------------------------------------------------------------------
// Prisma's schema.prisma declares `url = env("DATABASE_URL")`. If the user
// hasn't created a .env file, Prisma throws:
//   "Environment variable not found: DATABASE_URL"
//
// We fix this by setting process.env.DATABASE_URL BEFORE PrismaClient is
// constructed. The value is an absolute path to <project>/db/custom.db,
// with forward slashes (Prisma accepts this on Windows).
if (!process.env.DATABASE_URL) {
  const dbDir = path.join(process.cwd(), "db");
  if (!fs.existsSync(dbDir)) {
    try {
      fs.mkdirSync(dbDir, { recursive: true });
    } catch {
      // ignore — Prisma will throw a clearer error if it can't write
    }
  }
  const dbFile = path.join(dbDir, "custom.db");
  // Prisma SQLite URL: file:/absolute/path (forward slashes on all platforms)
  const safePath = dbFile.replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${safePath}`;
  console.info(
    `[db] DATABASE_URL not set — using default: ${process.env.DATABASE_URL}`,
  );
}

// ---------------------------------------------------------------------------
// Prisma client singleton (prevents connection exhaustion in dev HMR)
// ---------------------------------------------------------------------------
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
