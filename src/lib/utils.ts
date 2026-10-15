import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function generateCaseCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "GM-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// ===========================================================================
// v5.0 — Разбор структурированных клинических данных анализа
// ===========================================================================

import type { AnalysisStructured } from "./types";

/** Пустая структура (для старых анализов без колонки structured). */
export function emptyStructured(): AnalysisStructured {
  return {
    differential: [],
    workupPlan: [],
    therapyOptions: [],
    monitoringPlan: [],
    verification: { performed: false, passes: 0, corrections: [] },
  };
}

/** Безопасный разбор JSON-колонки AnalysisResult.structured. */
export function parseStructured(json: string | null | undefined): AnalysisStructured {
  if (!json) return emptyStructured();
  const parsed = safeJsonParse<Partial<AnalysisStructured> | null>(json, null);
  if (!parsed) return emptyStructured();
  return {
    differential: Array.isArray(parsed.differential) ? parsed.differential : [],
    workupPlan: Array.isArray(parsed.workupPlan) ? parsed.workupPlan : [],
    therapyOptions: Array.isArray(parsed.therapyOptions) ? parsed.therapyOptions : [],
    monitoringPlan: Array.isArray(parsed.monitoringPlan) ? parsed.monitoringPlan : [],
    verification: {
      performed: !!parsed.verification?.performed,
      passes: parsed.verification?.passes ?? 0,
      corrections: Array.isArray(parsed.verification?.corrections)
        ? parsed.verification.corrections
        : [],
      factsGrounded: parsed.verification?.factsGrounded,
      verifiedAt: parsed.verification?.verifiedAt,
    },
  };
}
