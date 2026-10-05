// СППВР — Система логирования (ФЗ-152: аудит действий системы)

import { db } from "./db";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory =
  | "system" | "ai" | "analysis" | "pdf" | "auth" | "storage" | "api" | "general"
  // v4.1: новые категории — официальный репозиторий КР Минздрава и обследования
  | "minzdrav" | "minzdrav-api" | "web-rag" | "examinations" | "ai-ddx" | "ai-chat" | "audit" | "consents" | "ddi" | "init"
  | "encryption" | "network" | "backup" | "chat" | "seed" | "knowledge" | "patients" | "cases" | "reports" | "ner"
  // v2.6: категории под-модулей ЭМК
  | "ddi-overview" | "health-score" | "med-check" | "e2ee" | "security"
  // v4.2: прямой разбор репозитория КР Минздрава по теме (topic-driven RAG)
  | "minzdrav-rag" | "rag"
  // v2.7: передача доступа к картам пациентов (key-wrapping X25519)
  | "grants"
  // v2.7.2 (audit fix): категории, использовавшиеся маршрутами без объявления
  | "therapy" | "clinical-reminders" | "doctors" | "health-scores-batch" | "icd10" | "pathways" | "ner-deidentify"
  // v5.0: потоковый онлайн-поиск взаимодействий в базах РФ + LM Studio
  | "ddi-online" | "lm-studio"
  // v5.0: международные авторитетные источники (PubMed/ВОЗ/NICE/Cochrane/…)
  | "intl-rag";

export interface LogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details: string;
  createdAt: Date;
}

export interface LogQueryOptions {
  level?: LogLevel;
  category?: LogCategory;
  search?: string;
  limit?: number;
  offset?: number;
  dateFrom?: Date;
  dateTo?: Date;
}

const MAX_LOGS = 10000;

// Track DB persistence failures — log once, then stay silent to avoid
// console spam when the database is temporarily unavailable (e.g. during
// fresh setup before `prisma db push` has run).
let dbPersistenceFailed = false;

function consoleOutput(level: LogLevel, category: LogCategory, message: string, details?: unknown) {
  if (process.env.NODE_ENV === "production") return;

  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}] [${category}]`;
  const detailStr = details !== undefined ? ` ${JSON.stringify(details)}` : "";

  switch (level) {
    case "debug":
      console.debug(prefix, message + detailStr);
      break;
    case "info":
      console.info(prefix, message + detailStr);
      break;
    case "warn":
      console.warn(prefix, message + detailStr);
      break;
    case "error":
      console.error(prefix, message + detailStr);
      break;
  }
}

async function persist(level: LogLevel, category: LogCategory, message: string, details?: unknown) {
  try {
    await db.systemLog.create({
      data: {
        level,
        category,
        message,
        details: details !== undefined ? JSON.stringify(details) : "{}",
      },
    });

    await autoCleanup();
    dbPersistenceFailed = false; // reset on success
  } catch (err) {
    // Database unavailable — log once, then stay silent. The consoleOutput()
    // call already printed the message to stdout; we only need to warn the
    // developer once that DB persistence is offline.
    if (!dbPersistenceFailed && process.env.NODE_ENV !== "production") {
      dbPersistenceFailed = true;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[LOGGER] Database persistence unavailable — logs will print to console only. ` +
          `Run "npx prisma db push" to create the database. ` +
          `First error: ${reason}`,
      );
    }
  }
}

async function autoCleanup() {
  try {
    const count = await db.systemLog.count();
    if (count > MAX_LOGS) {
      const overflow = count - MAX_LOGS;
      const oldest = await db.systemLog.findMany({
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: overflow,
      });
      if (oldest.length > 0) {
        await db.systemLog.deleteMany({
          where: { id: { in: oldest.map((l) => l.id) } },
        });
      }
    }
  } catch {
    // silent — cleanup is best-effort
  }
}

function log(level: LogLevel, category: LogCategory, message: string, details?: unknown) {
  consoleOutput(level, category, message, details);
  // Fire-and-forget — never await in the caller
  persist(level, category, message, details);
}

export const logger = {
  debug(category: LogCategory, message: string, details?: unknown) {
    log("debug", category, message, details);
  },

  info(category: LogCategory, message: string, details?: unknown) {
    log("info", category, message, details);
  },

  warn(category: LogCategory, message: string, details?: unknown) {
    log("warn", category, message, details);
  },

  error(category: LogCategory, message: string, details?: unknown) {
    log("error", category, message, details);
  },

  async getLogs(options: LogQueryOptions = {}): Promise<{ logs: LogEntry[]; total: number }> {
    const { level, category, search, limit = 50, offset = 0, dateFrom, dateTo } = options;

    const where: Record<string, unknown> = {};
    if (level) where.level = level;
    if (category) where.category = category;
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      where.createdAt = createdAt;
    }
    if (search) {
      where.OR = [
        { message: { contains: search } },
        { details: { contains: search } },
      ];
    }

    const [logs, total] = await Promise.all([
      db.systemLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.systemLog.count({ where }),
    ]);

    return { logs: logs as LogEntry[], total };
  },

  async deleteLogs(options: { beforeDate?: Date; level?: LogLevel; category?: LogCategory } = {}): Promise<number> {
    const where: Record<string, unknown> = {};
    if (options.beforeDate) where.createdAt = { lt: options.beforeDate };
    if (options.level) where.level = options.level;
    if (options.category) where.category = options.category;

    const result = await db.systemLog.deleteMany({ where });
    return result.count;
  },

  async getLogStats(): Promise<{
    total: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<LogCategory, number>;
  }> {
    const [total, levelRows, categoryRows] = await Promise.all([
      db.systemLog.count(),
      db.systemLog.groupBy({ by: ["level"], _count: { level: true } }),
      db.systemLog.groupBy({ by: ["category"], _count: { category: true } }),
    ]);

    const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const row of levelRows) {
      byLevel[row.level as LogLevel] = row._count.level;
    }

    const byCategory: Record<string, number> = {
      system: 0, ai: 0, analysis: 0, pdf: 0,
      auth: 0, storage: 0, api: 0, general: 0,
    };
    for (const row of categoryRows) {
      byCategory[row.category as string] = row._count.category;
    }

    return { total, byLevel, byCategory };
  },
};
