"use client";

import * as React from "react";
import {
  AlertTriangle,
  Dna,
  FileText,
  Image as ImageIcon,
  BookOpen,
  Quote,
  Loader2,
  Cpu,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
  Pill,
  Activity,
  Code,
  History,
  Stethoscope,
  Landmark,
  ListChecks,
  ListTree,
  HeartPulse,
  AlignLeft,
  ChevronRight,
  Check,
  X,
  Globe,
  Search,
  LayoutDashboard,
  ScanSearch,
  Copy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AnalysisResultData,
  Citation,
  DDIAlert,
  DifferentialDiagnosis,
  TherapyOption,
} from "@/lib/types";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatDateTime } from "@/lib/utils";
import { VersionHistoryDialog } from "@/components/shared/version-history-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkupPlanTracker } from "@/components/shared/workup-tracker";
import { AnalysisAuditPanel } from "@/components/shared/analysis-audit-panel";
import { auditAnalysis } from "@/lib/clinical-audit";
import { workupKey, workupProgress, workupStatusMeta } from "@/lib/workup";
import { hypothesesLabel, therapyOptionsLabel } from "@/lib/plural";

const MIN_REASON_LENGTH = 10;

/**
 * Strip markdown formatting from text so it displays as plain text.
 * Removes: **bold**, *italic*, ### headings, `code`, ~~strike~~, [link](url),
 * markdown list markers (-, *, 1.), and excessive whitespace.
 * This prevents the "****" artifacts the user reported.
 */
function stripMarkdown(text: string): string {
  if (!text) return "";
  return text
    // Remove markdown code fences ```...```
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim())
    // Remove bold **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    // Remove italic *text* or _text_ (but not standalone * as bullet)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1")
    // Remove strikethrough ~~text~~
    .replace(/~~(.+?)~~/g, "$1")
    // Remove inline code `text`
    .replace(/`(.+?)`/g, "$1")
    // Remove markdown links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove heading markers ### at start of lines
    .replace(/^#{1,6}\s+/gm, "")
    // Remove markdown list markers at start of lines (-, *, +, 1.)
    .replace(/^[\s]*[-*+]\s+/gm, "• ")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Remove horizontal rules ---
    .replace(/^---+$/gm, "")
    // Remove blockquote markers >
    .replace(/^>\s+/gm, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ===========================================================================
// v5.0 helpers — структурированные клинические данные (analysis.structured)
// ===========================================================================

/** Ограничивает число диапазоном 0..1 (данные ИИ могут быть грязными). */
function clamp01(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

/** Сортировка гипотез диф. диагноза: rank по возрастанию, затем probability по убыванию. */
function sortDifferential(list: DifferentialDiagnosis[]): DifferentialDiagnosis[] {
  return [...list].sort((a, b) => {
    const ra = typeof a.rank === "number" ? a.rank : 999;
    const rb = typeof b.rank === "number" ? b.rank : 999;
    if (ra !== rb) return ra - rb;
    return clamp01(b.probability) - clamp01(a.probability);
  });
}

/** Стабильный ключ гипотезы для Accordion. */
function dxKey(dx: DifferentialDiagnosis, index: number): string {
  return `dx-${dx.rank ?? index + 1}`;
}

/** Русская плюрализация слова «проход» (1 проход / 2 прохода / 5 проходов). */

type SourceBadgeInfo = { label: string; icon: LucideIcon; className: string };

const SOURCE_FALLBACK: SourceBadgeInfo = {
  label: "Междунар. источник",
  icon: Globe,
  className: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

/**
 * Классификация источника по его строковому идентификатору/URL.
 * Используется для бейджей цитат (XAI), источников гипотез и вариантов терапии.
 */
function classifySource(source?: string, location?: string): SourceBadgeInfo {
  const hay = `${source ?? ""} ${location ?? ""}`.toLowerCase();
  if (source === "web_rag" || hay.includes("minzdrav") || hay.includes("минздрав")) {
    return {
      label: "КР Минздрава РФ",
      icon: Landmark,
      className: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    };
  }
  if (source === "recommendation") {
    return {
      label: "Локальная база",
      icon: BookOpen,
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (source === "document") {
    return {
      label: "Документ",
      icon: FileText,
      className: "border-gray-500/40 bg-gray-500/10 text-gray-700 dark:text-gray-300",
    };
  }
  if (hay.includes("pubmed")) return { ...SOURCE_FALLBACK, label: "PubMed" };
  if (hay.includes("nice.org.uk") || hay.includes("nice.org")) return { ...SOURCE_FALLBACK, label: "NICE" };
  if (hay.includes("who.int")) return { ...SOURCE_FALLBACK, label: "ВОЗ" };
  if (hay.includes("cochrane")) return { ...SOURCE_FALLBACK, label: "Cochrane" };
  if (hay.includes("cdc.gov")) return { ...SOURCE_FALLBACK, label: "CDC" };
  if (hay.includes("escardio.org")) return { ...SOURCE_FALLBACK, label: "ESC" };
  return SOURCE_FALLBACK;
}

/** Компактный бейдж источника с иконкой и цветовой кодировкой. */
function SourceBadge({
  source,
  location,
  fallbackToRaw,
}: {
  source?: string;
  location?: string;
  /** Для человекочитаемых строк: при нераспознанном источнике показать исходный текст. */
  fallbackToRaw?: boolean;
}) {
  const info = classifySource(source, location);
  const isFallback = info.label === SOURCE_FALLBACK.label;
  const label = isFallback && fallbackToRaw && source ? source : info.label;
  const Icon = info.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", info.className)} title={location ?? source}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </Badge>
  );
}

/** Группы приоритета плана дообследования (в порядке важности). */

/** Цвет полосы вероятности: ≥70% зелёный, 40–70% янтарный, <40% серый. */
function probabilityBarCls(pct: number): string {
  if (pct >= 70) return "[&>div]:bg-emerald-500";
  if (pct >= 40) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-gray-400";
}

interface Props {
  analysis: AnalysisResultData;
  caseId: string;
  onRunAnalysis: (manual: boolean) => void;
  isAnalyzing: boolean;
  hasDocuments: boolean;
}

type PanelTab =
  | "overview"
  | "diagnoses"
  | "workup"
  | "therapy"
  | "monitoring"
  | "evidence"
  | "raw"
  | "audit";

const TAB_LABELS: Array<{ key: PanelTab; label: string; icon: LucideIcon }> = [
  { key: "overview", label: "Обзор", icon: LayoutDashboard },
  { key: "diagnoses", label: "Гипотезы", icon: ListTree },
  { key: "workup", label: "Обследование", icon: ListChecks },
  { key: "therapy", label: "Терапия", icon: Pill },
  { key: "monitoring", label: "Контроль", icon: HeartPulse },
  { key: "evidence", label: "Источники", icon: BookOpen },
  { key: "raw", label: "Текст ИИ", icon: AlignLeft },
  { key: "audit", label: "Проверка", icon: ScanSearch },
];

export function AnalysisPanel({ analysis, caseId, onRunAnalysis, isAnalyzing, hasDocuments }: Props) {
  const [activeCitation, setActiveCitation] = React.useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false);
  const [tab, setTab] = React.useState<PanelTab>("overview");

  const confidence = analysis.confidence ?? {};
  const sections = analysis.sections ?? [];
  const mutations = analysis.mutations ?? [];
  const recommendations = analysis.recommendations ?? [];
  const citations = analysis.citations ?? [];
  const imageFindings = analysis.imageFindings ?? [];
  const icd10Suggestions = analysis.icd10Suggestions ?? [];
  const pathwayMatches = analysis.pathwayMatches ?? [];

  // v5.0: структурированные данные. У старых анализов поле может отсутствовать
  // или быть пустым — везде предусмотрены fallback-значения ([]), и панель
  // просто не показывает новые блоки, оставаясь на текстовых разделах.
  const structured = analysis.structured;
  const differential = React.useMemo(
    () => sortDifferential(structured?.differential ?? []),
    [structured],
  );
  const workupPlan = structured?.workupPlan ?? [];
  const therapyOptions = structured?.therapyOptions ?? [];
  const monitoringPlan = structured?.monitoringPlan ?? [];
  const verification = structured?.verification;
  const corrections = verification?.corrections ?? [];
  // v5.1 (audit 9 / partial 5): hard workflow gate.
  const confirmedDx: string[] = Array.isArray(structured?.confirmedDx)
    ? structured.confirmedDx
    : [];
  // We keep an optimistic local copy so the UI reacts instantly when the
  // doctor clicks "Подтвердить диагноз" without waiting for the mutation.
  const [optimisticConfirmed, setOptimisticConfirmed] = React.useState<string[]>([]);
  const effectiveConfirmed = React.useMemo(() => {
    // Merge server-side + optimistic, dedupe case-insensitively.
    const set = new Set<string>();
    for (const d of confirmedDx) set.add(d.toLowerCase());
    const merged: string[] = [...confirmedDx];
    for (const d of optimisticConfirmed) {
      if (!set.has(d.toLowerCase())) {
        merged.push(d);
        set.add(d.toLowerCase());
      }
    }
    return merged;
  }, [confirmedDx, optimisticConfirmed]);
  // Reset optimistic when server data changes (e.g. after re-fetch).
  React.useEffect(() => {
    setOptimisticConfirmed([]);
  }, [JSON.stringify(confirmedDx)]);

  const qc = useQueryClient();
  const confirmDxMutation = useMutation({
    mutationFn: async ({
      diagnosis,
      action,
      evidence,
    }: {
      diagnosis: string;
      action: "confirm_dx" | "unconfirm_dx";
      evidence?: string;
    }) => api.confirmDx(caseId, diagnosis, action, evidence),
    onSuccess: () => {
      // The parent's analysis query will refetch and authoritative data
      // will arrive. Optimistic UI may be cleared on the next render.
      qc.invalidateQueries({ queryKey: ["analysis", caseId] });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Не удалось сохранить";
      toast.error(`Подтверждение диагноза не сохранено: ${msg}`);
      // Roll back optimistic on error: invalidate to re-fetch server state.
      qc.invalidateQueries({ queryKey: ["analysis", caseId] });
    },
  });

  const isDxConfirmed = React.useCallback(
    (dx: string) =>
      effectiveConfirmed.some((d) => d.toLowerCase() === dx.toLowerCase()),
    [effectiveConfirmed],
  );

  const handleConfirmDx = React.useCallback(
    (dx: string, action: "confirm_dx" | "unconfirm_dx", evidence?: string) => {
      // Optimistic UI: apply immediately for responsiveness.
      setOptimisticConfirmed((prev) => {
        if (action === "confirm_dx") {
          return prev.some((d) => d.toLowerCase() === dx.toLowerCase())
            ? prev
            : [...prev, dx];
        }
        return prev.filter((d) => d.toLowerCase() !== dx.toLowerCase());
      });
      confirmDxMutation.mutate({ diagnosis: dx, action, evidence });
    },
    [confirmDxMutation],
  );

  const handleCitationClick = (cit: Citation) => {
    setActiveCitation(cit.claim);
    setTimeout(() => setActiveCitation(null), 3000);
  };

  // Version history button: enabled only when there are at least 2 versions
  // to compare. The analysis.version counter starts at 1 (initial analysis),
  // and each re-run snapshots the prior state and bumps the counter — so
  // analysis.version >= 2 implies at least one historical snapshot exists.
  const currentVersion = analysis.version ?? 1;
  const canCompareVersions = currentVersion >= 2;

  // v5.2: детерминированная проверка набора рекомендаций. Считается на клиенте
  // из уже сохранённой структуры — врач видит её сразу после анализа, а не
  // только в момент генерации.
  const audit = React.useMemo(
    () => auditAnalysis({ structured, citationsCount: citations.length }),
    [structured, citations.length],
  );
  const planProgress = React.useMemo(
    () => workupProgress(workupPlan, structured?.workupTracker),
    [workupPlan, structured?.workupTracker],
  );

  const topDx = differential[0];
  const topPct = topDx ? Math.round(clamp01(topDx.probability) * 100) : 0;
  const urgentItems = workupPlan.filter((w) => (w.priority ?? "routine") === "urgent");
  const unlockedTherapy = therapyOptions.filter(
    (t) => t.targetDx && effectiveConfirmed.some((d) => d.toLowerCase() === t.targetDx!.toLowerCase()),
  ).length;
  const hasStructured =
    differential.length > 0 ||
    workupPlan.length > 0 ||
    therapyOptions.length > 0 ||
    monitoringPlan.length > 0;
  const safety = structured?.patientSafety;

  const jumpTo = (next: PanelTab) => setTab(next);

  const copyConclusion = React.useCallback(async () => {
    const text = [analysis.conclusion, ...sections.map((s) => `### ${s.title}\n${s.content}`)]
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) {
      toast.error("Заключение пусто");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Заключение скопировано");
    } catch {
      toast.error("Браузер запретил доступ к буферу обмена");
    }
  }, [analysis.conclusion, sections]);

  const kpiClass =
    "flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-3">
      {/* ================================================================
          ШАПКА: версия, самопроверка, действия + KPI-полоса
          ================================================================ */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-medical-gradient-soft px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Cpu className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold">Результат ИИ-анализа</span>
                <Badge variant="outline" className="bg-background/70 text-[10px]">
                  v{currentVersion}
                </Badge>
                {verification?.performed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="cursor-help gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400"
                      >
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        самопроверка: {verification.passes ?? 1}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <p className="text-xs font-semibold">Самопроверка ИИ (verification pass)</p>
                      {corrections.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                          {corrections.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs">Существенных расхождений не найдено.</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Гипотезы с обоснованием → план обследования с подсказками → терапия
                после подтверждения диагноза
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 bg-background/60"
                    disabled={!canCompareVersions}
                    onClick={() => setVersionHistoryOpen(true)}
                    aria-label="Открыть историю версий анализа"
                  >
                    <History className="h-3.5 w-3.5" aria-hidden />
                    История
                    {canCompareVersions && (
                      <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
                        {currentVersion}
                      </Badge>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {canCompareVersions
                  ? `Доступно версий: ${currentVersion}. Нажмите, чтобы сравнить.`
                  : "Запустите анализ повторно, чтобы появилась новая версия для сравнения."}
              </TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onRunAnalysis(false)}
              disabled={isAnalyzing || !hasDocuments}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Анализ…
                </>
              ) : (
                <>
                  <Cpu className="h-3.5 w-3.5" aria-hidden />
                  Повторить анализ
                </>
              )}
            </Button>
          </div>
        </div>

        {/* KPI-полоса: 4 кликабельные сводки */}
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <button type="button" className={kpiClass} onClick={() => jumpTo("diagnoses")}>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Рабочий диагноз
            </span>
            <span className="line-clamp-2 text-xs font-semibold leading-snug">
              {topDx ? topDx.diagnosis : "не сформирован"}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {hypothesesLabel(differential.length)}
              {topDx && <span className="font-bold tabular-nums text-foreground">{topPct}%</span>}
            </span>
          </button>
          <button type="button" className={kpiClass} onClick={() => jumpTo("workup")}>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              План обследования
            </span>
            <span className="text-xs font-semibold tabular-nums">
              {planProgress.done} / {workupPlan.length} выполнено
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {urgentItems.length > 0 ? (
                <span className="font-semibold text-red-600 dark:text-red-400">
                  срочных: {urgentItems.length}
                </span>
              ) : (
                <span>срочных нет</span>
              )}
              <span>· {planProgress.withResult} с результатом</span>
            </span>
          </button>
          <button type="button" className={kpiClass} onClick={() => jumpTo("therapy")}>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Терапия
            </span>
            <span className="text-xs font-semibold tabular-nums">
              {therapyOptionsLabel(therapyOptions.length)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              разблокировано: {unlockedTherapy} из {therapyOptions.length}
            </span>
          </button>
          <button type="button" className={kpiClass} onClick={() => jumpTo("audit")}>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Проверка набора
            </span>
            <span
              className={cn(
                "text-xs font-semibold tabular-nums",
                audit.score >= 85
                  ? "text-emerald-700 dark:text-emerald-400"
                  : audit.score >= 65
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-red-700 dark:text-red-400",
              )}
            >
              {audit.score} / 100
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {audit.critical > 0 ? (
                <span className="font-semibold text-red-600 dark:text-red-400">
                  критично: {audit.critical}
                </span>
              ) : (
                <span>критичных нет</span>
              )}
              <span>· {audit.warning} на внимание</span>
            </span>
          </button>
        </div>

        {/* Вкладки */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="gap-0">
          <div className="overflow-x-auto border-b bg-muted/30 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-9 w-max min-w-full justify-start gap-0.5 rounded-none bg-transparent p-1">
              {TAB_LABELS.map(({ key, label, icon: Icon }) => {
                const count =
                  key === "diagnoses"
                    ? differential.length
                    : key === "workup"
                      ? workupPlan.length
                      : key === "therapy"
                        ? therapyOptions.length
                        : key === "monitoring"
                          ? monitoringPlan.length
                          : key === "evidence"
                            ? citations.length + recommendations.length
                            : key === "audit"
                              ? audit.findings.length
                              : 0;
                return (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="h-7 flex-none gap-1 px-2.5 text-[11px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                    {count > 0 && (
                      <span
                        className={cn(
                          "rounded px-1 text-[10px] tabular-nums",
                          key === "audit" && audit.critical > 0
                            ? "bg-red-500/15 text-red-700 dark:text-red-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {/* ============================================================
              ОБЗОР — что решает врач сейчас
              ============================================================ */}
          <TabsContent value="overview" className="space-y-3 p-3">
            {!hasStructured && (
              <Alert className="border-amber-500/40 bg-amber-500/5 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">
                  Структурированный разбор отсутствует
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Для этого анализа нет блока гипотез/обследования/терапии (старая
                  версия или структуризатор не справился). Текст заключения
                  доступен во вкладке «Текст ИИ», источники — в «Источниках».
                  Повторите анализ, чтобы получить структурированное заключение.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                {/* Рабочий диагноз */}
                {topDx ? (
                  <Card className="gap-3 overflow-hidden rounded-lg border-l-4 border-l-primary py-3">
                    <CardHeader className="px-3 pb-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Stethoscope className="h-4 w-4 text-primary" aria-hidden />
                          Рабочий диагноз
                        </CardTitle>
                        {topDx.icd10 && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] text-teal-700 dark:text-teal-300"
                          >
                            {topDx.icd10}
                          </Badge>
                        )}
                        {isDxConfirmed(topDx.diagnosis) ? (
                          <Badge className="gap-1 bg-teal-600 text-[10px] text-white">
                            <ShieldCheck className="h-3 w-3" aria-hidden />
                            подтверждён
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            не подтверждён
                          </Badge>
                        )}
                        <span className="ml-auto text-lg font-bold tabular-nums">{topPct}%</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2.5 px-3">
                      <div>
                        <div className="text-sm font-semibold leading-snug">{topDx.diagnosis}</div>
                        <Progress
                          value={topPct}
                          className={cn("mt-1.5 h-1.5", probabilityBarCls(topPct))}
                          aria-label={`Вероятность рабочего диагноза: ${topPct}%`}
                        />
                      </div>

                      {(topDx.argumentsFor ?? []).length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                            Аргументы за
                          </div>
                          <ul className="space-y-0.5 text-xs leading-snug">
                            {(topDx.argumentsFor ?? []).slice(0, 3).map((a, i) => (
                              <li key={i} className="flex gap-1.5">
                                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                                <span>{stripMarkdown(a)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(topDx.argumentsAgainst ?? []).length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                            Что не укладывается
                          </div>
                          <ul className="space-y-0.5 text-xs leading-snug">
                            {(topDx.argumentsAgainst ?? []).slice(0, 2).map((a, i) => (
                              <li key={i} className="flex gap-1.5">
                                <X className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden />
                                <span>{stripMarkdown(a)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(topDx.redFlags ?? []).length > 0 && (
                        <RedFlagsAlert flags={topDx.redFlags ?? []} />
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                        {!isDxConfirmed(topDx.diagnosis) && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2.5 text-[11px]"
                            disabled={confirmDxMutation.isPending}
                            onClick={() => jumpTo("diagnoses")}
                          >
                            <ShieldCheck className="h-3 w-3" aria-hidden />
                            Подтвердить после обследования
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[11px] text-primary"
                          onClick={() => jumpTo("diagnoses")}
                        >
                          Все {differential.length} гипотез
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </Button>
                        {topDx.clinrecCode && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-teal-500/40 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-300"
                          >
                            <Landmark className="h-3 w-3" aria-hidden />
                            КР Минздрава {topDx.clinrecCode}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="gap-3 py-3">
                    <CardContent className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                      <ListTree className="h-8 w-8 text-muted-foreground/50" aria-hidden />
                      <p className="text-sm font-medium">Гипотезы не сформированы</p>
                      <p className="max-w-md text-xs text-muted-foreground">
                        Без дифференциального ряда план обследования и терапия не
                        строятся. Проверьте документы случая и повторите анализ.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Срочные исследования */}
                {urgentItems.length > 0 && (
                  <Card className="gap-3 rounded-lg border-l-4 border-l-red-500 py-3">
                    <CardHeader className="px-3 pb-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
                          Срочно — выполнить первыми
                        </CardTitle>
                        <Badge variant="outline" className="text-[10px]">
                          {urgentItems.length}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 px-1.5 text-[10px] text-primary"
                          onClick={() => jumpTo("workup")}
                        >
                          Отметить выполнение
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1.5 px-3">
                      {urgentItems.slice(0, 4).map((item, i) => {
                        const entry = structured?.workupTracker?.[workupKey(item, i)];
                        const meta = workupStatusMeta(entry?.status);
                        return (
                          <div
                            key={`${item.name}-${i}`}
                            className="flex flex-wrap items-center gap-1.5 rounded-md border p-2"
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotCls)} aria-hidden />
                            <span className="text-xs font-medium">{item.name}</span>
                            {item.timing && (
                              <Badge variant="outline" className="text-[10px]">
                                {item.timing}
                              </Badge>
                            )}
                            <Badge variant="outline" className={cn("ml-auto text-[10px]", meta.badgeCls)}>
                              {meta.short}
                            </Badge>
                          </div>
                        );
                      })}
                      {urgentItems.length > 4 && (
                        <p className="text-[11px] text-muted-foreground">
                          и ещё {urgentItems.length - 4} срочных исследования
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Правая колонка: проверка, безопасность, уверенность */}
              <div className="space-y-3">
                <Card className="gap-3 rounded-lg py-3">
                  <CardHeader className="px-3 pb-1.5">
                    <div className="flex items-center gap-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ScanSearch className="h-4 w-4 text-primary" aria-hidden />
                        Проверка рекомендаций
                      </CardTitle>
                      <span
                        className={cn(
                          "ml-auto text-base font-bold tabular-nums",
                          audit.score >= 85
                            ? "text-emerald-700 dark:text-emerald-400"
                            : audit.score >= 65
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-red-700 dark:text-red-400",
                        )}
                      >
                        {audit.score}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1.5 px-3">
                    {audit.findings.slice(0, 3).map((f) => (
                      <div key={f.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
                        <span
                          className={cn(
                            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                            f.severity === "critical"
                              ? "bg-red-500"
                              : f.severity === "warning"
                                ? "bg-amber-500"
                                : "bg-slate-400",
                          )}
                          aria-hidden
                        />
                        <span className={cn(f.severity === "info" && "text-muted-foreground")}>
                          {f.title}
                        </span>
                      </div>
                    ))}
                    {audit.findings.length === 0 && (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        Формальных замечаний нет.
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1 h-7 w-full gap-1 text-[11px]"
                      onClick={() => jumpTo("audit")}
                    >
                      Все замечания ({audit.findings.length})
                      <ChevronRight className="h-3 w-3" aria-hidden />
                    </Button>
                  </CardContent>
                </Card>

                {(safety?.allergies?.length || safety?.renal || safety?.activeMedications?.length) && (
                  <Card className="gap-3 rounded-lg py-3">
                    <CardHeader className="px-3 pb-1.5">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden />
                        Безопасность назначений
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5 px-3 text-[11px] leading-snug">
                      {safety?.allergies && safety.allergies.length > 0 ? (
                        <div>
                          <span className="font-semibold text-red-700 dark:text-red-400">
                            Аллергии:{" "}
                          </span>
                          {safety.allergies.join(", ")}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">Аллергии в карте не указаны</div>
                      )}
                      {safety?.renal && (
                        <div>
                          <span className="font-semibold text-foreground">Функция почек: </span>
                          {safety.renal}
                        </div>
                      )}
                      {safety?.activeMedications && safety.activeMedications.length > 0 && (
                        <div>
                          <span className="font-semibold text-foreground">Постоянная терапия: </span>
                          {safety.activeMedications.slice(0, 6).join(", ")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {Object.keys(confidence).length > 0 && (
                  <Card className="gap-3 rounded-lg py-3">
                    <CardHeader className="px-3 pb-1.5">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
                        Уверенность модели
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 px-3">
                      {Object.entries(confidence).map(([key, val]) => {
                        const pct = Math.round((val as number) * 100);
                        return (
                          <div key={key}>
                            <div className="mb-0.5 flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">{translateConfidenceKey(key)}</span>
                              <span className="font-medium tabular-nums">{pct}%</span>
                            </div>
                            <Progress
                              value={pct}
                              className={cn(
                                "h-1.5",
                                pct >= 70
                                  ? "[&>div]:bg-emerald-500"
                                  : pct >= 40
                                    ? "[&>div]:bg-amber-500"
                                    : "[&>div]:bg-red-500",
                              )}
                            />
                          </div>
                        );
                      })}
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Самооценка модели — ориентир, а не вероятность диагноза.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ============================================================
              ГИПОТЕЗЫ
              ============================================================ */}
          <TabsContent value="diagnoses" className="space-y-3 p-3">
            {differential.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    Гипотезы упорядочены по вероятности. Разверните карточку: аргументы
                    «за»/«против», что подтвердит и что исключит, красные флаги. Кнопка
                    «Подтвердить диагноз» разблокирует терапию по этой гипотезе.
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    подтверждено: {effectiveConfirmed.length} из {differential.length}
                  </Badge>
                </div>
                <Accordion
                  type="multiple"
                  defaultValue={[dxKey(differential[0], 0)]}
                  className="space-y-2"
                >
                  {differential.map((dx, idx) => (
                    <DifferentialItem
                      key={dxKey(dx, idx)}
                      dx={dx}
                      value={dxKey(dx, idx)}
                      confirmed={isDxConfirmed(dx.diagnosis)}
                      onConfirmToggle={(action, evidence) =>
                        handleConfirmDx(dx.diagnosis, action, evidence)
                      }
                      isConfirming={
                        confirmDxMutation.isPending &&
                        confirmDxMutation.variables?.diagnosis === dx.diagnosis
                      }
                    />
                  ))}
                </Accordion>
              </>
            ) : (
              <EmptyBlock
                icon={ListTree}
                title="Дифференциальный ряд не сформирован"
                text="Структурированного блока гипотез нет. Текст заключения доступен во вкладке «Текст ИИ»."
              />
            )}
          </TabsContent>

          {/* ============================================================
              ОБСЛЕДОВАНИЕ — трекер с подсказками
              ============================================================ */}
          <TabsContent value="workup" className="p-3">
            <WorkupPlanTracker
              caseId={caseId}
              items={workupPlan}
              tracker={structured?.workupTracker}
              versionLabel={`v${currentVersion}`}
            />
          </TabsContent>

          {/* ============================================================
              ТЕРАПИЯ
              ============================================================ */}
          <TabsContent value="therapy" className="space-y-3 p-3">
            {therapyOptions.length > 0 ? (
              <>
                <Alert className="border-amber-500/40 bg-amber-500/5 [&>svg]:text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Терапия — только после подтверждения диагноза
                  </AlertTitle>
                  <AlertDescription className="text-xs text-amber-800/90 dark:text-amber-200/90">
                    Опции привязаны к гипотезам и подлежат применению только ПОСЛЕ
                    подтверждения результатами дообследования.
                    {effectiveConfirmed.length === 0
                      ? " Сейчас все карточки заблокированы: подтвердите гипотезу во вкладке «Гипотезы»."
                      : ` Разблокированы для: ${effectiveConfirmed.join(", ")}.`}
                  </AlertDescription>
                </Alert>
                <div className="grid gap-3 lg:grid-cols-2">
                  {therapyOptions.map((t, i) => {
                    const targetDx = t.targetDx?.trim();
                    const isUnlocked = targetDx
                      ? effectiveConfirmed.some((d) => d.toLowerCase() === targetDx.toLowerCase())
                      : false;
                    return <TherapyCard key={i} option={t} unlocked={isUnlocked} />;
                  })}
                </div>
              </>
            ) : (
              <EmptyBlock
                icon={Pill}
                title="Терапевтические опции не сформированы"
                text="Модель не предложила вариант терапии либо структурированный блок отсутствует."
              />
            )}
          </TabsContent>

          {/* ============================================================
              МОНИТОРИНГ
              ============================================================ */}
          <TabsContent value="monitoring" className="p-3">
            {monitoringPlan.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {monitoringPlan.map((m, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{m.marker}</span>
                      {m.frequency && (
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          {m.frequency}
                        </Badge>
                      )}
                    </div>
                    {(m.target || m.purpose) && (
                      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        {m.target && (
                          <p>
                            <span className="font-medium text-foreground">Цель: </span>
                            {m.target}
                          </p>
                        )}
                        {m.purpose && (
                          <p>
                            <span className="font-medium text-foreground">Зачем: </span>
                            {m.purpose}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBlock
                icon={HeartPulse}
                title="План контроля не сформирован"
                text="Для терапии без плана мониторинга проверка покажет отдельное замечание."
              />
            )}
          </TabsContent>

          {/* ============================================================
              ИСТОЧНИКИ
              ============================================================ */}
          <TabsContent value="evidence" className="space-y-3 p-3">
            <DDIAlertsCard caseId={caseId} alerts={analysis.ddiAlerts ?? []} />

            {icd10Suggestions.length > 0 && (
              <Card className="gap-3 rounded-lg py-3">
                <CardHeader className="px-3 pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Code className="h-4 w-4 text-primary" aria-hidden />
                    МКБ-10
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {icd10Suggestions.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3">
                  <div className="flex flex-wrap gap-2">
                    {icd10Suggestions.map((code, i) => (
                      <div key={i} className="rounded-md border px-2.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-primary">
                            {code.code}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {Math.round(code.confidence * 100)}%
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{code.description}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="gap-3 rounded-lg py-3">
                <CardHeader className="px-3 pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Dna className="h-4 w-4 text-emerald-600" aria-hidden />
                    Генетические варианты
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {mutations.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3">
                  {mutations.length > 0 ? (
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {mutations.map((m, i) => (
                        <div key={i} className="rounded-md border p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold">{m.gene}</span>
                            <span className="text-[11px] text-muted-foreground">{m.variant}</span>
                            <Badge
                              variant="outline"
                              className={cn("ml-auto text-[10px]", sigColor(m.clinicalSignificance))}
                            >
                              {sigLabel(m.clinicalSignificance)}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {m.interpretation}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Варианты не выявлены</p>
                  )}
                </CardContent>
              </Card>

              <Card className="gap-3 rounded-lg py-3">
                <CardHeader className="px-3 pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <BookOpen className="h-4 w-4 text-primary" aria-hidden />
                    Клинические рекомендации (RAG)
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {recommendations.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3">
                  {recommendations.length > 0 ? (
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {recommendations.map((r, i) => (
                        <div key={i} className="rounded-md border p-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-medium">{r.title}</span>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {Math.round(r.relevanceScore * 100)}%
                            </Badge>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {r.gene && <span className="font-mono">{r.gene}</span>}
                            <span>{r.source}</span>
                            {r.evidenceLevel && (
                              <Badge variant="secondary" className="text-[10px]">
                                ур. {r.evidenceLevel}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Релевантные рекомендации не найдены
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {pathwayMatches.length > 0 && (
              <Card className="gap-3 rounded-lg py-3">
                <CardHeader className="px-3 pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-primary" aria-hidden />
                    Клинические пути
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {pathwayMatches.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 px-3">
                  {pathwayMatches.map((pathway, i) => (
                    <div key={i} className="rounded-md border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{pathway.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {Math.round(pathway.matchScore * 100)}%
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {pathway.category}
                        {pathway.icd10Code ? ` · МКБ-10: ${pathway.icd10Code}` : ""}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {imageFindings.length > 0 && (
              <Card className="gap-3 rounded-lg py-3">
                <CardHeader className="px-3 pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ImageIcon className="h-4 w-4 text-violet-600" aria-hidden />
                    Анализ изображений
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 px-3">
                  {imageFindings.map((f, i) => (
                    <div key={i} className="rounded-md border p-2.5">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">Снимок #{i + 1}</span>
                        <SuspicionBadge level={f.suspicion} />
                      </div>
                      <p className="text-xs">{f.description}</p>
                      {f.measurements && (
                        <p className="text-[11px] text-muted-foreground">
                          Размеры: {f.measurements}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {citations.length > 0 && (
              <Card className="gap-3 rounded-lg py-3">
                <CardHeader className="px-3 pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Quote className="h-4 w-4 text-primary" aria-hidden />
                    Цитаты-источники (XAI)
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {citations.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3">
                  <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                    {citations.map((cit, i) => {
                      const info = classifySource(cit.source, cit.location);
                      const isMinzdrav = info.label === "КР Минздрава РФ";
                      return (
                        <button
                          key={i}
                          onClick={() => handleCitationClick(cit)}
                          className={cn(
                            "w-full rounded-md border p-2.5 text-left transition-colors hover:bg-accent/50",
                            activeCitation === cit.claim && "border-primary bg-primary/5",
                            isMinzdrav && "border-teal-500/30 bg-teal-500/5",
                          )}
                          aria-label={`Показать цитату: ${cit.claim.slice(0, 60)}`}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <SourceBadge source={cit.source} location={cit.location} />
                            {cit.location && (
                              <span
                                className="ml-auto max-w-[45%] truncate text-[10px] text-muted-foreground"
                                title={cit.location}
                              >
                                {cit.location}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs font-medium">{cit.claim}</p>
                          {cit.fragment && (
                            <p className="mt-0.5 line-clamp-3 border-l-2 border-teal-500/40 pl-2 text-[11px] text-muted-foreground">
                              {cit.fragment}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {citations.length === 0 &&
              recommendations.length === 0 &&
              icd10Suggestions.length === 0 &&
              (analysis.ddiAlerts ?? []).length === 0 && (
                <EmptyBlock
                  icon={BookOpen}
                  title="Источники не приложены"
                  text="Ни цитат, ни найденных клинических рекомендаций. Проверка отметит это как замечание по обоснованности."
                />
              )}
          </TabsContent>

          {/* ============================================================
              ТЕКСТ ИИ
              ============================================================ */}
          <TabsContent value="raw" className="space-y-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Исходное заключение модели. Структурированные вкладки построены из этого
                текста — при расхождении приоритет у текста и первичных документов.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={copyConclusion}
              >
                <Copy className="h-3 w-3" aria-hidden />
                Скопировать
              </Button>
            </div>

            {analysis.conclusion && (
              <div className="rounded-lg border border-l-4 border-l-primary bg-card p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Заключение
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed">
                  {stripMarkdown(analysis.conclusion)}
                </p>
              </div>
            )}

            {sections.length > 0 ? (
              <div className="space-y-2">
                {sections.map((section, idx) => (
                  <div key={idx} className="rounded-lg border p-3">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide">
                        {section.title}
                      </h4>
                      <Badge variant="outline" className="text-[10px]">
                        {Math.round((section.confidence ?? 0) * 100)}% уверенность
                      </Badge>
                    </div>
                    <div className="whitespace-pre-wrap text-xs leading-relaxed">
                      {stripMarkdown(section.content)}
                    </div>
                    {section.citations && section.citations.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {section.citations.map((citOrId: string | Citation, ci: number) => {
                          const cit =
                            typeof citOrId === "string"
                              ? citations.find((c) => c.claim === citOrId)
                              : citOrId;
                          if (!cit) return null;
                          return (
                            <button
                              key={ci}
                              onClick={() => handleCitationClick(cit)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors hover:bg-accent",
                                activeCitation === cit.claim && "border-primary bg-primary/10",
                              )}
                              aria-label={`Показать цитату: ${cit.claim.slice(0, 60)}`}
                            >
                              <Quote className="h-2.5 w-2.5" aria-hidden />
                              {cit.claim.slice(0, 38)}
                              {cit.claim.length > 38 && "…"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              !analysis.conclusion && (
                <EmptyBlock
                  icon={AlignLeft}
                  title="Текст заключения отсутствует"
                  text="Модель не вернула заключение. Проверьте статус ИИ-сервера и повторите анализ."
                />
              )
            )}
          </TabsContent>

          {/* ============================================================
              ПРОВЕРКА
              ============================================================ */}
          <TabsContent value="audit" className="p-3">
            <AnalysisAuditPanel
              report={audit}
              verification={verification}
              normalizationFixes={structured?.normalizationFixes ?? []}
              onNavigate={(target) => setTab(target)}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Version history dialog */}
      <VersionHistoryDialog
        caseId={caseId}
        currentVersion={currentVersion}
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
      />
    </div>
  );
}

/** Пустое состояние вкладки. */
function EmptyBlock({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/50" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

// ===========================================================================
// Дифференциальный диагноз: карточка-гипотеза (Accordion)
// ===========================================================================

function DifferentialItem({
  dx,
  value,
  confirmed,
  onConfirmToggle,
  isConfirming,
}: {
  dx: DifferentialDiagnosis;
  value: string;
  confirmed: boolean;
  onConfirmToggle: (action: "confirm_dx" | "unconfirm_dx", evidence?: string) => void;
  isConfirming: boolean;
}) {
  const pct = clamp01(dx.probability) * 100;
  const redFlags = dx.redFlags ?? [];
  const argsFor = dx.argumentsFor ?? [];
  const argsAgainst = dx.argumentsAgainst ?? [];
  const workup = dx.workup ?? [];
  const sources = dx.sources ?? [];
  // v5.1: dialog for entering confirmation evidence (free-text — what test
  // results / findings support the diagnosis).
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false);
  const [evidence, setEvidence] = React.useState("");

  return (
    <AccordionItem
      value={value}
      className={cn(
        "rounded-lg border border-b bg-card/50 px-3 last:border-b",
        dx.rank === 1 && "border-emerald-500/40",
      )}
    >
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex min-w-0 flex-1 flex-col gap-2 pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                dx.rank === 1
                  ? "bg-emerald-600 text-white"
                  : "bg-primary/10 text-primary",
              )}
              aria-label={`Гипотеза № ${dx.rank ?? "—"}`}
            >
              {dx.rank ?? "—"}
            </span>
            <span className="text-sm font-semibold leading-snug">{dx.diagnosis}</span>
            {dx.icd10 && (
              <Badge
                variant="outline"
                className="border-teal-500/40 bg-teal-500/10 font-mono text-[10px] text-teal-700 dark:text-teal-300"
              >
                {dx.icd10}
              </Badge>
            )}
            {dx.rank === 1 && (
              <Badge className="bg-emerald-600 text-[10px] text-white">Наиболее вероятная</Badge>
            )}
            {confirmed && (
              <Badge className="gap-1 bg-teal-600 text-[10px] text-white">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                Подтверждён
              </Badge>
            )}
            {dx.clinrecCode && (
              <Badge
                variant="outline"
                className="gap-1 border-teal-500/40 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-300"
              >
                <Landmark className="h-3 w-3" aria-hidden />
                КР Минздрава {dx.clinrecCode}
              </Badge>
            )}
            <span
              className="ml-auto pl-2 text-sm font-bold tabular-nums"
              aria-label={`Вероятность ${Math.round(pct)} процентов`}
            >
              {Math.round(pct)}%
            </span>
          </div>
          <Progress
            value={pct}
            className={cn("h-2", probabilityBarCls(pct))}
            aria-label={`Вероятность диагноза «${dx.diagnosis}»: ${Math.round(pct)}%`}
          />
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-0">
        <div className="space-y-3 pb-1">
          {redFlags.length > 0 && <RedFlagsAlert flags={redFlags} />}

          <div className="grid gap-3 sm:grid-cols-2">
            <ArgumentList title="Аргументы ЗА" items={argsFor} tone="for" />
            <ArgumentList title="Аргументы ПРОТИВ" items={argsAgainst} tone="against" />
          </div>

          {workup.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Search className="h-3.5 w-3.5" aria-hidden />
                Обследование для подтверждения
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {workup.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs leading-snug">
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
                    <span>{stripMarkdown(w)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dx.notes && (
            <p className="border-l-2 border-primary/30 pl-2 text-xs leading-relaxed text-muted-foreground">
              {stripMarkdown(dx.notes)}
            </p>
          )}

          {sources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sources.map((s, i) => (
                <SourceBadge key={i} source={s} fallbackToRaw />
              ))}
            </div>
          )}

          {/* v5.1 (audit 9 / partial 5): hard workflow gate for therapy.
              Подтверждение диагноза — разворачивает диалог, в котором врач
              указывает, какими результатами обследования он подтвердил
              гипотезу. После подтверждения TherapyOption'ы с тем же
              `targetDx` разблокируются (см. блок терапии ниже). */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            {confirmed ? (
              <>
                <Badge className="gap-1 bg-teal-600 text-[10px] text-white">
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  Диагноз подтверждён — терапия разблокирована
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={isConfirming}
                  onClick={() => onConfirmToggle("unconfirm_dx")}
                >
                  {isConfirming ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <X className="h-3 w-3" aria-hidden />
                  )}
                  Снять подтверждение
                </Button>
              </>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1 px-3 text-[11px]"
                disabled={isConfirming}
                onClick={() => setConfirmDialogOpen(true)}
              >
                {isConfirming ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                )}
                Подтвердить диагноз
              </Button>
            )}
          </div>

          <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Подтвердить диагноз: {dx.diagnosis}</DialogTitle>
                <DialogDescription>
                  Укажите, какими результатами обследования вы подтвердили
                  эту гипотезу. Обоснование запишется в журнал аудита и
                  разблокирует терапевтические опции для этого диагноза.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor={`confirm-evidence-${value}`} className="text-xs">
                  Обоснование (какие результаты анализов / данные подтвердили диагноз)
                </Label>
                <Textarea
                  id={`confirm-evidence-${value}`}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Например: «Биопсия — инвазивная карцинома G2; ИГХ: ER+/PR+/HER2-»; «Тропонин I 1.2 нг/мл, ЭКГ: подъём ST в V2-V4»"
                  className="min-h-[100px] text-xs"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfirmDialogOpen(false);
                    setEvidence("");
                  }}
                >
                  Отмена
                </Button>
                <Button
                  size="sm"
                  disabled={isConfirming}
                  onClick={() => {
                    onConfirmToggle("confirm_dx", evidence.trim() || undefined);
                    setConfirmDialogOpen(false);
                    setEvidence("");
                  }}
                >
                  {isConfirming ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Подтвердить диагноз
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

/** Янтарный Alert с «красными флагами» гипотезы. */
function RedFlagsAlert({ flags }: { flags: string[] }) {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5 py-2.5 [&>svg]:text-amber-600">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-xs font-semibold text-amber-800 dark:text-amber-300">
        Красные флаги — требуют исключения
      </AlertTitle>
      <AlertDescription className="text-xs text-amber-800/90 dark:text-amber-200/90">
        <ul className="list-disc space-y-0.5 pl-4">
          {flags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/** Список аргументов «за» (зелёный) или «против» (красный). */
function ArgumentList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "for" | "against";
}) {
  const isFor = tone === "for";
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        isFor ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5",
      )}
    >
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-xs font-semibold",
          isFor ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
        )}
      >
        {isFor ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        {title}
        <Badge variant="outline" className="ml-auto text-[10px]">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs leading-snug">
              {isFor ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <X className="mt-0.5 h-3 w-3 shrink-0 text-red-500" aria-hidden />
              )}
              <span>{stripMarkdown(it)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===========================================================================
// DDI Alerts Card with Override support
// ===========================================================================
// v2.1: Each alert card has an "Отменить" (Override) button that opens a
// dialog where the doctor writes a clinical justification (min 10 chars).
// On submit, the override is persisted via POST /api/cases/[id]/ddi-override
// and an audit log entry is written. Overridden alerts show a green
// "Отменено" badge with the reason, doctor name and timestamp.
// ===========================================================================

function DDIAlertsCard({ caseId, alerts }: { caseId: string; alerts: DDIAlert[] }) {
  // Local copy of alerts so the UI updates instantly on override without
  // waiting for the case query to refetch.
  const [localAlerts, setLocalAlerts] = React.useState<DDIAlert[]>(alerts);
  React.useEffect(() => {
    setLocalAlerts(alerts);
  }, [alerts]);

  const [overrideTarget, setOverrideTarget] = React.useState<DDIAlert | null>(null);
  const [reason, setReason] = React.useState("");
  const qc = useQueryClient();
  const { currentDoctor } = useAppStore();

  const overrideMut = useMutation({
    mutationFn: (vars: { drug1: string; drug2: string; reason: string }) =>
      api.overrideDDIAlert(caseId, vars),
    onSuccess: (res, vars) => {
      // Optimistically update local state so the badge appears immediately.
      setLocalAlerts((prev) =>
        prev.map((a) =>
          a.drug1 === vars.drug1 && a.drug2 === vars.drug2
            ? { ...a, override: res.alert.override }
            : a,
        ),
      );
      toast.success("DDI-предупреждение отменено", {
        description: "Обоснование записано в журнал аудита.",
      });
      setOverrideTarget(null);
      setReason("");
      // Invalidate the case query so the server truth is reloaded.
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (e: Error) => {
      toast.error("Не удалось отменить предупреждение", {
        description: e.message,
      });
    },
  });

  if (localAlerts.length === 0) return null;

  const handleSubmit = () => {
    if (!overrideTarget) return;
    if (reason.trim().length < MIN_REASON_LENGTH) return;
    overrideMut.mutate({
      drug1: overrideTarget.drug1,
      drug2: overrideTarget.drug2,
      reason: reason.trim(),
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setOverrideTarget(null);
      setReason("");
    }
  };

  return (
    <Card className="border-red-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          Лекарственные взаимодействия (DDI)
          <Badge variant="destructive" className="ml-auto">{localAlerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-y-auto pr-1 -mr-1">
          <div className="space-y-2">
            {localAlerts.map((alert, i) => {
              const isOverridden = alert.override?.overridden === true;
              const doctorName =
                alert.override?.overriddenBy === currentDoctor?.id
                  ? currentDoctor?.fullName
                  : alert.override?.overriddenBy;
              return (
                <div
                  key={`${alert.drug1}-${alert.drug2}-${i}`}
                  className={cn(
                    "rounded-lg border p-3",
                    isOverridden
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : ddiSeverityBorder(alert.severity),
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill
                      className={cn(
                        "h-4 w-4",
                        isOverridden ? "text-emerald-600" : "text-red-600",
                      )}
                    />
                    <span className="font-medium text-sm">
                      {alert.drug1} + {alert.drug2}
                    </span>
                    {isOverridden ? (
                      <Badge
                        variant="outline"
                        className="ml-auto text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      >
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        Отменено
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn("ml-auto text-xs", ddiSeverityColor(alert.severity))}
                      >
                        {ddiSeverityLabel(alert.severity)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong>Механизм:</strong> {alert.mechanism}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong>Рекомендация:</strong> {alert.management}
                  </p>

                  {isOverridden ? (
                    <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                      <div className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck className="h-3 w-3" />
                        Предупреждение отменено врачом
                      </div>
                      <p className="mt-1 text-xs text-foreground">
                        <strong>Обоснование:</strong> {alert.override?.overrideReason}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Врач: {doctorName ?? "—"} ·{" "}
                        {alert.override?.overriddenAt
                          ? formatDateTime(alert.override.overriddenAt)
                          : "—"}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          setOverrideTarget(alert);
                          setReason("");
                        }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Отменить предупреждение
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>

      {/* Override Dialog */}
      <Dialog open={!!overrideTarget} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-600" />
              Отмена DDI-предупреждения
            </DialogTitle>
            <DialogDescription>
              Заполните клиническое обоснование. Минимум {MIN_REASON_LENGTH} символов.
              Обоснование будет сохранено в карточке анализа и записано в журнал аудита.
            </DialogDescription>
          </DialogHeader>

          {overrideTarget && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {overrideTarget.drug1} + {overrideTarget.drug2}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn("text-xs", ddiSeverityColor(overrideTarget.severity))}
                  >
                    {ddiSeverityLabel(overrideTarget.severity)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {overrideTarget.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ddi-override-reason">
                  Клиническое обоснование отмены
                </Label>
                <Textarea
                  id="ddi-override-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Напр.: Польза комбинированной терапии превышает риск взаимодействия; пациент находится под мониторингом МНО и функции почек…"
                  rows={5}
                  className="resize-y"
                  disabled={overrideMut.isPending}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {reason.trim().length < MIN_REASON_LENGTH
                      ? `Ещё ${MIN_REASON_LENGTH - reason.trim().length} симв.`
                      : "Обоснование готово"}
                  </span>
                  <span>{reason.length} симв.</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={overrideMut.isPending}
            >
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                overrideMut.isPending ||
                reason.trim().length < MIN_REASON_LENGTH ||
                !overrideTarget
              }
              className="gap-2"
            >
              {overrideMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Сохранение…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Подтвердить отмену
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function sigColor(sig: string): string {
  const map: Record<string, string> = {
    pathogenic: "bg-red-500/15 text-red-700 dark:text-red-400",
    likely_pathogenic: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    vus: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    likely_benign: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    benign: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  };
  return map[sig] ?? map.vus;
}

function sigLabel(sig: string): string {
  const map: Record<string, string> = {
    pathogenic: "Патогенный",
    likely_pathogenic: "Вероятно патогенный",
    vus: "Неопределённый",
    likely_benign: "Вероятно доброкачественный",
    benign: "Доброкачественный",
  };
  return map[sig] ?? sig;
}

function ddiSeverityColor(severity: string): string {
  const map: Record<string, string> = {
    contraindication: "bg-red-500/15 text-red-700 dark:text-red-400",
    major: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    moderate: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    minor: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  };
  return map[severity] ?? map.moderate;
}

function ddiSeverityBorder(severity: string): string {
  const map: Record<string, string> = {
    contraindication: "border-red-500/40 bg-red-500/5",
    major: "border-orange-500/40 bg-orange-500/5",
    moderate: "border-amber-500/40 bg-amber-500/5",
    minor: "border-gray-500/40 bg-gray-500/5",
  };
  return map[severity] ?? map.moderate;
}

function ddiSeverityLabel(severity: string): string {
  const map: Record<string, string> = {
    contraindication: "Противопоказание",
    major: "Значительное",
    moderate: "Умеренное",
    minor: "Незначительное",
  };
  return map[severity] ?? severity;
}

function SuspicionBadge({ level }: { level: string }) {
  const map: Record<string, { label: string; color: string }> = {
    low: { label: "Низкое подозрение", color: "text-emerald-600" },
    moderate: { label: "Умеренное подозрение", color: "text-amber-600" },
    high: { label: "Высокое подозрение", color: "text-red-600" },
  };
  const cfg = map[level] ?? map.low;
  return <Badge variant="outline" className={cn("text-xs", cfg.color)}>{cfg.label}</Badge>;
}

function translateConfidenceKey(key: string): string {
  const map: Record<string, string> = { diagnosis: "Диагноз", therapy: "Терапия", prognosis: "Прогноз" };
  return map[key] ?? key;
}

// ===========================================================================
// v5.1 (audit 9 / partial 5): TherapyCard — карточка терапии с жёстким
// workflow-гейтом: опция заблокирована (серая, no-hover) до тех пор, пока
// её targetDx не подтверждён в structured.confirmedDx.
// ===========================================================================

function TherapyCard({
  option,
  unlocked,
}: {
  option: TherapyOption;
  unlocked: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3 transition-opacity",
        unlocked
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-muted bg-muted/30 opacity-55",
      )}
      aria-disabled={!unlocked}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span className="font-mono text-sm font-semibold leading-snug">{option.name}</span>
        {option.evidenceLevel && (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
          >
            Доказательность {option.evidenceLevel}
          </Badge>
        )}
        {option.source && <SourceBadge source={option.source} fallbackToRaw />}
        {option.targetDx && (
          <Badge
            variant="outline"
            className={cn(
              "max-w-full truncate text-[10px]",
              unlocked
                ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
            title={option.targetDx}
          >
            для: {option.targetDx}
          </Badge>
        )}
        {unlocked ? (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-teal-500/40 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-300"
          >
            <ShieldCheck className="h-3 w-3" aria-hidden />
            Доступно
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Заблокировано — подтвердите диагноз
          </Badge>
        )}
      </div>
      {option.regimen && (
        <p className="text-sm leading-snug">
          <span className="font-semibold text-muted-foreground">Схема:</span> {option.regimen}
        </p>
      )}
      {option.justification && (
        <p className="text-xs leading-relaxed text-muted-foreground">{option.justification}</p>
      )}
      {option.caution && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs leading-snug text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
          <span>
            <strong>Осторожно:</strong> {option.caution}
          </span>
        </div>
      )}
      {!unlocked && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] leading-snug text-amber-800 dark:text-amber-200">
          Терапевтическая опция недоступна до подтверждения диагноза
          {option.targetDx ? ` «${option.targetDx}»` : ""}. Подтвердите диагноз
          кнопкой в карточке соответствующей гипотезы дифференциального ряда.
        </p>
      )}
    </div>
  );
}