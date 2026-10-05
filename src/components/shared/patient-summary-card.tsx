"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Calendar,
  ChevronRight,
  Dna,
  FileText,
  HeartPulse,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  User,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AnalysisResultData, CaseSummary } from "@/lib/types";

interface PatientSummaryCardProps {
  caseData: CaseSummary;
  analysis: AnalysisResultData | null;
  documents: Array<{ fileType: string; fileName: string }>;
  onJumpToTab?: (tab: string) => void;
}

/**
 * PatientSummaryCard — compact at-a-glance overview of the patient case.
 *
 * Shows:
 *   - Patient demographics (age, sex) with de-identified token
 *   - Primary diagnosis (from analysis conclusion) with ICD-10 code chips
 *   - Risk stratification meter (based on AI confidence + DDI alerts + mutations)
 *   - Document inventory by type (discharge/genetic/image counts)
 *   - Key clinical flags (DDI alerts, pathogenic mutations, missing consent)
 *
 * This card sits at the top of the CaseWorkspace, above the Tabs, so the doctor
 * gets an instant clinical picture before diving into the detailed analysis.
 */
export function PatientSummaryCard({ caseData, analysis, documents, onJumpToTab }: PatientSummaryCardProps) {
  // ─── Compute risk level ────────────────────────────────────────────────
  const risk = React.useMemo(() => computeRisk(analysis), [analysis]);

  // ─── Document inventory ────────────────────────────────────────────────
  const docStats = React.useMemo(() => {
    const discharge = documents.filter((d) => d.fileType === "discharge").length;
    const genetic = documents.filter((d) => d.fileType === "genetic").length;
    const image = documents.filter((d) => d.fileType === "image").length;
    return { discharge, genetic, image, total: documents.length };
  }, [documents]);

  // ─── ICD-10 codes ──────────────────────────────────────────────────────
  const icd10Codes = (caseData.icd10Codes ?? []) as Array<{ code: string; description?: string }>;

  // ─── Key mutations ─────────────────────────────────────────────────────
  const pathogenicMutations = (analysis?.mutations ?? []).filter(
    (m) => m.clinicalSignificance === "pathogenic" || m.clinicalSignificance === "likely_pathogenic",
  );

  return (
    <Card className={cn(
      "relative overflow-hidden border-l-4",
      risk.level === "high" && "border-l-red-500",
      risk.level === "medium" && "border-l-amber-500",
      risk.level === "low" && "border-l-emerald-500",
    )}>
      {/* Risk level gradient background accent */}
      <div className={cn(
        "absolute inset-x-0 top-0 h-1",
        risk.level === "high" && "bg-gradient-to-r from-red-500 to-rose-500",
        risk.level === "medium" && "bg-gradient-to-r from-amber-500 to-orange-500",
        risk.level === "low" && "bg-gradient-to-r from-emerald-500 to-teal-500",
      )} />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4 text-primary" />
            Краткая сводка пациента
          </CardTitle>
          <RiskBadge level={risk.level} score={risk.score} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Top row: demographics + diagnosis */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Demographics */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Пациент</div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-medical-gradient-soft text-primary">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-mono text-sm font-semibold">{caseData.patientToken}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {caseData.birthYear && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date().getFullYear() - caseData.birthYear} лет
                    </span>
                  )}
                  {caseData.sex && (
                    <span>{caseData.sex === "М" ? "♂ Муж" : "♀ Жен"}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Primary diagnosis */}
          <div className="space-y-2 sm:col-span-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Диагноз</div>
            <div className="flex items-start gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <HeartPulse className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight">
                  {caseData.diagnosisHint ?? (analysis?.conclusion ? extractDiagnosis(analysis.conclusion) : "Не установлен")}
                </div>
                {icd10Codes.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {icd10Codes.slice(0, 3).map((c, i) => (
                      <Badge key={i} variant="outline" className="border-sky-500/30 bg-sky-500/10 font-mono text-[10px] text-sky-700 dark:text-sky-300">
                        {c.code}
                      </Badge>
                    ))}
                    {icd10Codes.length > 3 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        +{icd10Codes.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Risk meter */}
          <div className="space-y-2 sm:col-span-2 lg:col-span-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Оценка риска
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Композитный риск</span>
                {!analysis ? (
                  <span className="font-medium text-muted-foreground">Недоступно</span>
                ) : (
                  <span className={cn(
                    "font-bold tabular-nums",
                    risk.level === "high" && "text-red-600 dark:text-red-400",
                    risk.level === "medium" && "text-amber-600 dark:text-amber-400",
                    risk.level === "low" && "text-emerald-600 dark:text-emerald-400",
                  )}>
                    {Math.round(risk.score * 100)}%
                  </span>
                )}
              </div>
              {analysis ? (
                <Progress
                  value={risk.score * 100}
                  className={cn(
                    "h-2",
                    risk.level === "high" && "[&>div]:bg-red-500",
                    risk.level === "medium" && "[&>div]:bg-amber-500",
                    risk.level === "low" && "[&>div]:bg-emerald-500",
                  )}
                />
              ) : (
                <div className="h-2 w-full rounded-full bg-muted" />
              )}
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                <span>{analysis ? `${risk.factors.length} факторов риска` : "Анализ не выполнен"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row: clinical flags + document inventory */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Clinical flags */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Клинические флаги
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pathogenicMutations.length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
                        <Dna className="mr-1 h-3 w-3" />
                        {pathogenicMutations.length} патогенных мутаций
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {pathogenicMutations.map((m, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-mono font-semibold">{m.gene}</span>: {m.variant}
                        </div>
                      ))}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {(analysis?.ddiAlerts ?? []).length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="mr-1 h-3 w-3" />
                        {(analysis?.ddiAlerts ?? []).length} DDI-алертов
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {(analysis?.ddiAlerts ?? []).slice(0, 3).map((a, i) => (
                        <div key={i} className="text-xs">
                          {a.drug1} + {a.drug2} ({a.severity})
                        </div>
                      ))}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {analysis && (analysis.confidence?.diagnosis ?? 0) >= 0.7 && (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  Высокая уверенность ИИ
                </Badge>
              )}
              {analysis && (analysis.confidence?.diagnosis ?? 0) > 0 && (analysis.confidence.diagnosis) < 0.4 && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Низкая уверенность ИИ
                </Badge>
              )}
              {!analysis && (
                <Badge variant="outline" className="text-muted-foreground">
                  <Activity className="mr-1 h-3 w-3" />
                  Анализ не выполнен
                </Badge>
              )}
              {pathogenicMutations.length === 0 && (analysis?.ddiAlerts ?? []).length === 0 && analysis && (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  Критических флагов нет
                </Badge>
              )}
            </div>
          </div>

          {/* Document inventory */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Документы ({docStats.total})
            </div>
            <div className="flex flex-wrap gap-2">
              <DocTypeChip icon={FileText} label="Выписки" count={docStats.discharge} color="sky" />
              <DocTypeChip icon={Dna} label="Генетика" count={docStats.genetic} color="emerald" />
              <DocTypeChip icon={Activity} label="Изображения" count={docStats.image} color="violet" />
            </div>
          </div>
        </div>

        {/* Risk factors breakdown (if any) */}
        {risk.factors.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Факторы, влияющие на оценку риска:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {risk.factors.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  {f.label} ({f.weight > 0 ? "+" : ""}{Math.round(f.weight * 100)}%)
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────

function RiskBadge({ level, score }: { level: "high" | "medium" | "low"; score: number }) {
  const config = {
    high: { label: "Высокий риск", color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", icon: AlertTriangle },
    medium: { label: "Средний риск", color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: ShieldAlert },
    low: { label: "Низкий риск", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: ShieldCheck },
  };
  const cfg = config[level];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", cfg.color)}>
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </Badge>
  );
}

function DocTypeChip({ icon: Icon, label, count, color }: { icon: LucideIcon; label: string; count: number; color: "sky" | "emerald" | "violet" }) {
  const colorMap = {
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  return (
    <div className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", count === 0 ? "opacity-40" : "", colorMap[color])}>
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      <span className="font-bold tabular-nums">{count}</span>
    </div>
  );
}

// ─── Risk computation ─────────────────────────────────────────────────────

interface RiskFactor {
  label: string;
  weight: number; // -1..+1, positive = increases risk
}

interface RiskAssessment {
  level: "high" | "medium" | "low";
  score: number; // 0..1
  factors: RiskFactor[];
}

function computeRisk(analysis: AnalysisResultData | null): RiskAssessment {
  if (!analysis) {
    return { level: "low", score: 0, factors: [] };
  }

  const factors: RiskFactor[] = [];
  let score = 0; // baseline — no risk without evidence

  // Pathogenic mutations increase risk
  const pathogenicCount = (analysis.mutations ?? []).filter(
    (m) => m.clinicalSignificance === "pathogenic" || m.clinicalSignificance === "likely_pathogenic",
  ).length;
  if (pathogenicCount > 0) {
    const weight = Math.min(pathogenicCount * 0.2, 0.6);
    factors.push({ label: `${pathogenicCount} патогенных мутаций`, weight });
    score += weight;
  }

  // DDI alerts increase risk
  const ddiCount = (analysis.ddiAlerts ?? []).length;
  if (ddiCount > 0) {
    const severeCount = (analysis.ddiAlerts ?? []).filter(
      (a) => a.severity === "contraindication" || a.severity === "major",
    ).length;
    const weight = Math.min(ddiCount * 0.1 + severeCount * 0.15, 0.5);
    factors.push({ label: `${ddiCount} DDI-алертов (${severeCount} тяжёлых)`, weight });
    score += weight;
  }

  // Low AI confidence increases risk (uncertainty)
  const diagConfidence = analysis.confidence?.diagnosis ?? 0;
  if (diagConfidence > 0 && diagConfidence < 0.4) {
    const weight = 0.2;
    factors.push({ label: "Низкая уверенность ИИ в диагнозе", weight });
    score += weight;
  }

  // High confidence decreases risk
  if (diagConfidence >= 0.7) {
    const weight = -0.1;
    factors.push({ label: "Высокая уверенность ИИ", weight });
    score += weight;
  }

  score = Math.max(0, Math.min(1, score));

  let level: "high" | "medium" | "low";
  if (score >= 0.6) level = "high";
  else if (score >= 0.35) level = "medium";
  else level = "low";

  return { level, score, factors };
}

// ─── Diagnosis extraction ────────────────────────────────────────────────

function extractDiagnosis(conclusion: string): string {
  // Try to extract the diagnosis from the "### ДИАГНОЗ" section
  const match = conclusion.match(/###\s*ДИАГНОЗ\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (match) {
    const text = match[1].trim();
    // Take the first 2 lines (usually "Основной диагноз: ..." + stage)
    const lines = text.split("\n").filter((l) => l.trim());
    return lines.slice(0, 2).join(" — ").slice(0, 200);
  }
  // Fallback: first 100 chars
  return conclusion.slice(0, 100);
}
