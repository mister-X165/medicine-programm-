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
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Globe,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AnalysisResultData,
  Citation,
  DDIAlert,
  ICD10CodeMatch,
  ClinicalPathwayMatch,
  DifferentialDiagnosis,
  TherapyOption,
  WorkupItem,
} from "@/lib/types";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
function pluralPasses(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "проход";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "прохода";
  return "проходов";
}

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
const WORKUP_GROUPS: Array<{
  key: WorkupItem["priority"];
  label: string;
  short: string;
  badgeCls: string;
}> = [
  {
    key: "urgent",
    label: "Срочные — выполнить немедленно",
    short: "Срочно",
    badgeCls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  {
    key: "high",
    label: "Высокий приоритет",
    short: "Высокий",
    badgeCls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    key: "routine",
    label: "Плановые",
    short: "Плановый",
    badgeCls: "border-gray-500/40 bg-gray-500/10 text-gray-600 dark:text-gray-300",
  },
];

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

export function AnalysisPanel({ analysis, caseId, onRunAnalysis, isAnalyzing, hasDocuments }: Props) {
  const [activeCitation, setActiveCitation] = React.useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false);
  const [correctionsOpen, setCorrectionsOpen] = React.useState(false);

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

  // ---------------------------------------------------------------------
  // План дообследования: интерактивный чек-лист с сохранением в localStorage
  // по ключу workup-done-{caseId}-{version} (сбрасывается на новой версии).
  // ---------------------------------------------------------------------
  const workupStorageKey = `workup-done-${caseId}-${currentVersion}`;
  const [workupDone, setWorkupDone] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(workupStorageKey);
      setWorkupDone(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch {
      setWorkupDone({});
    }
  }, [workupStorageKey]);

  const toggleWorkupItem = (key: string) => {
    setWorkupDone((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(workupStorageKey, JSON.stringify(next));
      } catch {
        // localStorage может быть недоступен (приватный режим) — чек-лист
        // продолжает работать в рамках сессии.
      }
      return next;
    });
  };

  const workupItemsWithKeys = React.useMemo(
    () => workupPlan.map((item, idx) => ({ item, key: `${idx}:${item.name}` })),
    [workupPlan],
  );
  const workupDoneCount = workupItemsWithKeys.filter(({ key }) => workupDone[key]).length;

  return (
    <div className="space-y-4">
      {/* ================================================================
          1. ШАПКА: версия, самопроверка ИИ, история версий
          ================================================================ */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Cpu className="h-4 w-4 text-emerald-600" aria-hidden />
            <span className="font-medium text-foreground">Анализ</span>
            <Badge
              variant="outline"
              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            >
              v{currentVersion}
            </Badge>
            {verification?.performed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="cursor-help gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    aria-label="Отчёт самопроверки ИИ"
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    Самопроверка: {verification.passes ?? 1} {pluralPasses(verification.passes ?? 1)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold">Самопроверка ИИ (verification pass)</p>
                    {corrections.length > 0 ? (
                      <ul className="list-disc space-y-0.5 pl-4 text-xs">
                        {corrections.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs">Существенных расхождений не найдено.</p>
                    )}
                    {verification.factsGrounded === true && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Все факты подтверждены исходными данными.
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label="История версий анализа">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!canCompareVersions}
                  onClick={() => setVersionHistoryOpen(true)}
                  aria-label="Открыть историю версий анализа"
                >
                  <History className="h-4 w-4" aria-hidden />
                  История версий
                  {canCompareVersions && (
                    <Badge
                      variant="secondary"
                      className="ml-1 bg-emerald-500/15 text-xs text-emerald-700 dark:text-emerald-400"
                    >
                      {currentVersion}
                    </Badge>
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {canCompareVersions
                ? `Доступно версий: ${currentVersion}. Нажмите, чтобы сравнить.`
                : "Запустите анализ повторно, чтобы создать новую версию для сравнения."}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Раскрывающийся список исправлений самопроверки */}
        {verification?.performed && corrections.length > 0 && (
          <Collapsible open={correctionsOpen} onOpenChange={setCorrectionsOpen}>
            <div className="flex justify-end px-1">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  aria-label={correctionsOpen ? "Скрыть исправления самопроверки" : "Показать исправления самопроверки"}
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  Исправления ИИ ({corrections.length})
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", correctionsOpen && "rotate-180")}
                    aria-hidden
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <ul className="list-disc space-y-1 pl-4 text-xs text-foreground">
                  {corrections.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                {verification.factsGrounded === true && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    Все утверждения подтверждены исходными данными пациента.
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* ================================================================
          2. РЕЗЮМЕ / ЗАКЛЮЧЕНИЕ
          ================================================================ */}
      <Card className="overflow-hidden rounded-lg border-l-4 border-l-primary">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              Заключение
            </CardTitle>
            <Badge className="bg-medical-gradient text-white">ИИ-анализ</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Diagnosis highlight — extract ICD-10 code and diagnosis from conclusion */}
          {(() => {
            const diagnosisMatch = analysis.conclusion.match(/(Основной диагноз|Диагноз)[:\s]*([^\n]+)/i);
            const icdMatch = analysis.conclusion.match(/\b([A-Z]\d{2}(?:\.\d{1,4})?)\b/g);
            const icdCodes = icdMatch ? Array.from(new Set(icdMatch)).slice(0, 4) : [];
            if (diagnosisMatch || icdCodes.length > 0) {
              return (
                <div className="rounded-lg border border-primary/20 bg-medical-gradient-soft p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Stethoscope className="h-3.5 w-3.5" />
                    Установленный диагноз
                  </div>
                  {diagnosisMatch && (
                    <div className="text-sm font-medium leading-snug text-foreground">
                      {stripMarkdown(diagnosisMatch[2].trim().replace(/\(.*?\)/g, "").trim())}
                    </div>
                  )}
                  {icdCodes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {icdCodes.map((code, i) => (
                        <Badge key={i} variant="outline" className="border-teal-500/40 bg-teal-500/10 font-mono text-[10px] text-teal-700 dark:text-teal-300">
                          {code}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })()}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{stripMarkdown(analysis.conclusion)}</p>
        </CardContent>
      </Card>

      {/* ================================================================
          3. ДИФФЕРЕНЦИАЛЬНЫЙ ДИАГНОЗ — карточки-гипотезы (v5.0)
          ================================================================ */}
      {differential.length > 0 && (
        <Card className="rounded-lg border">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <ListTree className="h-4 w-4 text-primary" />
              Дифференциальный диагноз
              <Badge variant="secondary" className="ml-auto">{differential.length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Гипотезы упорядочены по вероятности. Разверните карточку, чтобы увидеть аргументы «за»/«против» и план подтверждения.
            </p>
          </CardHeader>
          <CardContent>
            <Accordion
              type="multiple"
              defaultValue={[dxKey(differential[0], 0)]}
              className="space-y-2"
            >
              {differential.map((dx, idx) => {
                const confirmed = isDxConfirmed(dx.diagnosis);
                return (
                  <DifferentialItem
                    key={dxKey(dx, idx)}
                    dx={dx}
                    value={dxKey(dx, idx)}
                    confirmed={confirmed}
                    onConfirmToggle={(action, evidence) =>
                      handleConfirmDx(dx.diagnosis, action, evidence)
                    }
                    isConfirming={
                      confirmDxMutation.isPending &&
                      confirmDxMutation.variables?.diagnosis === dx.diagnosis
                    }
                  />
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          4. ПЛАН ДООБСЛЕДОВАНИЯ — интерактивный чек-лист (v5.0)
          ================================================================ */}
      {workupPlan.length > 0 && (
        <Card className="rounded-lg border">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="h-4 w-4 text-primary" />
                План дообследования
              </CardTitle>
              <Badge variant="secondary" className="ml-auto">
                Выполнено {workupDoneCount} из {workupPlan.length}
              </Badge>
            </div>
            <Progress
              value={workupPlan.length ? (workupDoneCount / workupPlan.length) * 100 : 0}
              className="mt-2 h-1.5 [&>div]:bg-emerald-500"
              aria-label={`Прогресс выполнения плана дообследования: ${workupDoneCount} из ${workupPlan.length}`}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {WORKUP_GROUPS.map((group) => {
              const groupItems = workupItemsWithKeys.filter(
                ({ item }) => (item.priority ?? "routine") === group.key,
              );
              if (groupItems.length === 0) return null;
              return (
                <div key={group.key}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-[10px]", group.badgeCls)}>
                      {group.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{groupItems.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {groupItems.map(({ item, key }) => {
                      const done = !!workupDone[key];
                      const hasInterpretationFields = !!(
                        item.interpretation ||
                        item.expectedResult ||
                        item.normalRange ||
                        item.cutoffs ||
                        item.confirmsIf ||
                        item.refutesIf ||
                        (item.targetDxConfirm && item.targetDxConfirm.length > 0) ||
                        (item.targetDxRefute && item.targetDxRefute.length > 0)
                      );
                      return (
                        <WorkupCard
                          key={key}
                          caseId={caseId}
                          itemKey={key}
                          item={item}
                          done={done}
                          groupShort={group.short}
                          groupBadgeCls={group.badgeCls}
                          onToggle={toggleWorkupItem}
                          hasInterpretationFields={hasInterpretationFields}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          5. ТЕРАПИЯ — только после подтверждения диагноза (v5.0)
          ================================================================ */}
      {therapyOptions.length > 0 && (
        <Card className="rounded-lg border">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Pill className="h-4 w-4 text-emerald-600" />
              Терапия
              <Badge variant="secondary" className="ml-auto">{therapyOptions.length}</Badge>
              {/* v5.1: shows how many diagnoses are confirmed vs total. */}
              {effectiveConfirmed.length > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-teal-500/40 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-300"
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  Подтверждено {effectiveConfirmed.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert className="border-amber-500/40 bg-amber-500/5 [&>svg]:text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Терапия — только после подтверждения диагноза
              </AlertTitle>
              <AlertDescription className="text-xs text-amber-800/90 dark:text-amber-200/90">
                Варианты терапии приведены для каждой диагностической гипотезы и подлежат
                применению только ПОСЛЕ её подтверждения результатами дообследования.
                {effectiveConfirmed.length === 0
                  ? " Карточки терапии заблокированы — подтвердите хотя бы один диагноз кнопкой «Подтвердить диагноз» в карточке гипотезы."
                  : ` Разблокированы для диагнозов: ${effectiveConfirmed.join(", ")}.`}
              </AlertDescription>
            </Alert>
            <div className="grid max-h-[600px] gap-3 overflow-y-auto pr-1 lg:grid-cols-2">
              {therapyOptions.map((t, i) => {
                // v5.1: hard workflow gate — therapy option is locked
                // unless its targetDx is in the confirmed list. Options
                // without a targetDx are always locked (must be tied to
                // a hypothesis by the parser; if not — show as locked).
                const targetDx = t.targetDx?.trim();
                const isUnlocked = targetDx
                  ? effectiveConfirmed.some(
                      (d) => d.toLowerCase() === targetDx.toLowerCase(),
                    )
                  : false;
                return <TherapyCard key={i} option={t} unlocked={isUnlocked} />;
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          6. МАРКЕРЫ И МОНИТОРИНГ (v5.0)
          ================================================================ */}
      {monitoringPlan.length > 0 && (
        <Card className="rounded-lg border">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <HeartPulse className="h-4 w-4 text-teal-600" />
              Маркеры и мониторинг
              <Badge variant="secondary" className="ml-auto">{monitoringPlan.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {monitoringPlan.map((m, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{m.marker}</span>
                    {m.frequency && (
                      <Badge variant="outline" className="text-[10px]">{m.frequency}</Badge>
                    )}
                  </div>
                  {(m.target || m.purpose) && (
                    <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                      {m.target && (
                        <p>
                          <span className="font-medium text-foreground">Цель:</span> {m.target}
                        </p>
                      )}
                      {m.purpose && (
                        <p>
                          <span className="font-medium text-foreground">Зачем:</span> {m.purpose}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          7. УВЕРЕННОСТЬ МОДЕЛИ
          ================================================================ */}
      {Object.keys(confidence).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              Степень уверенности модели
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(confidence).map(([key, val]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="capitalize text-muted-foreground">{translateConfidenceKey(key)}</span>
                  <span className="font-medium">{Math.round((val as number) * 100)}%</span>
                </div>
                <Progress
                  value={(val as number) * 100}
                  className={cn(
                    "h-2",
                    (val as number) >= 0.7 && "[&>div]:bg-emerald-500",
                    (val as number) >= 0.4 && (val as number) < 0.7 && "[&>div]:bg-amber-500",
                    (val as number) < 0.4 && "[&>div]:bg-red-500",
                  )}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          8. ПОДРОБНЫЕ РАЗДЕЛЫ (текстовый fallback — работает и для старых
             анализов без structured, и когда текстовые разделы дополняют
             структурированные блоки)
          ================================================================ */}
      {sections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlignLeft className="h-4 w-4 text-primary" />
              Подробные разделы анализа
              <Badge variant="secondary" className="ml-auto">{sections.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[600px] space-y-4 overflow-y-auto pr-1 -mr-1">
              {sections.map((section, idx) => (
                <div key={idx} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">{section.title}</h4>
                    <Badge variant="outline" className="text-xs">{Math.round(section.confidence * 100)}% уверенность</Badge>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{stripMarkdown(section.content)}</div>
                  {section.citations && section.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {section.citations.map((citOrId: string | Citation, ci: number) => {
                        const cit = typeof citOrId === "string"
                          ? citations.find((c) => c.claim === citOrId)
                          : citOrId;
                        if (!cit) return null;
                        return (
                          <button
                            key={ci}
                            onClick={() => handleCitationClick(cit)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
                              activeCitation === cit.claim && "border-primary bg-primary/10",
                            )}
                            aria-label={`Показать цитату: ${cit.claim.slice(0, 60)}`}
                          >
                            <Quote className="h-3 w-3" />
                            {cit.claim.slice(0, 40)}
                            {cit.claim.length > 40 && "…"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          9. ЛЕКАРСТВЕННЫЕ ВЗАИМОДЕЙСТВИЯ (DDI) — с логикой Override
          ================================================================ */}
      <DDIAlertsCard caseId={caseId} alerts={analysis.ddiAlerts ?? []} />

      {/* ================================================================
          10. МКБ-10 КОДЫ
          ================================================================ */}
      {icd10Suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code className="h-4 w-4 text-primary" />
              МКБ-10 коды
              <Badge variant="secondary" className="ml-auto">{icd10Suggestions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {icd10Suggestions.map((code, i) => (
                <div key={i} className="rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-primary">{code.code}</span>
                    <Badge variant="outline" className="text-xs">{Math.round(code.confidence * 100)}%</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{code.description}</p>
                  <Badge variant="secondary" className="mt-1 text-[10px]">{code.source === "ai" ? "ИИ" : "Вручную"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          11. МУТАЦИИ + КЛИНИЧЕСКИЕ РЕКОМЕНДАЦИИ (RAG) — 2 колонки
          ================================================================ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Dna className="h-4 w-4 text-emerald-600" />
              Генетические варианты
              <Badge variant="secondary" className="ml-auto">{mutations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mutations.length > 0 ? (
              <div className="max-h-80 overflow-y-auto pr-1 -mr-1">
                <div className="space-y-2">
                  {mutations.map((m, i) => (
                    <div key={i} className="rounded-lg border p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{m.gene}</span>
                        <span className="text-xs text-muted-foreground">{m.variant}</span>
                        <Badge variant="outline" className={cn("ml-auto text-xs", sigColor(m.clinicalSignificance))}>
                          {sigLabel(m.clinicalSignificance)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{m.interpretation}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Варианты не выявлены</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              Клинические рекомендации (RAG)
              <Badge variant="secondary" className="ml-auto">{recommendations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recommendations.length > 0 ? (
              <div className="max-h-80 overflow-y-auto pr-1 -mr-1">
                <div className="space-y-2">
                  {recommendations.map((r, i) => (
                    <div key={i} className="rounded-lg border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{r.title}</span>
                        <Badge variant="outline" className="shrink-0 text-xs">{Math.round(r.relevanceScore * 100)}%</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {r.gene && <span className="font-mono font-medium text-emerald-600">{r.gene}</span>}
                        <span>{r.source}</span>
                        {r.evidenceLevel && <Badge variant="secondary" className="text-xs">ур. {r.evidenceLevel}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Релевантные рекомендации не найдены</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ================================================================
          12. КЛИНИЧЕСКИЕ ПУТИ
          ================================================================ */}
      {pathwayMatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Клинические пути
              <Badge variant="secondary" className="ml-auto">{pathwayMatches.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto pr-1 -mr-1">
              <div className="space-y-2">
                {pathwayMatches.map((pathway, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{pathway.name}</span>
                      <Badge variant="outline" className="text-xs">{Math.round(pathway.matchScore * 100)}% совпадение</Badge>
                    </div>
                    {pathway.icd10Code && (
                      <p className="mt-1 text-xs text-muted-foreground">МКБ-10: {pathway.icd10Code}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">Категория: {pathway.category}</p>
                    {pathway.steps && pathway.steps.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {pathway.steps?.map((step, si) => (
                          <div key={si} className="flex items-start gap-2 text-xs">
                            <span className="mt-0.5 shrink-0 text-primary font-mono">{step.order}.</span>
                            <div>
                              <span className="font-medium">{step.title}</span>
                              <span className="text-muted-foreground"> — {step.description}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          13. АНАЛИЗ ИЗОБРАЖЕНИЙ
          ================================================================ */}
      {imageFindings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-4 w-4 text-violet-600" />
              Анализ изображений
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1 -mr-1">
              {imageFindings.map((f, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Снимок #{i + 1}</span>
                    <SuspicionBadge level={f.suspicion} />
                  </div>
                  <p className="text-sm">{f.description}</p>
                  {f.measurements && <p className="mt-1 text-xs text-muted-foreground">Размеры: {f.measurements}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          14. ЦИТАТЫ-ИСТОЧНИКИ (XAI)
          ================================================================ */}
      {citations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Quote className="h-4 w-4 text-primary" />
              Цитаты-источники (XAI)
              <Badge variant="secondary" className="ml-auto">{citations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto pr-1 -mr-1">
              <div className="space-y-2">
                {citations.map((cit, i) => {
                  const info = classifySource(cit.source, cit.location);
                  const isMinzdrav = info.label === "КР Минздрава РФ";
                  return (
                  <button
                    key={i}
                    onClick={() => handleCitationClick(cit)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
                      activeCitation === cit.claim && "border-primary bg-primary/5",
                      isMinzdrav && "border-teal-500/30 bg-teal-500/5",
                    )}
                    aria-label={`Показать цитату: ${cit.claim.slice(0, 60)}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Quote className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <SourceBadge source={cit.source} location={cit.location} />
                      {cit.location && <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground" title={cit.location}>{cit.location}</span>}
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{cit.claim}</p>
                    {cit.fragment && <p className="mt-1 line-clamp-4 border-l-2 border-teal-500/40 pl-2 text-xs text-muted-foreground">{cit.fragment}</p>}
                  </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          15. ПОВТОРИТЬ АНАЛИЗ
          ================================================================ */}
      <div className="flex justify-center">
        <Button variant="outline" onClick={() => onRunAnalysis(false)} disabled={isAnalyzing || !hasDocuments} className="gap-2">
          {isAnalyzing ? <><Loader2 className="h-4 w-4 animate-spin" /> Анализ выполняется…</> : <><Cpu className="h-4 w-4" /> Повторить анализ</>}
        </Button>
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

// ===========================================================================
// v5.1 (audit 9 / fail 4c): WorkupCard — расширенная карточка обследования
// с интерпретационными полями и мульти-таргет confirm/refute badges.
// ===========================================================================

function WorkupCard({
  caseId,
  itemKey,
  item,
  done,
  groupShort,
  groupBadgeCls,
  onToggle,
  hasInterpretationFields,
}: {
  caseId: string;
  itemKey: string;
  item: WorkupItem;
  done: boolean;
  groupShort: string;
  groupBadgeCls: string;
  onToggle: (key: string) => void;
  hasInterpretationFields: boolean;
}) {
  const [interpretOpen, setInterpretOpen] = React.useState(false);
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        done ? "border-emerald-500/40 bg-emerald-500/5" : "hover:bg-accent/40",
      )}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          id={`workup-${caseId}-${itemKey}`}
          checked={done}
          onCheckedChange={() => onToggle(itemKey)}
          className="data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
          aria-label={`Отметить выполненным: ${item.name}`}
        />
        <label
          htmlFor={`workup-${caseId}-${itemKey}`}
          className="flex min-h-[44px] flex-1 cursor-pointer flex-col justify-center gap-0.5 py-1"
        >
          <span
            className={cn(
              "text-sm font-medium leading-snug",
              done && "text-muted-foreground line-through",
            )}
          >
            {item.name}
          </span>
          {item.purpose && (
            <span className="text-xs text-muted-foreground">{item.purpose}</span>
          )}
        </label>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline" className={cn("text-[10px]", groupBadgeCls)}>
            {groupShort}
          </Badge>
          {item.targetDx && !hasInterpretationFields && (
            <Badge
              variant="outline"
              className="max-w-40 truncate text-[10px]"
              title={item.targetDx}
            >
              {item.targetDx}
            </Badge>
          )}
        </div>
      </div>

      {/* Confirm / Refute badges (multi-target) */}
      {((item.targetDxConfirm && item.targetDxConfirm.length > 0) ||
        (item.targetDxRefute && item.targetDxRefute.length > 0)) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.targetDxConfirm?.map((dx, i) => (
            <Badge
              key={`c-${i}`}
              variant="outline"
              className="max-w-full truncate text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              title={dx}
            >
              <Check className="mr-0.5 h-3 w-3" aria-hidden />
              подтверждает: {dx}
            </Badge>
          ))}
          {item.targetDxRefute?.map((dx, i) => (
            <Badge
              key={`r-${i}`}
              variant="outline"
              className="max-w-full truncate text-[10px] border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
              title={dx}
            >
              <X className="mr-0.5 h-3 w-3" aria-hidden />
              исключает: {dx}
            </Badge>
          ))}
        </div>
      )}

      {/* Quick facts: expected result, normal range, confirms/refutes if */}
      {(item.expectedResult || item.normalRange || item.cutoffs) && (
        <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-[11px] leading-snug sm:grid-cols-2">
          {item.expectedResult && (
            <div className="flex gap-1">
              <dt className="font-semibold text-muted-foreground">Ожидаемый результат:</dt>
              <dd className="text-foreground">{item.expectedResult}</dd>
            </div>
          )}
          {item.normalRange && (
            <div className="flex gap-1">
              <dt className="font-semibold text-muted-foreground">Норма:</dt>
              <dd className="text-foreground">{item.normalRange}</dd>
            </div>
          )}
          {item.cutoffs && !item.normalRange && (
            <div className="flex gap-1">
              <dt className="font-semibold text-muted-foreground">Пороги:</dt>
              <dd className="text-foreground">{item.cutoffs}</dd>
            </div>
          )}
          {item.confirmsIf && (
            <div className="flex gap-1">
              <dt className="font-semibold text-emerald-700 dark:text-emerald-300">Подтверждает, если:</dt>
              <dd className="text-foreground">{item.confirmsIf}</dd>
            </div>
          )}
          {item.refutesIf && (
            <div className="flex gap-1">
              <dt className="font-semibold text-red-700 dark:text-red-300">Исключает, если:</dt>
              <dd className="text-foreground">{item.refutesIf}</dd>
            </div>
          )}
        </dl>
      )}

      {/* Collapsible "Как интерпретировать результат" panel */}
      {(item.interpretation || hasInterpretationFields) && (
        <Collapsible
          open={interpretOpen}
          onOpenChange={setInterpretOpen}
          className="mt-2"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-primary hover:text-primary/80"
            >
              {interpretOpen ? (
                <ChevronDown className="h-3 w-3" aria-hidden />
              ) : (
                <ChevronRight className="h-3 w-3" aria-hidden />
              )}
              Как интерпретировать результат
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {item.interpretation ? (
              <p className="border-l-2 border-primary/30 pl-2">{item.interpretation}</p>
            ) : (
              <p className="pl-2 italic">
                Подробное руководство по интерпретации не сформировано ИИ.
                Опирайтесь на значения «Ожидаемый результат» / «Норма» /
                «Подтверждает, если» / «Исключает, если» выше и сверьтесь с КР.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
