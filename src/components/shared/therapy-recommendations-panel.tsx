"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Pill,
  Route,
  TestTube,
  Scale,
  RefreshCw,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import type { TherapyRecommendation } from "@/lib/types";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  caseId: string;
  hasAnalysis: boolean;
  initialRecommendations?: TherapyRecommendation[];
}

const CATEGORY_META: Record<TherapyRecommendation["category"], { icon: React.ElementType; label: string; color: string; badgeColor: string }> = {
  medications: { icon: Pill, label: "Рекомендуемые препараты", color: "text-emerald-600 dark:text-emerald-400", badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  tactics: { icon: Route, label: "Тактики лечения", color: "text-blue-600 dark:text-blue-400", badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  tests: { icon: TestTube, label: "Рекомендуемые анализы", color: "text-violet-600 dark:text-violet-400", badgeColor: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  dose_adjustments: { icon: Scale, label: "Коррекция доз", color: "text-amber-600 dark:text-amber-400", badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  alternatives: { icon: RefreshCw, label: "Альтернативные схемы", color: "text-rose-600 dark:text-rose-400", badgeColor: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

const PRIORITY_META: Record<string, { label: string; className: string }> = {
  high: { label: "Высокий", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  medium: { label: "Средний", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
  low: { label: "Низкий", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

export function TherapyRecommendationsPanel({ caseId, hasAnalysis, initialRecommendations }: Props) {
  const qc = useQueryClient();
  const [recommendations, setRecommendations] = React.useState<TherapyRecommendation[]>(initialRecommendations || []);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = React.useState<Set<string>>(new Set());
  // Tracks whether the last "Generate" call was served by an actual LLM
  // (true) or by the rule-based manual fallback (false). When false the
  // panel shows a "Без ИИ" (Generated without AI) badge so the doctor
  // knows to double-check the suggestions manually.
  const [aiAvailable, setAiAvailable] = React.useState<boolean | null>(null);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!hasAnalysis) { toast.error("Сначала выполните анализ случая"); return; }
    setIsGenerating(true);
    setError(null);
    try {
      const result = await api.generateTherapyRecommendations(caseId);
      setRecommendations(result.therapyRecommendations);
      setExpandedCategories(new Set(result.therapyRecommendations.map((r) => r.category)));
      // Backend returns aiAvailable: false in manual mode (no LM Studio).
      // undefined → treat as true to avoid false alarms for
      // older responses that didn't include the flag.
      const served = result.aiAvailable !== false;
      setAiAvailable(served);
      // The backend persists the generated recommendations into
      // analysisResult.therapyRecommendations. Invalidate the case query so
      // the cached case (and any sibling panels reading from it) refetches.
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      if (served) {
        toast.success("Рекомендации по терапии сгенерированы");
      } else {
        toast.info("Рекомендации сгенерированы без ИИ (manual mode)");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка генерации рекомендаций";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const totalItems = recommendations.reduce((sum, cat) => sum + cat.items.length, 0);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            Рекомендации по терапии
            {totalItems > 0 && <Badge variant="secondary" className="ml-1 text-xs">{totalItems}</Badge>}
            {aiAvailable === false && (
              <Badge variant="outline" className="ml-1 text-xs border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                Без ИИ
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating || !hasAnalysis} className="gap-1.5">
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {recommendations.length > 0 ? "Обновить" : "Сгенерировать"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {recommendations.length === 0 && !isGenerating && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Pill className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {hasAnalysis ? "Нажмите «Сгенерировать» для получения AI-рекомендаций по терапии" : "Сначала выполните анализ случая для получения рекомендаций"}
            </p>
          </div>
        )}

        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-emerald-600" />
            <p className="text-sm text-muted-foreground">Генерация рекомендаций по терапии...</p>
          </div>
        )}

        {!isGenerating && recommendations.length > 0 && (
          <div className="space-y-3">
            {recommendations.map((cat) => {
              const meta = CATEGORY_META[cat.category];
              if (!meta) return null;
              const Icon = meta.icon;
              const isExpanded = expandedCategories.has(cat.category);
              const highCount = cat.items.filter((i) => i.priority === "high").length;

              return (
                <div key={cat.category} className="rounded-lg border border-border/50 bg-card/50 transition-colors hover:border-border">
                  <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => toggleCategory(cat.category)} aria-expanded={isExpanded}>
                    <Icon className={cn("h-5 w-5 shrink-0", meta.color)} />
                    <div className="flex-1">
                      <span className="font-medium text-sm">{meta.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">({cat.items.length})</span>
                    </div>
                    {highCount > 0 && <Badge className={cn("text-xs", PRIORITY_META.high.className)}>{highCount} приоритет</Badge>}
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/40 px-3 pb-3 pt-2">
                      <div className="space-y-2">
                        {cat.items.map((item, idx) => (
                          <div key={idx} className="rounded-md border border-border/30 bg-background/50 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-sm font-medium leading-snug">{item.name}</h4>
                              {item.priority && PRIORITY_META[item.priority] && (
                                <Badge variant="outline" className={cn("shrink-0 text-[10px] px-1.5 py-0", PRIORITY_META[item.priority].className)}>
                                  {PRIORITY_META[item.priority].label}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                            {item.evidenceLevel && (
                              <p className="mt-1.5 text-[11px] text-muted-foreground/70 italic">Источник: {item.evidenceLevel}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
