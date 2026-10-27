// СППВР — ENCRYPTION_KEY rotation utility (incident response tooling)
// =============================================================================
// Incident 2025-09-07: the .env file leaked during a demo, which compromised
// the ENCRYPTION_KEY passphrase used for AES-256-GCM (scrypt-derived) file
// encryption in private-storage/. After rotating the passphrase in .env, any
// files encrypted under the OLD passphrase must be re-encrypted under the NEW
// one, otherwise they become unreadable.
//
// Usage (run from the project root):
//   bun scripts/rotate-encryption-key.ts <OLD_PASSPHRASE>
//
// Safety:
//   - The OLD passphrase is taken ONLY from the CLI argument (never written
//     to disk); the NEW passphrase is read from process.env.ENCRYPTION_KEY
//     (i.e. the fresh value in .env).
//   - For every *.enc + *.enc.meta pair: decrypt with the old key, re-encrypt
//     with the new key, verify the round-trip, and only then replace the
//     stored files. A failed decrypt leaves the file untouched and reported.
//   - Dry-run mode:  bun scripts/rotate-encryption-key.ts <OLD> --dry-run

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFile, writeFile, readdir, rename, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

const oldPassphrase = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!oldPassphrase || oldPassphrase.length < 32) {
  console.error(
    "Usage: bun scripts/rotate-encryption-key.ts <OLD_PASSPHRASE> [--dry-run]\n" +
      "The OLD passphrase must be at least 32 characters.",
  );
  process.exit(1);
}

// Load .env manually (no dotenv dependency): read DATABASE_URL-style file.
function loadEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(p)) return out;
  const raw = readFileSyncText(p);
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) {
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function readFileSyncText(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("fs").readFileSync(p, "utf-8");
}

const env = loadEnvFile(path.join(process.cwd(), ".env"));
const newPassphrase = process.env.ENCRYPTION_KEY || env.ENCRYPTION_KEY;

if (!newPassphrase || newPassphrase.length < 64) {
  console.error(
    "[rotate] FATAL: new ENCRYPTION_KEY missing or too short (<64 chars). " +
      "Set the rotated value in .env first (openssl rand -hex 32).",
  );
  process.exit(1);
}
if (newPassphrase === oldPassphrase) {
  console.error("[rotate] FATAL: new passphrase equals the old one — nothing to rotate.");
  process.exit(1);
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

interface Meta {
  iv: string;
  salt: string;
  authTag: string;
  originalSize: number;
  algorithm: string;
  encryptedAt: string;
}

async function main() {
  const storageDir = path.join(process.cwd(), "private-storage");
  if (!existsSync(storageDir)) {
    console.log("[rotate] private-storage/ not found — nothing to re-encrypt. Done.");
    return;
  }

  const files = await collectEncFiles(storageDir);
  console.log(`[rotate] found ${files.length} encrypted file(s).${dryRun ? " (DRY RUN)" : ""}`);

  let rekeyed = 0;
  let failed = 0;

  for (const { encPath, metaPath } of files) {
    try {
      const encrypted = await readFile(encPath);
      const meta: Meta = JSON.parse(await readFile(metaPath, "utf-8"));

      // 1. Decrypt with the OLD passphrase.
      const oldKey = deriveKey(oldPassphrase, Buffer.from(meta.salt, "base64"));
      const decipher = createDecipheriv(ALGORITHM, oldKey, Buffer.from(meta.iv, "base64"), {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(Buffer.from(meta.authTag, "base64"));
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      if (plaintext.length !== meta.originalSize) {
        throw new Error(`size mismatch after decrypt: ${plaintext.length} != ${meta.originalSize}`);
      }

      // 2. Re-encrypt with the NEW passphrase (fresh IV + salt).
      const iv = randomBytes(IV_LENGTH);
      const salt = randomBytes(SALT_LENGTH);
      const newKey = deriveKey(newPassphrase, salt);
      const cipher = createCipheriv(ALGORITHM, newKey, iv, { authTagLength: AUTH_TAG_LENGTH });
      const reEncrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // 3. Verify round-trip with the NEW key before replacing anything.
      const check = createDecipheriv(ALGORITHM, newKey, iv, { authTagLength: AUTH_TAG_LENGTH });
      check.setAuthTag(authTag);
      const verified = Buffer.concat([check.update(reEncrypted), check.final()]);
      if (!verified.equals(plaintext)) {
        throw new Error("round-trip verification failed");
      }

      if (dryRun) {
        console.log(`[rotate] would re-key: ${path.relative(process.cwd(), encPath)}`);
        rekeyed++;
        continue;
      }

      // 4. Atomically-ish replace: write .new files, verify, then swap.
      await writeFile(encPath + ".new", reEncrypted);
      await writeFile(metaPath + ".new", JSON.stringify({
        iv: iv.toString("base64"),
        salt: salt.toString("base64"),
        authTag: authTag.toString("base64"),
        originalSize: plaintext.length,
        algorithm: ALGORITHM,
        encryptedAt: new Date().toISOString(),
      }, null, 2));
      await rename(encPath + ".new", encPath);
      await rename(metaPath + ".new", metaPath);

      console.log(`[rotate] re-keyed: ${path.relative(process.cwd(), encPath)}`);
      rekeyed++;
    } catch (e) {
      failed++;
      console.error(`[rotate] FAILED (left untouched): ${path.relative(process.cwd(), encPath)} — ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`[rotate] done. re-keyed=${rekeyed} failed=${failed}`);
  if (failed > 0) process.exit(2);
}

async function collectEncFiles(dir: string): Promise<Array<{ encPath: string; metaPath: string }>> {
  const out: Array<{ encPath: string; metaPath: string }> = [];
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.name.endsWith(".enc")) {
        out.push({ encPath: full, metaPath: full + ".meta" });
      }
    }
  }
  await walk(dir);
  return out;
}

// Only cleanup helper referenced when needed (keeps unlink/mkdir imports meaningful).
void unlink;
void mkdir;

main().catch((e) => {
  console.error("[rotate] fatal:", e);
  process.exit(1);
});
