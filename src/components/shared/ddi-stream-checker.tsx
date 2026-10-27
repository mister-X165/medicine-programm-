"use client";

// СППВР v5.0 — ПОТОКОВЫЙ ОНЛАЙН-ПОИСК ВЗАИМОДЕЙСТВИЙ (общий компонент)
// ============================================================================
// Потребляет SSE-поток POST /api/ddi/stream и показывает проверку в реальном
// времени: этапы → пары (поиск в РЛС/Видаль/ГРЛС/КР) → живые алерты с
// источниками → итоговое заключение.
//
// Используется:
//   • DrugInteractionChecker (Калькуляторы) — встроенная панель
//   • DdiOverviewCard (Медкарта → Фармакотерапия) — диалог для режима
//     приёма пациента
// ============================================================================

import * as React from "react";
import {
  Loader2, CheckCircle2, Search, ExternalLink, ShieldAlert, AlertOctagon,
  Info, Database, Globe, Sparkles, FileCheck2, X, Landmark, Zap, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DdiStreamEvent, OnlineDDIAlert, DDISourceRef } from "@/lib/types";
import { toast } from "sonner";

// ----------------------------------------------------------------------------
// Хук — потребление SSE-потока проверки
// ----------------------------------------------------------------------------

export interface DDIStreamState {
  running: boolean;
  events: DdiStreamEvent[];
  alerts: OnlineDDIAlert[];
  stageLabel: string;
  totalPairs: number;
  completedPairs: number;
  currentPair: string | null;
  summary: string | null;
  complete: null | (DdiStreamEvent & { type: "complete" });
  error: string | null;
  sourcesUsed: string[];
}

const initialState: DDIStreamState = {
  running: false,
  events: [],
  alerts: [],
  stageLabel: "",
  totalPairs: 0,
  completedPairs: 0,
  currentPair: null,
  summary: null,
  complete: null,
  error: null,
  sourcesUsed: [],
};

export function useDDIStream() {
  const [state, setState] = React.useState<DDIStreamState>(initialState);
  const abortRef = React.useRef<AbortController | null>(null);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, running: false }));
  }, []);

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initialState);
  }, []);

  const start = React.useCallback(async (medications: string[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...initialState, running: true, stageLabel: "Подключение к сервису проверки…" });

    try {
      const res = await fetch("/api/ddi/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ medications }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        let msg = "Сервис проверки недоступен";
        try {
          const j = JSON.parse(errText);
          msg = j.error ?? msg;
        } catch { /* текст не JSON */ }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Аккумулированное состояние потока
      let alerts: OnlineDDIAlert[] = [];
      let totalPairs = 0;
      let completedPairs = 0;
      const sourcesUsed = new Set<string>();
      const pairStates = new Map<number, { status: "search" | "llm" | "done"; drugA: string; drugB: string; fromCache: boolean }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE-фреймы разделены двойным переводом строки
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let event: DdiStreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as DdiStreamEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case "stage":
              setState((s) => ({ ...s, stageLabel: event.label }));
              break;
            case "normalized":
              // Информация о нормализации МНН — показываем в тосте только
              // при маппинге брендов (врач должен знать о подстановке)
              break;
            case "local-alerts":
              alerts = [...event.alerts];
              setState((s) => ({ ...s, alerts: [...alerts] }));
              break;
            case "pair-start":
              totalPairs = Math.max(totalPairs, event.totalPairs);
              pairStates.set(event.pairIndex, { status: "search", drugA: event.drugA, drugB: event.drugB, fromCache: event.cached });
              setState((s) => ({ ...s, totalPairs, currentPair: `${event.drugA} + ${event.drugB}` }));
              break;
            case "pair-search":
              pairStates.set(event.pairIndex, { status: "search", drugA: event.drugA, drugB: event.drugB, fromCache: false });
              setState((s) => ({ ...s, currentPair: `${event.drugA} + ${event.drugB}: поиск в базах РФ…` }));
              break;
            case "pair-found": {
              if (event.resultCount > 0) {
                pairStates.set(event.pairIndex, { status: "llm", drugA: event.drugA, drugB: event.drugB, fromCache: false });
                setState((s) => ({ ...s, currentPair: `${event.drugA} + ${event.drugB}: извлечение данных (${event.resultCount} источников)…` }));
              }
              break;
            }
            case "alert":
              alerts = [...alerts, event.alert];
              setState((s) => ({ ...s, alerts: [...alerts] }));
              break;
            case "pair-done":
              completedPairs++;
              pairStates.set(event.pairIndex, { status: "done", drugA: event.drugA, drugB: event.drugB, fromCache: event.fromCache });
              for (const src of event.sources) {
                if (src.trust >= 2) sourcesUsed.add(src.label);
              }
              setState((s) => ({
                ...s,
                completedPairs,
                alerts: [...alerts],
                currentPair: completedPairs < totalPairs ? s.currentPair : null,
                sourcesUsed: [...sourcesUsed],
              }));
              break;
            case "pair-error":
              completedPairs++;
              setState((s) => ({ ...s, completedPairs }));
              break;
            case "summary":
              setState((s) => ({ ...s, summary: event.text }));
              break;
            case "complete":
              setState((s) => ({ ...s, complete: event, running: false }));
              if (event.totalAlerts === 0) {
                toast.success("Взаимодействий не выявлено", {
                  description: "Данные РЛС, Видаля, ГРЛС и КР Минздрава РФ",
                });
              } else {
                toast.warning(`Найдено взаимодействий: ${event.totalAlerts}`, {
                  description: `${event.pairsChecked} пар проверено онлайн · ${event.durationMs ? (event.durationMs / 1000).toFixed(1) : "?"} с`,
                });
              }
              break;
            case "error":
              setState((s) => ({ ...s, error: event.message, running: false }));
              toast.error("Ошибка потоковой проверки", { description: event.message });
              break;
          }
        }
      }
      setState((s) => ({ ...s, running: false }));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, error: msg, running: false }));
      toast.error("Ошибка проверки: " + msg);
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { state, start, stop, reset };
}

// ----------------------------------------------------------------------------
// Бейдж источника (РЛС / Видаль / ГРЛС / КР Минздрава)
// ----------------------------------------------------------------------------

const ORIGIN_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  rls: { label: "РЛС", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: Database },
  vidal: { label: "Видаль", className: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300", icon: Database },
  grls: { label: "ГРЛС", className: "border-cyan-600/40 bg-cyan-600/10 text-cyan-700 dark:text-cyan-300", icon: Landmark },
  clinrec: { label: "КР Минздрава", className: "border-cyan-600/40 bg-cyan-600/10 text-cyan-700 dark:text-cyan-300", icon: Landmark },
  web: { label: "Онлайн", className: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300", icon: Globe },
  "local-db": { label: "Локальная база", className: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300", icon: Database },
  ai: { label: "ИИ-анализ", className: "border-violet-400/40 bg-violet-400/10 text-violet-700 dark:text-violet-300", icon: Sparkles },
};

export function DDIOrginBadge({ origin, fromCache }: { origin: string; fromCache?: boolean }) {
  const cfg = ORIGIN_CONFIG[origin] ?? ORIGIN_CONFIG.web;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px] font-medium", cfg.className)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
      {fromCache && <Clock className="h-2.5 w-2.5" aria-label="из кэша" />}
    </Badge>
  );
}

// ----------------------------------------------------------------------------
// Карточка алерта (потоковая версия с источниками)
// ----------------------------------------------------------------------------

export function OnlineDDIAlertCard({ alert }: { alert: OnlineDDIAlert }) {
  const severityConfig = {
    contraindication: { label: "Противопоказано", color: "border-red-500/40 bg-red-500/5", badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", icon: AlertOctagon },
    major: { label: "Тяжёлое", color: "border-orange-500/40 bg-orange-500/5", badge: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300", icon: AlertOctagon },
    moderate: { label: "Умеренное", color: "border-amber-500/40 bg-amber-500/5", badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: ShieldAlert },
    minor: { label: "Незначительное", color: "border-sky-500/40 bg-sky-500/5", badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300", icon: Info },
  };
  const cfg = severityConfig[alert.severity as keyof typeof severityConfig] ?? severityConfig.moderate;
  const Icon = cfg.icon;

  const confidenceLabel = alert.confidence === "high" ? "подтверждено справочником"
    : alert.confidence === "medium" ? "проф. источник" : "поисковая выдача";

  return (
    <div className={cn("rounded-lg border p-3", cfg.color)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", cfg.badge.includes("red") ? "text-red-600" : cfg.badge.includes("orange") ? "text-orange-600" : cfg.badge.includes("amber") ? "text-amber-600" : "text-sky-600")} />
          <div className="font-semibold text-sm">
            {alert.drug1} <span className="text-muted-foreground">+</span> {alert.drug2}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <DDIOrginBadge origin={alert.origin} fromCache={alert.fromCache} />
          <Badge variant="outline" className={cn("text-[10px]", cfg.badge)}>{cfg.label}</Badge>
        </div>
      </div>

      <div className="space-y-1.5 text-xs">
        {alert.description && (
          <div>
            <span className="font-medium text-foreground">Описание: </span>
            <span className="text-muted-foreground">{alert.description}</span>
          </div>
        )}
        {alert.mechanism && (
          <div>
            <span className="font-medium text-foreground">Механизм: </span>
            <span className="text-muted-foreground">{alert.mechanism}</span>
          </div>
        )}
        {alert.management && (
          <div className="rounded bg-background/60 p-2">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Тактика: </span>
            <span className="text-foreground">{alert.management}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {alert.evidenceLevel && (
            <span className="flex items-center gap-1">Доказательность: <Badge variant="secondary" className="text-[10px]">{alert.evidenceLevel}</Badge></span>
          )}
          {alert.confidence && (
            <span className="flex items-center gap-1">
              <FileCheck2 className="h-3 w-3" />
              {confidenceLabel}
            </span>
          )}
          {alert.sourceUrls && alert.sourceUrls.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {alert.sourceUrls.slice(0, 2).map((src: DDISourceRef, i: number) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                  onClick={(e) => { e.stopPropagation(); }}
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  {src.label}
                </a>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Живая панель потоковой проверки
// ----------------------------------------------------------------------------

export function DDIStreamPanel({ state, onStop }: { state: DDIStreamState; onStop?: () => void }) {
  const progress = state.totalPairs > 0
    ? Math.min(100, Math.round((state.completedPairs / state.totalPairs) * 100))
    : 0;

  const severityCounts = React.useMemo(() => {
    const counts = { contraindication: 0, major: 0, moderate: 0, minor: 0 };
    for (const a of state.alerts) {
      counts[a.severity as keyof typeof counts] = (counts[a.severity as keyof typeof counts] ?? 0) + 1;
    }
    return counts;
  }, [state.alerts]);

  return (
    <div className="space-y-3">
      {/* Прогресс потоковой проверки */}
      {(state.running || state.complete) && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2">
            {state.running ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {state.complete
                  ? `Проверка завершена за ${(state.complete.durationMs / 1000).toFixed(1)} с`
                  : state.stageLabel || "Потоковая проверка…"}
              </div>
              {state.running && state.currentPair && (
                <div className="truncate text-xs text-muted-foreground">
                  <Search className="mr-1 inline h-3 w-3" />
                  {state.currentPair}
                </div>
              )}
              {state.complete && state.sourcesUsed.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {state.complete.sourcesUsed.map((s) => (
                    <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
              )}
            </div>
            {state.running && onStop && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onStop}>
                <X className="h-3 w-3" />Стоп
              </Button>
            )}
          </div>
          {state.totalPairs > 0 && (
            <div className="mt-2 space-y-1">
              <Progress value={progress} className="h-1.5" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Пар проверено: {state.completedPairs} / {state.totalPairs}</span>
                <span>Онлайн-поиск: РЛС · Видаль · ГРЛС · КР Минздрава</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Живые счётчики по тяжести */}
      {state.alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {severityCounts.contraindication > 0 && (
            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
              {severityCounts.contraindication} противопоказаний
            </Badge>
          )}
          {severityCounts.major > 0 && (
            <Badge variant="outline" className="border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300">
              {severityCounts.major} тяжёлых
            </Badge>
          )}
          {severityCounts.moderate > 0 && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {severityCounts.moderate} умеренных
            </Badge>
          )}
          {severityCounts.minor > 0 && (
            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
              {severityCounts.minor} незначительных
            </Badge>
          )}
        </div>
      )}

      {/* Итоговое заключение */}
      {state.summary && (
        <div className="rounded-lg border border-muted bg-muted/40 p-3 text-xs">
          <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
            <Zap className="h-3.5 w-3.5 text-primary" />
            Заключение
          </div>
          <p className="text-muted-foreground">{state.summary}</p>
        </div>
      )}

      {/* Живые алерты */}
      {state.alerts.length > 0 && (
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {state.alerts.map((alert, i) => (
            <OnlineDDIAlertCard key={`${alert.drug1}-${alert.drug2}-${i}`} alert={alert} />
          ))}
        </div>
      )}

      {/* Завершено без взаимодействий */}
      {state.complete && state.complete.totalAlerts === 0 && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-emerald-600" />
            <div>
              <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                Взаимодействий не обнаружено
              </div>
              <div className="text-xs text-muted-foreground">
                Проверено {state.complete.pairsChecked} пар по данным РЛС, Видаля, ГРЛС и КР Минздрава РФ
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ошибка */}
      {state.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertOctagon className="mr-1.5 inline h-4 w-4" />
          {state.error}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Диалог потоковой проверки (для медкарты пациента)
// ----------------------------------------------------------------------------

export function DdiStreamDialog({
  open, onOpenChange, medications, title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medications: string[];
  title?: string;
}) {
  const { state, start, stop, reset } = useDDIStream();
  const startedRef = React.useRef(false);

  // Автозапуск при открытии
  React.useEffect(() => {
    if (open && medications.length >= 2 && !startedRef.current && !state.running) {
      startedRef.current = true;
      start(medications);
    }
    if (!open) {
      startedRef.current = false;
      stop();
    }
  }, [open, medications, state.running, start, stop]);

  return (
    <Dialog open={open} onOpenChange={(o) => { reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" />
            {title ?? "Онлайн-проверка взаимодействий"}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-muted bg-muted/30 p-2.5 text-xs">
          <span className="font-medium">Препараты ({medications.length}):</span>{" "}
          <span className="text-muted-foreground">{medications.join(", ")}</span>
        </div>

        <DDIStreamPanel state={state} onStop={stop} />

        <div className="flex justify-end gap-2">
          {state.complete && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { reset(); startedRef.current = true; start(medications); }}>
              <Search className="h-3.5 w-3.5" />Проверить заново
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false); }}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
