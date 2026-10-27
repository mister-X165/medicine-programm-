"use client";

// СППВР v2.1.2 (Task 2-d) — Analysis Version History Dialog
// ============================================================================
// Modal that lets a clinician browse every saved snapshot of a case's
// analysis and compare any two versions side-by-side.
//
// Data source: GET /api/cases/[id]/analysis/versions
//   → returns one row per historical AnalysisVersion PLUS a synthetic
//     "current" entry (isCurrent=true) representing the live AnalysisResult.
//
// Diff approach:
//   - Conclusion text: LCS line diff (green = added, red = removed, gray = unchanged)
//   - Confidence: per-key numeric delta with up/down arrow
//   - Arrays (sections / mutations / ddi / icd10): set-difference (added / removed / unchanged)
//
// NOTE on restoration: the "Восстановить эту версию" button is intentionally
// disabled. Full restoration requires re-running the analysis pipeline with
// the old parameters — that flow will be added in a future release.
// ============================================================================

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  History,
  GitCompareArrows,
  Plus,
  Minus,
  Circle,
  User,
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Loader2,
  AlertCircle,
  FileText,
  Dna,
  ShieldAlert,
  Code,
  TrendingUp,
  Layers,
  Info,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { cn, formatDateTime } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Mutation,
  ConclusionSection,
  DDIAlert,
  ICD10CodeMatch,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VersionRow {
  id: string;
  analysisId: string;
  version: number;
  changeNote: string;
  doctorId: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
  snapshotSize: number;
  isCurrent: boolean;
}

interface VersionsResponse {
  versions: VersionRow[];
  currentVersion: number;
  totalVersions: number;
  error?: string;
}

interface Props {
  caseId: string;
  currentVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Fetch helper (uses the same JWT injection pattern as api.fetchJSON)
// ---------------------------------------------------------------------------

async function fetchVersions(caseId: string): Promise<VersionsResponse> {
  // v2.6.2: cookie-only аутентификация — Bearer-инъекция удалена
  const res = await fetch(`/api/cases/${caseId}/analysis/versions`, {
    cache: "no-store",
    credentials: "include",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* swallow — handled below */
  }
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as VersionsResponse;
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

type LineOp = { type: "added" | "removed" | "unchanged"; text: string };

/**
 * Classic LCS-based line diff. Returns an ordered list of ops so the renderer
 * can paint a side-by-side view: removed lines on the left (red), added lines
 * on the right (green), unchanged lines on both (gray).
 */
function diffLines(oldText: string, newText: string): LineOp[] {
  const a = (oldText ?? "").split("\n");
  const b = (newText ?? "").split("\n");
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[0..i) and b[0..j)
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: LineOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.unshift({ type: "unchanged", text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.unshift({ type: "removed", text: a[i - 1] });
      i--;
    } else {
      ops.unshift({ type: "added", text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.unshift({ type: "removed", text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.unshift({ type: "added", text: b[j - 1] });
    j--;
  }
  return ops;
}

interface ArrayDiff<T> {
  added: T[];
  removed: T[];
  unchanged: T[];
}

function diffArrays<T>(
  oldArr: T[] | undefined,
  newArr: T[] | undefined,
  keyFn: (item: T) => string,
): ArrayDiff<T> {
  const old_ = oldArr ?? [];
  const new_ = newArr ?? [];
  const oldKeys = new Set(old_.map(keyFn));
  const newKeys = new Set(new_.map(keyFn));
  return {
    added: new_.filter((it) => !oldKeys.has(keyFn(it))),
    removed: old_.filter((it) => !newKeys.has(keyFn(it))),
    unchanged: new_.filter((it) => oldKeys.has(keyFn(it))),
  };
}

// ---------------------------------------------------------------------------
// Field readers — pull a typed field out of the raw snapshot object
// ---------------------------------------------------------------------------

function readArr<T>(snap: Record<string, unknown> | undefined, key: string): T[] {
  if (!snap) return [];
  const v = snap[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

function readStr(snap: Record<string, unknown> | undefined, key: string): string {
  if (!snap) return "";
  const v = snap[key];
  return typeof v === "string" ? v : "";
}

function readObj(
  snap: Record<string, unknown> | undefined,
  key: string,
): Record<string, number> {
  if (!snap) return {};
  const v = snap[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, number>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Relative time formatter (Russian)
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return "только что";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ч назад`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} дн назад`;
  return formatDateTime(iso);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffColumn({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "was" | "became";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border",
        tone === "was"
          ? "border-red-500/30 bg-red-500/5"
          : "border-emerald-500/30 bg-emerald-500/5",
      )}
    >
      <div
        className={cn(
          "border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
          tone === "was"
            ? "border-red-500/30 text-red-700 dark:text-red-400"
            : "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
        )}
      >
        {title}
      </div>
      <div className="p-3 text-sm">{children}</div>
    </div>
  );
}

function DiffRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function AddedItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-sm bg-emerald-500/10 px-2 py-1 text-sm">
      <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function RemovedItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-sm bg-red-500/10 px-2 py-1 text-sm">
      <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
      <span className="min-w-0 break-words line-through decoration-red-500/60">{children}</span>
    </li>
  );
}

function UnchangedItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-sm bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
      <Circle className="mt-1 h-2 w-2 shrink-0 fill-current" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function EmptyDiffHint({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5" aria-hidden />
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conclusion diff — side-by-side LCS line diff
// ---------------------------------------------------------------------------

function ConclusionDiff({ fromText, toText }: { fromText: string; toText: string }) {
  if (!fromText && !toText) {
    return <EmptyDiffHint text="Заключение отсутствует в обеих версиях." />;
  }
  const ops = diffLines(fromText, toText);
  const leftLines = ops.filter((o) => o.type !== "added");
  const rightLines = ops.filter((o) => o.type !== "removed");

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <DiffColumn title="Было" tone="was">
        <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
          {leftLines.length === 0 ? (
            <span className="text-muted-foreground">— пусто —</span>
          ) : (
            leftLines.map((l, i) => (
              <span
                key={i}
                className={cn(
                  "block px-1",
                  l.type === "removed" && "bg-red-500/20 text-red-800 dark:text-red-300",
                  l.type === "unchanged" && "text-muted-foreground",
                )}
              >
                {l.text || "\u00A0"}
              </span>
            ))
          )}
        </pre>
      </DiffColumn>
      <DiffColumn title="Стало" tone="became">
        <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
          {rightLines.length === 0 ? (
            <span className="text-muted-foreground">— пусто —</span>
          ) : (
            rightLines.map((l, i) => (
              <span
                key={i}
                className={cn(
                  "block px-1",
                  l.type === "added" && "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
                  l.type === "unchanged" && "text-muted-foreground",
                )}
              >
                {l.text || "\u00A0"}
              </span>
            ))
          )}
        </pre>
      </DiffColumn>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidence diff
// ---------------------------------------------------------------------------

function ConfidenceDiff({
  fromConf,
  toConf,
}: {
  fromConf: Record<string, number>;
  toConf: Record<string, number>;
}) {
  const keys = Array.from(
    new Set([...Object.keys(fromConf), ...Object.keys(toConf)]),
  ).sort();
  if (keys.length === 0) {
    return <EmptyDiffHint text="Показатели уверенности не сохранены в обеих версиях." />;
  }
  const labels: Record<string, string> = {
    diagnosis: "Диагноз",
    therapy: "Терапия",
    prognosis: "Прогноз",
  };
  return (
    <div className="space-y-1.5">
      {keys.map((k) => {
        const from = fromConf[k];
        const to = toConf[k];
        const fromHas = typeof from === "number";
        const toHas = typeof to === "number";
        const delta = fromHas && toHas ? to - from : 0;
        const improved = delta > 0;
        const declined = delta < 0;
        return (
          <div
            key={k}
            className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs"
          >
            <span className="font-medium">{labels[k] ?? k}</span>
            <span className="font-mono text-muted-foreground">
              {fromHas ? from.toFixed(2) : "—"}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            <span className="font-mono font-semibold">{toHas ? to.toFixed(2) : "—"}</span>
            {fromHas && toHas && (
              <Badge
                variant="outline"
                className={cn(
                  "ml-auto gap-1 text-[10px]",
                  improved && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                  declined && "bg-red-500/15 text-red-700 dark:text-red-400",
                  !improved && !declined && "bg-muted text-muted-foreground",
                )}
              >
                {improved && <ArrowUp className="h-3 w-3" aria-hidden />}
                {declined && <ArrowDown className="h-3 w-3" aria-hidden />}
                {improved ? `+${delta.toFixed(2)}` : declined ? delta.toFixed(2) : "без изменений"}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections diff
// ---------------------------------------------------------------------------

function SectionsDiff({
  fromSections,
  toSections,
}: {
  fromSections: ConclusionSection[];
  toSections: ConclusionSection[];
}) {
  const diff = diffArrays(fromSections, toSections, (s) => s.title);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{fromSections.length}</span>
        <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden />
        <span className="font-mono">{toSections.length}</span> секций ·{" "}
        <span className="text-emerald-600">+{diff.added.length}</span>{" "}
        <span className="text-red-600">−{diff.removed.length}</span>
      </div>
      {diff.added.length === 0 && diff.removed.length === 0 && diff.unchanged.length === 0 ? (
        <EmptyDiffHint text="Секции отсутствуют в обеих версиях." />
      ) : (
        <ul className="space-y-1">
          {diff.added.map((s, i) => (
            <AddedItem key={`a-${i}`}>
              <span className="font-medium">{s.title}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                · {Math.round(s.confidence * 100)}% увер.
              </span>
            </AddedItem>
          ))}
          {diff.removed.map((s, i) => (
            <RemovedItem key={`r-${i}`}>
              <span className="font-medium">{s.title}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                · {Math.round(s.confidence * 100)}% увер.
              </span>
            </RemovedItem>
          ))}
          {diff.unchanged.map((s, i) => (
            <UnchangedItem key={`u-${i}`}>
              <span className="font-medium">{s.title}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                · {Math.round(s.confidence * 100)}% увер.
              </span>
            </UnchangedItem>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mutations diff
// ---------------------------------------------------------------------------

function MutationsDiff({
  fromMuts,
  toMuts,
}: {
  fromMuts: Mutation[];
  toMuts: Mutation[];
}) {
  const diff = diffArrays(fromMuts, toMuts, (m) => `${m.gene}:${m.variant}`);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{fromMuts.length}</span>
        <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden />
        <span className="font-mono">{toMuts.length}</span> вариантов ·{" "}
        <span className="text-emerald-600">+{diff.added.length}</span>{" "}
        <span className="text-red-600">−{diff.removed.length}</span>
      </div>
      {diff.added.length === 0 && diff.removed.length === 0 && diff.unchanged.length === 0 ? (
        <EmptyDiffHint text="Генетические варианты не выявлены в обеих версиях." />
      ) : (
        <ul className="space-y-1">
          {diff.added.map((m, i) => (
            <AddedItem key={`a-${i}`}>
              <span className="font-mono font-semibold">{m.gene}</span>{" "}
              <span className="text-xs">{m.variant}</span>
            </AddedItem>
          ))}
          {diff.removed.map((m, i) => (
            <RemovedItem key={`r-${i}`}>
              <span className="font-mono font-semibold">{m.gene}</span>{" "}
              <span className="text-xs">{m.variant}</span>
            </RemovedItem>
          ))}
          {diff.unchanged.map((m, i) => (
            <UnchangedItem key={`u-${i}`}>
              <span className="font-mono font-semibold">{m.gene}</span>{" "}
              <span className="text-xs">{m.variant}</span>
            </UnchangedItem>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DDI alerts diff
// ---------------------------------------------------------------------------

function DDIDiff({ fromDDI, toDDI }: { fromDDI: DDIAlert[]; toDDI: DDIAlert[] }) {
  const diff = diffArrays(fromDDI, toDDI, (a) => `${a.drug1}+${a.drug2}`);
  const overriddenInTo = toDDI.filter((a) => a.override?.overridden === true);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{fromDDI.length}</span>
        <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden />
        <span className="font-mono">{toDDI.length}</span> взаимодействий ·{" "}
        <span className="text-emerald-600">+{diff.added.length}</span>{" "}
        <span className="text-red-600">−{diff.removed.length}</span>
        {overriddenInTo.length > 0 && (
          <>
            {" · "}
            <span className="text-amber-600">
              отменено: {overriddenInTo.length}
            </span>
          </>
        )}
      </div>
      {diff.added.length === 0 && diff.removed.length === 0 && diff.unchanged.length === 0 ? (
        <EmptyDiffHint text="DDI-предупреждения отсутствуют в обеих версиях." />
      ) : (
        <ul className="space-y-1">
          {diff.added.map((a, i) => (
            <AddedItem key={`a-${i}`}>
              <span className="font-medium">{a.drug1} + {a.drug2}</span>
              <span className="ml-1 text-xs text-muted-foreground">· {a.severity}</span>
            </AddedItem>
          ))}
          {diff.removed.map((a, i) => (
            <RemovedItem key={`r-${i}`}>
              <span className="font-medium">{a.drug1} + {a.drug2}</span>
              <span className="ml-1 text-xs text-muted-foreground">· {a.severity}</span>
            </RemovedItem>
          ))}
          {diff.unchanged.map((a, i) => {
            const isOverridden = a.override?.overridden === true;
            return (
              <UnchangedItem key={`u-${i}`}>
                <span className="font-medium">{a.drug1} + {a.drug2}</span>
                <span className="ml-1 text-xs text-muted-foreground">· {a.severity}</span>
                {isOverridden && (
                  <Badge
                    variant="outline"
                    className="ml-2 bg-amber-500/15 text-xs text-amber-700 dark:text-amber-400"
                  >
                    отменено врачом
                  </Badge>
                )}
              </UnchangedItem>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ICD-10 diff
// ---------------------------------------------------------------------------

function ICD10Diff({
  fromCodes,
  toCodes,
}: {
  fromCodes: ICD10CodeMatch[];
  toCodes: ICD10CodeMatch[];
}) {
  const diff = diffArrays(fromCodes, toCodes, (c) => c.code);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{fromCodes.length}</span>
        <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden />
        <span className="font-mono">{toCodes.length}</span> кодов ·{" "}
        <span className="text-emerald-600">+{diff.added.length}</span>{" "}
        <span className="text-red-600">−{diff.removed.length}</span>
      </div>
      {diff.added.length === 0 && diff.removed.length === 0 && diff.unchanged.length === 0 ? (
        <EmptyDiffHint text="МКБ-10 коды не сохранены в обеих версиях." />
      ) : (
        <ul className="space-y-1">
          {diff.added.map((c, i) => (
            <AddedItem key={`a-${i}`}>
              <span className="font-mono font-semibold">{c.code}</span>{" "}
              <span className="text-xs">{c.description}</span>
            </AddedItem>
          ))}
          {diff.removed.map((c, i) => (
            <RemovedItem key={`r-${i}`}>
              <span className="font-mono font-semibold">{c.code}</span>{" "}
              <span className="text-xs">{c.description}</span>
            </RemovedItem>
          ))}
          {diff.unchanged.map((c, i) => (
            <UnchangedItem key={`u-${i}`}>
              <span className="font-mono font-semibold">{c.code}</span>{" "}
              <span className="text-xs">{c.description}</span>
            </UnchangedItem>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version list item
// ---------------------------------------------------------------------------

function VersionListItem({
  row,
  currentDoctorId,
  isSelected,
  selectionRole,
  onSelect,
}: {
  row: VersionRow;
  currentDoctorId: string | null;
  isSelected: boolean;
  selectionRole: "from" | "to" | null;
  onSelect: (role: "from" | "to") => void;
}) {
  const doctorName =
    row.doctorId && row.doctorId === currentDoctorId
      ? "Вы"
      : row.doctorId
        ? `Врач #${row.doctorId.slice(-6)}`
        : "—";
  return (
    <div
      className={cn(
        "rounded-md border p-2.5 transition-colors",
        isSelected
          ? selectionRole === "from"
            ? "border-red-500/50 bg-red-500/5"
            : "border-emerald-500/50 bg-emerald-500/5"
          : "hover:bg-accent/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            row.isCurrent
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          v{row.version}
        </Badge>
        {row.isCurrent && (
          <Badge
            variant="outline"
            className="bg-amber-500/15 text-xs text-amber-700 dark:text-amber-400"
          >
            текущая
          </Badge>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {relativeTime(row.createdAt)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(row.createdAt)}</TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs text-foreground">
        {row.changeNote || "Без описания"}
      </p>
      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <User className="h-3 w-3" aria-hidden />
        {doctorName}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <Button
          size="sm"
          variant={selectionRole === "from" ? "default" : "outline"}
          className={cn(
            "h-7 gap-1 px-2 text-[11px]",
            selectionRole === "from"
              ? "bg-red-600 hover:bg-red-700"
              : "border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400",
          )}
          onClick={() => onSelect("from")}
          aria-pressed={selectionRole === "from"}
          aria-label={`Выбрать v${row.version} как «было»`}
        >
          <Minus className="h-3 w-3" aria-hidden />
          Было
        </Button>
        <Button
          size="sm"
          variant={selectionRole === "to" ? "default" : "outline"}
          className={cn(
            "h-7 gap-1 px-2 text-[11px]",
            selectionRole === "to"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
          )}
          onClick={() => onSelect("to")}
          aria-pressed={selectionRole === "to"}
          aria-label={`Выбрать v${row.version} как «стало»`}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Стало
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function VersionHistoryDialog({
  caseId,
  currentVersion,
  open,
  onOpenChange,
}: Props) {
  const { currentDoctor } = useAppStore();
  const currentDoctorId = currentDoctor?.id ?? null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["analysis-versions", caseId],
    queryFn: () => fetchVersions(caseId),
    enabled: open,
    staleTime: 30_000,
  });

  const versions = data?.versions ?? [];

  // Default selection: previous version → current (newest).
  // versions[] is sorted DESC by version (newest first).
  const [fromVersion, setFromVersion] = React.useState<number | null>(null);
  const [toVersion, setToVersion] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (versions.length === 0) {
      setFromVersion(null);
      setToVersion(null);
      return;
    }
    // Newest = versions[0]; second-newest = versions[1] (if exists).
    const newest = versions[0];
    const previous = versions[1] ?? versions[0];
    setToVersion((cur) => cur ?? newest.version);
    setFromVersion((cur) => cur ?? previous.version);
  }, [open, versions]);

  // Reset selection when dialog closes so reopening re-defaults cleanly.
  React.useEffect(() => {
    if (!open) {
      setFromVersion(null);
      setToVersion(null);
    }
  }, [open]);

  const fromRow = versions.find((v) => v.version === fromVersion) ?? null;
  const toRow = versions.find((v) => v.version === toVersion) ?? null;

  const handleSelect = (role: "from" | "to", version: number) => {
    if (role === "from") {
      // If user picks the same version as "to", swap them so the diff stays meaningful.
      if (version === toVersion && versions.length > 1) {
        const other = versions.find((v) => v.version !== version);
        if (other) setToVersion(other.version);
      }
      setFromVersion(version);
    } else {
      if (version === fromVersion && versions.length > 1) {
        const other = versions.find((v) => v.version !== version);
        if (other) setFromVersion(other.version);
      }
      setToVersion(version);
    }
  };

  // ----- Pull snapshot fields -----
  const fromSnap = fromRow?.snapshot;
  const toSnap = toRow?.snapshot;
  const fromConclusion = readStr(fromSnap, "conclusion");
  const toConclusion = readStr(toSnap, "conclusion");
  const fromConfidence = readObj(fromSnap, "confidence");
  const toConfidence = readObj(toSnap, "confidence");
  const fromSections = readArr<ConclusionSection>(fromSnap, "sections");
  const toSections = readArr<ConclusionSection>(toSnap, "sections");
  const fromMutations = readArr<Mutation>(fromSnap, "mutations");
  const toMutations = readArr<Mutation>(toSnap, "mutations");
  const fromDDI = readArr<DDIAlert>(fromSnap, "ddiAlerts");
  const toDDI = readArr<DDIAlert>(toSnap, "ddiAlerts");
  const fromICD = readArr<ICD10CodeMatch>(fromSnap, "icd10Suggestions");
  const toICD = readArr<ICD10CodeMatch>(toSnap, "icd10Suggestions");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl md:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-emerald-600" />
            История версий анализа
          </DialogTitle>
          <DialogDescription>
            Сравнение версий заключения и supporting evidence. Текущая версия:{" "}
            <span className="font-mono font-semibold">v{currentVersion}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Restoration note */}
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Восстановление версий будет добавлено в следующем релизе. Сейчас
            сравнение доступно только для просмотра.
          </span>
        </div>

        {/* Body: left sidebar (version list) + main (diff) */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <div className="md:max-h-[60vh] md:overflow-y-auto">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Версии ({versions.length})
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-md" />
                ))}
              </div>
            ) : isError ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-400">
                <AlertCircle className="mb-1 h-4 w-4" aria-hidden />
                Не удалось загрузить версии: {(error as Error).message}
              </div>
            ) : versions.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                Версии не найдены.
              </div>
            ) : versions.length === 1 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                Доступна только одна версия анализа. Запустите анализ повторно,
                чтобы создать новую версию для сравнения.
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((row) => (
                  <VersionListItem
                    key={row.id}
                    row={row}
                    currentDoctorId={currentDoctorId}
                    isSelected={
                      row.version === fromVersion || row.version === toVersion
                    }
                    selectionRole={
                      row.version === fromVersion
                        ? "from"
                        : row.version === toVersion
                          ? "to"
                          : null
                    }
                    onSelect={(role) => handleSelect(role, row.version)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Diff pane */}
          <div className="min-w-0">
            {/* Selection summary */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <GitCompareArrows className="h-4 w-4 text-emerald-600" aria-hidden />
              <span className="font-semibold">Сравнение:</span>
              <Badge
                variant="outline"
                className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
              >
                Было: v{fromRow?.version ?? "—"}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              >
                Стало: v{toRow?.version ?? "—"}
              </Badge>
              {(fromRow?.changeNote || toRow?.changeNote) && (
                <span className="ml-auto text-muted-foreground">
                  {fromRow?.changeNote || "—"} → {toRow?.changeNote || "—"}
                </span>
              )}
            </div>

            {/* Diff body */}
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 -mr-1">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-32 w-full rounded-md" />
                  <Skeleton className="h-24 w-full rounded-md" />
                  <Skeleton className="h-24 w-full rounded-md" />
                </div>
              ) : !fromRow || !toRow ? (
                <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  Выберите две версии для сравнения.
                </div>
              ) : fromRow.version === toRow.version ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-center text-sm text-amber-700 dark:text-amber-400">
                  Выбраны одинаковые версии. Укажите разные «Было» и «Стало».
                </div>
              ) : (
                <>
                  {/* Conclusion */}
                  <DiffRow
                    icon={<FileText className="h-4 w-4 text-emerald-600" aria-hidden />}
                    label="Заключение"
                  >
                    <ConclusionDiff fromText={fromConclusion} toText={toConclusion} />
                  </DiffRow>

                  {/* Confidence */}
                  <DiffRow
                    icon={<TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden />}
                    label="Уверенность модели"
                  >
                    <ConfidenceDiff fromConf={fromConfidence} toConf={toConfidence} />
                  </DiffRow>

                  {/* Sections */}
                  <DiffRow
                    icon={<Layers className="h-4 w-4 text-emerald-600" aria-hidden />}
                    label="Структурированные секции"
                  >
                    <SectionsDiff fromSections={fromSections} toSections={toSections} />
                  </DiffRow>

                  {/* Mutations */}
                  <DiffRow
                    icon={<Dna className="h-4 w-4 text-emerald-600" aria-hidden />}
                    label="Генетические варианты"
                  >
                    <MutationsDiff fromMuts={fromMutations} toMuts={toMutations} />
                  </DiffRow>

                  {/* DDI */}
                  <DiffRow
                    icon={<ShieldAlert className="h-4 w-4 text-emerald-600" aria-hidden />}
                    label="DDI-предупреждения"
                  >
                    <DDIDiff fromDDI={fromDDI} toDDI={toDDI} />
                  </DiffRow>

                  {/* ICD-10 */}
                  <DiffRow
                    icon={<Code className="h-4 w-4 text-emerald-600" aria-hidden />}
                    label="МКБ-10 коды"
                  >
                    <ICD10Diff fromCodes={fromICD} toCodes={toICD} />
                  </DiffRow>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer — disabled restoration button */}
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Сравнение носит информационный характер.
          </p>
          <Button
            variant="outline"
            disabled
            className="gap-2 opacity-60"
            aria-label="Восстановление версий будет добавлено в следующем релизе"
            title="Восстановление версий будет добавлено в следующем релизе"
          >
            <History className="h-4 w-4" aria-hidden />
            Восстановить эту версию
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
