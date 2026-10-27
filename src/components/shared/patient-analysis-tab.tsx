"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ArrowLeft,
  FileText,
  FolderOpen,
  Calendar,
  Loader2,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CaseWorkspace } from "@/components/views/case-workspace";

/* ------------------------------------------------------------------ */
/* Status badge config                                                 */
/* ------------------------------------------------------------------ */

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "bg-muted text-muted-foreground" },
  uploaded: {
    label: "Загружен",
    color: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  },
  analyzing: {
    label: "Анализ",
    color: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  analyzed: {
    label: "Готов",
    color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  reported: {
    label: "Отчёт",
    color: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  },
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CaseItem {
  id: string;
  caseCode: string;
  status: string;
  diagnosisHint?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { documents: number; reports: number };
}

interface PatientAnalysisTabProps {
  // Совместимость с PatientDetail (лишние поля игнорируются)
  patient: PatientDetailLike;
}

interface PatientDetailLike {
  id: string;
  patientToken: string;
  cases?: CaseItem[];
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function PatientAnalysisTab({ patient }: PatientAnalysisTabProps) {
  const { selectedCaseId, selectCase } = useAppStore();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [diagnosisHint, setDiagnosisHint] = React.useState("");
  const [notes, setNotes] = React.useState("");

  /* ---------- create-case mutation ---------- */

  const createMutation = useMutation({
    mutationFn: (data: {
      patientId: string;
      diagnosisHint?: string;
      notes?: string;
    }) => api.createCase(data),
    onSuccess: (newCase) => {
      toast.success("Кейс создан");
      setDialogOpen(false);
      setDiagnosisHint("");
      setNotes("");
      // Refresh patient so the new case appears in the list
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      // Select the newly created case
      if (newCase?.case?.id) {
        selectCase(newCase.case.id);
      }
    },
    onError: (err: Error) => {
      toast.error(`Ошибка создания кейса: ${err.message}`);
    },
  });

  const handleCreateCase = () => {
    createMutation.mutate({
      patientId: patient.id,
      diagnosisHint: diagnosisHint.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const handleSelectCase = (caseId: string) => {
    selectCase(caseId);
  };

  const handleBack = () => {
    selectCase(null);
  };

  /* ---------- Derive whether a case belonging to this patient is selected ---------- */

  const isCaseSelected =
    !!selectedCaseId &&
    patient.cases?.some((c) => c.id === selectedCaseId);

  /* ---------- Case Workspace View ---------- */

  if (isCaseSelected) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="gap-2"
        >
          <ArrowLeft className="size-4" />
          Назад к списку кейсов
        </Button>
        <CaseWorkspace />
      </div>
    );
  }

  /* ---------- Case List View ---------- */

  const cases = patient.cases ?? [];

  return (
    <div className="space-y-6">
      {/* ---- Header with create button ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            ИИ-Анализ кейсов
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Создавайте кейсы для анализа медицинских документов пациента с
            помощью искусственного интеллекта
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shrink-0">
              <Plus className="size-4" />
              Создать кейс
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый аналитический кейс</DialogTitle>
              <DialogDescription>
                Создайте кейс для ИИ-анализа медицинских документов пациента{" "}
                <span className="font-medium text-foreground">
                  {patient.patientToken}
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="diagnosis-hint">Предварительный диагноз</Label>
                <Input
                  id="diagnosis-hint"
                  placeholder="Например: Хроническая сердечная недостаточность"
                  value={diagnosisHint}
                  onChange={(e) => setDiagnosisHint(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="case-notes">Примечания</Label>
                <Textarea
                  id="case-notes"
                  placeholder="Дополнительные сведения о случае..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={createMutation.isPending}
              >
                Отмена
              </Button>
              <Button
                onClick={handleCreateCase}
                disabled={createMutation.isPending}
                className="gap-2"
              >
                {createMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* ---- Case list ---- */}
      {cases.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <FolderOpen className="size-8 text-muted-foreground" />
            </div>
            <h4 className="font-medium text-base">Нет аналитических кейсов</h4>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Создайте первый кейс, чтобы загрузить медицинские документы и
              запустить ИИ-анализ
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => {
            const statusInfo = STATUS_MAP[c.status] ?? {
              label: c.status,
              color: "bg-muted text-muted-foreground",
            };
            const createdDate = new Date(c.createdAt);
            const formattedDate = createdDate.toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });

            return (
              <Card
                key={c.id}
                className="cursor-pointer transition-colors hover:bg-accent/50 group"
                onClick={() => handleSelectCase(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectCase(c.id);
                  }
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-semibold leading-snug">
                      {c.caseCode}
                    </CardTitle>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "shrink-0 text-[11px] font-medium px-2 py-0.5",
                        statusInfo.color,
                      )}
                    >
                      {statusInfo.label}
                    </Badge>
                  </div>
                  {c.diagnosisHint ? (
                    <CardDescription className="line-clamp-2 text-xs">
                      {c.diagnosisHint}
                    </CardDescription>
                  ) : null}
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="size-3" />
                      {formattedDate}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FileText className="size-3" />
                      {c._count?.documents ?? 0}{" "}
                      {pluralizeDocs(c._count?.documents ?? 0)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function pluralizeDocs(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "док.";
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100))
    return "док.";
  return "док.";
}
