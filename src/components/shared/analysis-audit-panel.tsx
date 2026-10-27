"use client";

// СППВР — панель формальной проверки рекомендаций ИИ
// ---------------------------------------------------------------------------
// Показывает врачу результат детерминированных проверок (`clinical-audit.ts`):
// что в наборе рекомендаций неполно или внутренне противоречиво, насколько
// критично и что с этим делать. Отдельно — автоматические исправления
// структуры и отчёт самопроверки модели.
//
// ВАЖНО: панель не оценивает правильность медицинских утверждений. Она
// проверяет полноту и согласованность набора (есть ли альтернативы, привязан
// ли каждый тест к гипотезе, указана ли доза, нет ли аллергии из карты).
// ============================================================================

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  OctagonAlert,
  ScanSearch,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { ClinicalAuditReport } from "@/lib/clinical-audit";
import { AUDIT_CATEGORY_LABEL, AUDIT_SEVERITY_LABEL } from "@/lib/clinical-audit";
import type { VerificationReport } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { passesLabel } from "@/lib/plural";

const SEVERITY_META = {
  critical: {
    badgeCls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    iconCls: "text-red-600 dark:text-red-400",
    icon: OctagonAlert,
  },
  warning: {
    badgeCls: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    iconCls: "text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  info: {
    badgeCls: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    iconCls: "text-muted-foreground",
    icon: Info,
  },
} as const;

function scoreTone(score: number): { text: string; bar: string; label: string } {
  if (score >= 85) {
    return {
      text: "text-emerald-700 dark:text-emerald-400",
      bar: "[&>div]:bg-emerald-500",
      label: "Набор полон и согласован",
    };
  }
  if (score >= 65) {
    return {
      text: "text-amber-700 dark:text-amber-400",
      bar: "[&>div]:bg-amber-500",
      label: "Есть устранимые пробелы",
    };
  }
  return {
    text: "text-red-700 dark:text-red-400",
    bar: "[&>div]:bg-red-500",
    label: "Требуется ручная доработка",
  };
}

export function AnalysisAuditPanel({
  report,
  verification,
  normalizationFixes = [],
  onNavigate,
}: {
  report: ClinicalAuditReport;
  verification?: VerificationReport;
  normalizationFixes?: string[];
  /** Переход к соответствующей вкладке по клику на замечание категории. */
  onNavigate?: (tab: "diagnoses" | "workup" | "therapy" | "monitoring") => void;
}) {
  const [filter, setFilter] = React.useState<"all" | "critical" | "warning">("all");
  const [fixesOpen, setFixesOpen] = React.useState(false);

  const tone = scoreTone(report.score);
  const visible = report.findings.filter((f) =>
    filter === "all" ? true : f.severity === filter,
  );

  const tabForCategory = (category: string): "diagnoses" | "workup" | "therapy" | "monitoring" | null => {
    if (category === "diagnosis") return "diagnoses";
    if (category === "workup") return "workup";
    if (category === "therapy" || category === "safety") return "therapy";
    if (category === "monitoring") return "monitoring";
    return null;
  };

  return (
    <div className="space-y-3">
      {/* Оценка */}
      <div className="rounded-lg border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-baseline gap-1">
            <span className={cn("text-3xl font-bold tabular-nums", tone.text)}>{report.score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <div className="min-w-[200px] flex-1 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">{tone.label}</span>
              <span className="text-muted-foreground">
                {report.critical} критично · {report.warning} на внимание · {report.info} замечаний
              </span>
            </div>
            <Progress value={report.score} className={cn("h-2", tone.bar)} />
          </div>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <ScanSearch className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Формальная проверка набора: полнота дифференциального ряда, привязка
          тестов к гипотезам, наличие дозы и предупреждений, аллергии из карты.
          Она не проверяет правильность медицинских утверждений — итоговое
          решение принимает врач.
        </p>
      </div>

      {/* Фильтр */}
      {report.findings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setFilter("all")}
          >
            Все ({report.findings.length})
          </Button>
          <Button
            variant={filter === "critical" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={report.critical === 0}
            onClick={() => setFilter("critical")}
          >
            Критичные ({report.critical})
          </Button>
          <Button
            variant={filter === "warning" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={report.warning === 0}
            onClick={() => setFilter("warning")}
          >
            На внимание ({report.warning})
          </Button>
        </div>
      )}

      {/* Замечания */}
      {report.findings.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Формальных замечаний нет: гипотезы полны, тесты привязаны, дозы и
          предупреждения указаны.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((f) => {
            const meta = SEVERITY_META[f.severity];
            const Icon = meta.icon;
            const targetTab = tabForCategory(f.category);
            return (
              <div key={f.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className={cn("h-4 w-4 shrink-0", meta.iconCls)} aria-hidden />
                  <span className="text-sm font-medium leading-snug">{f.title}</span>
                  <Badge variant="outline" className={cn("text-[10px]", meta.badgeCls)}>
                    {AUDIT_SEVERITY_LABEL[f.severity]}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {AUDIT_CATEGORY_LABEL[f.category]}
                  </Badge>
                  {targetTab && onNavigate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 gap-0.5 px-1.5 text-[10px] text-primary"
                      onClick={() => onNavigate(targetTab)}
                    >
                      Перейти
                      <ChevronRight className="h-3 w-3" aria-hidden />
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
                {f.action && (
                  <p className="mt-1 text-xs leading-relaxed">
                    <span className="font-semibold text-foreground">Что сделать: </span>
                    {f.action}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Автоматические исправления структуры */}
      {normalizationFixes.length > 0 && (
        <div className="rounded-lg border">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 px-3 py-2 text-xs"
            onClick={() => setFixesOpen((v) => !v)}
            aria-expanded={fixesOpen}
          >
            <Wrench className="h-3.5 w-3.5 text-primary" aria-hidden />
            Автоматические исправления структуры ({normalizationFixes.length})
            {fixesOpen ? (
              <ChevronDown className="ml-auto h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="ml-auto h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
          {fixesOpen && (
            <ul className="space-y-1 border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              {normalizationFixes.map((fix, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-primary">•</span>
                  <span>{fix}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Самопроверка модели */}
      {verification && (
        <div className="rounded-lg border p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            Самопроверка модели
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                verification.performed
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-slate-500/30 bg-slate-500/10 text-muted-foreground",
              )}
            >
              {verification.performed
                ? `Самопроверка: ${passesLabel(verification.passes)}`
                : "Самопроверка не выполнялась"}
            </Badge>
            {verification.factsGrounded === true && (
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Все утверждения подтверждены исходными данными
              </span>
            )}
          </div>
          {verification.corrections.length > 0 ? (
            <ul className="mt-2 space-y-1 border-t pt-2 text-[11px] leading-snug">
              {verification.corrections.map((c, i) => (
                <li key={i} className="flex gap-1.5">
                  <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Существенных расхождений при самопроверке не найдено.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
