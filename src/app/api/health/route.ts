// СППВР v2.0 — System health check API
// Returns: db status, AI provider status, storage, RAG, DDI, ICD-10 availability
//
// SHAPE CONTRACT (v2.1.3 fix):
//   The frontend `SystemStatus` type (src/lib/types.ts:177-186) and the
//   `SystemStatusBadge` component (src/components/shared/system-status.tsx)
//   read these EXACT boolean fields:
//     - ok         : overall readiness
//     - db         : database reachable
//     - ai.ok      : AI provider responds
//     - ai.provider: "llama-server" | "lm-studio" | "none" (v5.1: llama.cpp support)
//     - ai.latency : round-trip ms (optional)
//     - storage    : local upload dir writable
//     - rag        : clinical recommendations count > 0
//     - ddi        : drug interactions count > 0
//     - icd10      : ICD-10 codes count > 0
//   Earlier versions returned string-valued fields (`database`, `aiCore`,
//   `aiProvider`, `ragIndex`) — the UI read `data.db` (undefined → falsy →
//   "error") and falsely reported "Database: Error" even when the DB was
//   fine. This route now returns the boolean shape the UI expects.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAIHealth } from "@/lib/ai-service";
import { getNetworkStatus } from "@/lib/network-health";
import { existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  // Default: everything OK; we flip booleans to false as checks fail.
  const status: {
    ok: boolean;
    db: boolean;
    ai: {
      ok: boolean;
      provider: "llama-server" | "lm-studio" | "none";
      error?: string;
      lmStudioOk?: boolean;
      lmStudioError?: string;
      model?: string;
      latency?: number;
    };
    storage: boolean;
    rag: boolean;
    ddi: boolean;
    icd10: boolean;
    // v2.3: network status for web RAG. When offline, the UI shows a banner
    // "Нет интернет-соединения — веб-RAG недоступен" but the system continues
    // working with local knowledge base.
    network: {
      online: boolean;
      lastError: string | null;
      circuitOpen: boolean;
      lastCheck: number;
    };
    timestamp: string;
  } = {
    ok: true,
    db: true,
    ai: { ok: false, provider: "none" },
    storage: true,
    rag: false,
    ddi: false,
    icd10: false,
    network: { online: true, lastError: null, circuitOpen: false, lastCheck: 0 },
    timestamp: new Date().toISOString(),
  };

  // 1. Database — must be reachable AND have the doctors table.
  try {
    await db.doctor.count();
  } catch {
    status.db = false;
    status.ok = false;
  }

  // 2. AI Core — graceful: degraded AI does NOT flip overall `ok` to false,
  //    because the app supports manual mode. The UI shows "Ограничено" when
  //    ai.ok is false but db/storage are still true.
  try {
    const t0 = Date.now();
    const ai = await checkAIHealth();
    const t1 = Date.now();
    status.ai = {
      ok: ai.ok,
      provider: (ai.provider as "llama-server" | "lm-studio" | "none") || "none",
      error: ai.error,
      lmStudioOk: ai.lmStudioOk,
      lmStudioError: ai.lmStudioError,
      model: ai.model,
      latency: t1 - t0,
    };
  } catch (e) {
    status.ai = {
      ok: false,
      provider: "none",
      error: e instanceof Error ? e.message : "AI check failed",
    };
  }

  // 3. Storage — local upload directory must exist (or be creatable).
  try {
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    if (!existsSync(uploadDir)) {
      const { mkdirSync } = await import("fs");
      mkdirSync(uploadDir, { recursive: true });
    }
  } catch {
    status.storage = false;
    status.ok = false;
  }

  // 4. RAG Index — true when the clinical-recommendations table has rows.
  //    (Empty table = "Run initialization" — UI shows "RAG: empty" but
  //    we still report `false` so the badge displays the error state.)
  try {
    const count = await db.clinicalRecommendation.count();
    status.rag = count > 0;
  } catch {
    status.rag = false;
  }

  // 5. DDI — true when drug-interactions table has rows.
  try {
    const ddiCount = await db.drugInteraction.count();
    status.ddi = ddiCount > 0;
  } catch {
    status.ddi = false;
  }

  // 6. ICD-10 — true when icd10_codes table has rows.
  try {
    const icd10Count = await db.iCD10Code.count();
    status.icd10 = icd10Count > 0;
  } catch {
    status.icd10 = false;
  }

  // 7. Network status (v2.3) — for web RAG. This is NON-BLOCKING: if the
  //    network is down, the system continues to work with the local knowledge
  //    base. The UI shows a banner but doesn't block any operations.
  //    We DON'T trigger a probe here (the health endpoint should be fast) —
  //    we just report the cached status from the circuit breaker.
  try {
    const netStatus = getNetworkStatus();
    status.network = {
      online: netStatus.online,
      lastError: netStatus.lastError,
      circuitOpen: netStatus.circuitOpenedAt !== null,
      lastCheck: netStatus.lastCheck,
    };
  } catch {
    // Network health module itself failed — report unknown but don't crash
    status.network = {
      online: true, // optimistic
      lastError: "Network health check unavailable",
      circuitOpen: false,
      lastCheck: 0,
    };
  }

  // Overall `ok` is: DB up + storage up. AI/RAG/DDI/ICD-10/network degradations
  // are surfaced in the badge but don't make the whole system "not ready"
  // (manual mode + first-run state + offline mode are all legitimate).
  status.ok = status.db && status.storage;

  // HTTP 200 always — the UI reads the body, not the status code, for
  // per-component state. (Returning 503 made some fetch wrappers throw
  // before the body could be parsed.)
  return NextResponse.json(status, { status: 200 });
}
