// СППВР — File Encryption Module
// AES-256-GCM encryption for files stored in the system
// Compliant with ФЗ-152 data protection requirements

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { logger } from "./logger";
import { ENCRYPTION_PASSPHRASE } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

// v4.3 audit fix: strengthened scrypt parameters for new encryptions.
// Previously scryptSync used the Node default (N=16384, r=8, p=1) which is
// below OWASP's recommendation (N >= 2^17). The ENCRYPTION_PASSPHRASE is
// already a 256-bit random value, so brute-force is infeasible today, but we
// harden the KDF for defense-in-depth. Legacy files (encrypted with the old
// default) carry no kdfN in their .meta — decryptFile falls back to 16384 for
// them, so existing ciphertext remains readable.
const STRONG_KDF = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const LEGACY_KDF = { N: 16384, r: 8, p: 1 };

interface KdfParams {
  N: number;
  r: number;
  p: number;
}

// Derive encryption key from the validated ENCRYPTION_PASSPHRASE (src/lib/env.ts).
// No hardcoded default lives in this file anymore.

function getEncryptionKey(salt: Buffer, params: KdfParams = STRONG_KDF): Buffer {
  return scryptSync(ENCRYPTION_PASSPHRASE, salt, KEY_LENGTH, params);
}

export interface EncryptionResult {
  encryptedPath: string;
  iv: string;          // Base64 encoded IV
  salt: string;        // Base64 encoded salt
  authTag: string;     // Base64 encoded auth tag
  originalSize: number;
  encryptedSize: number;
}

export interface DecryptionResult {
  data: Buffer;
  originalSize: number;
}

/**
 * Encrypt a buffer using AES-256-GCM
 */
export function encryptBuffer(data: Buffer): {
  encrypted: Buffer;
  iv: Buffer;
  salt: Buffer;
  authTag: Buffer;
  kdfParams: KdfParams;
} {
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);
  const key = getEncryptionKey(salt, STRONG_KDF);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, salt, authTag, kdfParams: { N: STRONG_KDF.N, r: STRONG_KDF.r, p: STRONG_KDF.p } };
}

/**
 * Decrypt a buffer using AES-256-GCM
 */
export function decryptBuffer(
  encrypted: Buffer,
  iv: Buffer,
  salt: Buffer,
  authTag: Buffer,
  kdfParams: KdfParams = STRONG_KDF,
): Buffer {
  const key = getEncryptionKey(salt, kdfParams);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Encrypt a file and store it with metadata
 * The encrypted file is stored at the original path with .enc extension
 * Metadata (IV, salt, authTag) is stored in a .meta JSON file alongside
 */
export async function encryptFile(relativePath: string): Promise<EncryptionResult | null> {
  try {
    // Файлы теперь хранятся в private-storage (вне /public).
    const fullPath = path.join(process.cwd(), "private-storage", relativePath);

    if (!existsSync(fullPath)) {
      logger.warn("encryption", "File not found for encryption", { path: relativePath });
      return null;
    }

    const data = await readFile(fullPath);
    const originalSize = data.length;

    const { encrypted, iv, salt, authTag, kdfParams } = encryptBuffer(data);

    // Write encrypted file
    const encPath = fullPath + ".enc";
    await writeFile(encPath, encrypted);

    // Write metadata file (includes KDF params so legacy ciphertext stays
    // readable after future cost upgrades).
    const metaPath = fullPath + ".enc.meta";
    const meta = {
      iv: iv.toString("base64"),
      salt: salt.toString("base64"),
      authTag: authTag.toString("base64"),
      originalSize,
      algorithm: ALGORITHM,
      kdf: "scrypt",
      kdfN: kdfParams.N,
      kdfr: kdfParams.r,
      kdfp: kdfParams.p,
      encryptedAt: new Date().toISOString(),
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    // Remove original unencrypted file
    const { unlink } = await import("fs/promises");
    await unlink(fullPath);

    const encryptedPath = relativePath + ".enc";

    logger.info("encryption", "File encrypted successfully", {
      path: relativePath,
      originalSize,
      encryptedSize: encrypted.length,
    });

    return {
      encryptedPath,
      iv: iv.toString("base64"),
      salt: salt.toString("base64"),
      authTag: authTag.toString("base64"),
      originalSize,
      encryptedSize: encrypted.length,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("encryption", "Failed to encrypt file", { path: relativePath, error: errMsg });
    return null;
  }
}

/**
 * Decrypt a file and return the buffer
 */
export async function decryptFile(relativePath: string): Promise<DecryptionResult | null> {
  try {
    // If the path doesn't end with .enc, try adding it
    const encRelativePath = relativePath.endsWith(".enc") ? relativePath : relativePath + ".enc";
    const fullPath = path.join(process.cwd(), "private-storage", encRelativePath);
    const metaPath = fullPath + ".meta";

    if (!existsSync(fullPath) || !existsSync(metaPath)) {
      logger.warn("encryption", "Encrypted file or metadata not found", { path: encRelativePath });
      return null;
    }

    const encrypted = await readFile(fullPath);
    const metaRaw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaRaw);

    const iv = Buffer.from(meta.iv, "base64");
    const salt = Buffer.from(meta.salt, "base64");
    const authTag = Buffer.from(meta.authTag, "base64");

    // v4.3 audit fix: read KDF params from meta so legacy ciphertext
    // (encrypted with scrypt N=16384) stays readable after the cost upgrade.
    // New files carry kdfN/kdfr/kdfp; legacy files fall back to the old default.
    const kdfParams: KdfParams = {
      N: typeof meta.kdfN === "number" ? meta.kdfN : LEGACY_KDF.N,
      r: typeof meta.kdfr === "number" ? meta.kdfr : LEGACY_KDF.r,
      p: typeof meta.kdfp === "number" ? meta.kdfp : LEGACY_KDF.p,
    };

    const data = decryptBuffer(encrypted, iv, salt, authTag, kdfParams);

    logger.info("encryption", "File decrypted successfully", {
      path: encRelativePath,
      originalSize: meta.originalSize,
    });

    return {
      data,
      originalSize: meta.originalSize,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("encryption", "Failed to decrypt file", { path: relativePath, error: errMsg });
    return null;
  }
}

/**
 * Check if a file is encrypted (has .enc extension)
 */
export function isEncryptedFile(relativePath: string): boolean {
  return relativePath.endsWith(".enc");
}

/**
 * Get the original file path from an encrypted file path
 */
export function getOriginalPath(encRelativePath: string): string {
  if (encRelativePath.endsWith(".enc")) {
    return encRelativePath.slice(0, -4);
  }
  return encRelativePath;
}

/**
 * Encrypt all uploaded files that are not yet encrypted
 */
export async function encryptAllUploads(): Promise<{
  encrypted: number;
  skipped: number;
  failed: number;
  details: Array<{ path: string; status: "encrypted" | "skipped" | "failed" }>;
}> {
  const { readdir } = await import("fs/promises");
  const uploadDir = path.join(process.cwd(), "private-storage", "uploads");

  if (!existsSync(uploadDir)) {
    return { encrypted: 0, skipped: 0, failed: 0, details: [] };
  }

  const files = await readdir(uploadDir);
  const details: Array<{ path: string; status: "encrypted" | "skipped" | "failed" }> = [];
  let encrypted = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    // Skip already encrypted files and metadata files
    if (file.endsWith(".enc") || file.endsWith(".meta")) {
      skipped++;
      continue;
    }

    const relativePath = `uploads/${file}`;
    const result = await encryptFile(relativePath);

    if (result) {
      encrypted++;
      details.push({ path: relativePath, status: "encrypted" });
    } else {
      failed++;
      details.push({ path: relativePath, status: "failed" });
    }
  }

  logger.info("encryption", "Batch encryption completed", { encrypted, skipped, failed });

  return { encrypted, skipped, failed, details };
}
