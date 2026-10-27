// СППВР v2.3 — Network Status API
// GET /api/network/status — Get current network status (cached, no probe)
// POST /api/network/status — Force a network probe (checks connectivity now)
//
// This is a lightweight endpoint the frontend can poll (e.g. every 30s) to
// know whether web RAG is available. It NEVER crashes — even if the network
// health module itself fails, it returns a valid response.

import { NextResponse } from "next/server";
import {
  getNetworkStatus,
  checkNetwork,
  getHostBreakerStats,
} from "@/lib/network-health";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // v5.0: гарантируем, что фоновый зонд запущен и статус свежий
    const status = getNetworkStatus();
    return NextResponse.json({
      online: status.online,
      lastError: status.lastError,
      circuitOpen: status.circuitOpenedAt !== null,
      lastCheck: status.lastCheck,
      consecutiveFailures: status.consecutiveFailures,
      // v5.0: per-host circuit breakers (диагностика «какой источник недоступен»)
      hostBreakers: getHostBreakerStats(),
      // Human-readable message for the UI banner
      message: status.online
        ? "Интернет-соединение активно. Поиск КР Минздрава РФ (cr.minzdrav.gov.ru) и международных источников (PubMed, ВОЗ, NICE) доступен."
        : "Нет интернет-соединения. Веб-RAG временно недоступен — система работает с локальной базой знаний. Статус проверяется автоматически каждые 60 с.",
    });
  } catch (e) {
    logger.error("network", "Network status GET failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({
      online: true, // optimistic — don't block the UI
      lastError: "Network health module unavailable",
      circuitOpen: false,
      message: "Статус сети неизвестен.",
    });
  }
}

// POST — force a probe (admin/debug). This does a real network check.
export async function POST(req: Request) {
  try {
    // v4.3 audit fix: forcing an outbound network probe is an admin/debug
    // operation — prevents authenticated abuse to spam external endpoints.
    await requireAdmin(req);
    const online = await checkNetwork();
    const status = getNetworkStatus();
    return NextResponse.json({
      online,
      lastError: status.lastError,
      circuitOpen: status.circuitOpenedAt !== null,
      lastCheck: status.lastCheck,
      consecutiveFailures: status.consecutiveFailures,
      probedAt: new Date().toISOString(),
      message: online
        ? " Интернет-соединение активно. Веб-RAG доступен."
        : "Нет интернет-соединения. Проверьте подключение к сети.",
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    logger.error("network", "Network status POST (probe) failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({
      online: false,
      lastError: e instanceof Error ? e.message : String(e),
      circuitOpen: true,
      message: "Не удалось проверить сетевое соединение.",
    });
  }
}
