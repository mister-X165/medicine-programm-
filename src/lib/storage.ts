// СППВР — приватное файловое хранилище (ФЗ-152)
// ============================================================================
// ВАЖНО (v2.1): загруженные документы и PDF-отчёты больше НЕ хранятся в
// каталоге /public. Next.js отдаёт /public как статический контент БЕЗ
// аутентификации, что означает, что любой, кто знает URL, может скачать
// PHI. Теперь файлы сохраняются в /private-storage (вне /public) и
// отдаются только через auth-checked эндпоинты:
//   - GET /api/cases/[id]/documents/[docId]/download
//   - GET /api/reports/[id]?download=1
//
// Compliance: ФЗ-152 ст. 18 ч. 3, HIPAA §164.312(a)(1) (access control),
// §164.312(e)(1) (transmission security — файлы не отдаются по публичному URL).

import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { existsSync, readFileSync as fsReadFileSync } from "fs";
import path from "path";
import { logger } from "./logger";
import { encryptBuffer } from "./encryption";

// Каталог ВНЕ /public — Next.js не отдаёт его как статику.
const STORAGE_ROOT = path.join(process.cwd(), "private-storage");
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const REPORT_DIR = path.join(STORAGE_ROOT, "reports");

/**
 * v2.6 (at-rest encryption on write): файл шифруется AES-256-GCM В ПАМЯТИ
 * и на диск записывается ТОЛЬКО шифротекст (<имя>.enc + .enc.meta).
 * Открытый текст никогда не касается диска — ранее файл лежал в открытом
 * виде до ручного запуска админом «Encrypt All».
 * Возвращает ОТНОСИТЕЛЬНЫЙ путь без .enc — читатели вызывают decryptFile
 * (который сам подставляет .enc), с фолбэком на открытое чтение легаси-файлов.
 */
export async function saveFile(buffer: Buffer, fileName: string): Promise<string> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
  const ext = path.extname(fileName);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const relPath = `uploads/${uniqueName}`;
  await writeEncrypted(relPath, buffer);
  logger.info("storage", "File saved ENCRYPTED to private storage", { fileName: uniqueName, size: buffer.length });
  return relPath;
}

/**
 * Сохраняет PDF-отчёт (v2.6: сразу зашифрованным — см. saveFile).
 */
export async function saveReport(buffer: Buffer, fileName: string): Promise<string> {
  if (!existsSync(REPORT_DIR)) {
    await mkdir(REPORT_DIR, { recursive: true });
  }
  const relPath = `reports/${fileName}`;
  await writeEncrypted(relPath, buffer);
  logger.info("storage", "Report saved ENCRYPTED to private storage", { fileName, size: buffer.length });
  return relPath;
}

/**
 * Шифрует буфер и записывает на диск только шифротекст + метаданные.
 */
async function writeEncrypted(relPath: string, buffer: Buffer): Promise<void> {
  const fullPath = path.join(STORAGE_ROOT, relPath);
  const { encrypted, iv, salt, authTag, kdfParams } = encryptBuffer(buffer);
  await writeFile(fullPath + ".enc", encrypted);
  await writeFile(
    fullPath + ".enc.meta",
    JSON.stringify(
      {
        iv: iv.toString("base64"),
        salt: salt.toString("base64"),
        authTag: authTag.toString("base64"),
        originalSize: buffer.length,
        algorithm: "aes-256-gcm",
        kdf: "scrypt",
        kdfN: kdfParams.N,
        kdfr: kdfParams.r,
        kdfp: kdfParams.p,
        encryptedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

/**
 * Читает файл из приватного хранилища по ОТНОСИТЕЛЬНОМУ пути
 * (например "uploads/123.pdf" или "reports/456.pdf").
 * Возвращает Buffer или null, если файл не найден.
 */
export async function readPrivateFile(relativePath: string): Promise<Buffer | null> {
  try {
    // Защита от path traversal: нормализуем путь и проверяем, что он
    // остаётся внутри STORAGE_ROOT.
    const fullPath = path.resolve(STORAGE_ROOT, relativePath);
    if (!fullPath.startsWith(STORAGE_ROOT + path.sep) && fullPath !== STORAGE_ROOT) {
      logger.warn("storage", "Path traversal blocked", { relativePath });
      return null;
    }
    if (!existsSync(fullPath)) return null;
    return await readFile(fullPath);
  } catch (e) {
    logger.error("storage", "Failed to read private file", {
      path: relativePath,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Синхронное чтение (для случаев, когда нельзя использовать await).
 */
export function readFileSync(relativePath: string): Buffer | null {
  try {
    const fullPath = path.resolve(STORAGE_ROOT, relativePath);
    if (!fullPath.startsWith(STORAGE_ROOT + path.sep) && fullPath !== STORAGE_ROOT) {
      return null;
    }
    if (!existsSync(fullPath)) return null;
    return fsReadFileSync(fullPath);
  } catch {
    return null;
  }
}

/**
 * Удаляет файл из приватного хранилища.
 */
export async function deleteFile(relativePath: string): Promise<boolean> {
  try {
    const fullPath = path.resolve(STORAGE_ROOT, relativePath);
    if (!fullPath.startsWith(STORAGE_ROOT + path.sep) && fullPath !== STORAGE_ROOT) {
      return false;
    }
    if (!existsSync(fullPath)) return false;
    await unlink(fullPath);
    logger.info("storage", "File deleted from private storage", { path: relativePath });
    return true;
  } catch (e) {
    logger.error("storage", "Failed to delete file", {
      path: relativePath,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export function fileToBase64DataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function detectFileType(fileName: string, mimeType?: string): "discharge" | "genetic" | "image" {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  if (["vcf", "csv", "tsv"].includes(ext)) return "genetic";
  if (["png", "jpg", "jpeg", "gif", "bmp", "tiff", "dicom", "dcm"].includes(ext)) return "image";
  if (["pdf", "doc", "docx", "txt", "rtf"].includes(ext)) return "discharge";
  if (mimeType?.startsWith("image/")) return "image";
  return "discharge";
}
