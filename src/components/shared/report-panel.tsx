"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileDown,
  CheckCircle2,
  Loader2,
  FileText,
  ShieldCheck,
  Clock,
  Layout,
  PenTool,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { ReportRecord, TemplateItem, ReportSignatureRecord } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/utils";

interface Props {
  caseId: string;
  reports: ReportRecord[];
  hasAnalysis: boolean;
}

export function ReportPanel({ caseId, reports, hasAnalysis }: Props) {
  const qc = useQueryClient();
  const currentDoctor = useAppStore((s) => s.currentDoctor);
  const [selectedTemplate, setSelectedTemplate] = React.useState<string>("default");
  const [signComment, setSignComment] = React.useState("");
  const [signingReportId, setSigningReportId] = React.useState<string | null>(null);

  const { data: templatesData } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.getTemplates(),
  });

  const templates: TemplateItem[] = Array.isArray(templatesData)
    ? templatesData
    : templatesData?.templates ?? [];

  const genMut = useMutation({
    mutationFn: () =>
      api.generateReport(caseId, `Заключение СППВР — ${new Date().toLocaleDateString("ru-RU")}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success("Отчёт сгенерирован");
    },
    onError: (e: Error) => toast.error("Ошибка генерации: " + e.message),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.approveReport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success("Отчёт утверждён");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const signMut = useMutation({
    mutationFn: ({ reportId, comment }: { reportId: string; comment: string }) =>
      api.signReport({ reportId, signatureType: "approval", comment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success("Электронная подпись добавлена");
      setSigningReportId(null);
      setSignComment("");
    },
    onError: (e: Error) => toast.error("Ошибка подписи: " + e.message),
  });

  const seedMut = useMutation({
    mutationFn: () => api.seedTemplates(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Шаблоны загружены");
    },
    onError: (e: Error) => toast.error("Ошибка загрузки шаблонов: " + e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Генерация отчёта
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Сформировать итоговое медицинское заключение в PDF с водяным знаком, датой, временем и ID врача.
          </p>

          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <Layout className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Шаблон отчёта</span>
            </div>
            {templates.length === 0 ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Шаблоны не загружены</p>
                <Button variant="outline" size="sm" onClick={() => seedMut.mutate()} disabled={seedMut.isPending} className="gap-1.5 text-xs">
                  {seedMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Загрузить шаблоны
                </Button>
              </div>
            ) : (
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите шаблон" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Общий медицинский отчёт</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-wrap gap-2 rounded-lg bg-muted/50 p-3 text-xs">
            <div className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />Водяной знак</div>
            <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-primary" />Дата и время</div>
            <div className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-muted-foreground" />ID врача</div>
            <div className="flex items-center gap-1.5"><PenTool className="h-3.5 w-3.5 text-muted-foreground" />ЭЦП</div>
          </div>

          <Button onClick={() => genMut.mutate()} disabled={genMut.isPending || !hasAnalysis} className="mt-3 w-full gap-2 sm:w-auto">
            {genMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Генерация PDF…</> : <><FileDown className="h-4 w-4" /> Сформировать отчёт</>}
          </Button>
          {!hasAnalysis && <p className="mt-2 text-xs text-amber-600">Сначала выполните анализ случая</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Отчёты случая
            <Badge variant="secondary" className="ml-auto">{reports.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Отчётов пока нет</p>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1 -mr-1">
              <div className="space-y-2">
                {reports.map((r) => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    onApprove={() => approveMut.mutate(r.id)}
                    approving={approveMut.isPending}
                    onSign={() => setSigningReportId(r.id)}
                    isSigning={signMut.isPending && signingReportId === r.id}
                    signComment={signingReportId === r.id ? signComment : ""}
                    onSignCommentChange={setSignComment}
                    onSignSubmit={() => signMut.mutate({ reportId: r.id, comment: signComment })}
                    currentDoctorId={currentDoctor?.id}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportRow({
  report,
  onApprove,
  approving,
  onSign,
  isSigning,
  signComment,
  onSignCommentChange,
  onSignSubmit,
  currentDoctorId,
}: {
  report: ReportRecord;
  onApprove: () => void;
  approving: boolean;
  onSign: () => void;
  isSigning: boolean;
  signComment: string;
  onSignCommentChange: (v: string) => void;
  onSignSubmit: () => void;
  currentDoctorId?: string;
}) {
  const isApproved = report.status === "approved";
  const isSigned = report.status === "signed";

  return (
    <div className={cn("rounded-lg border p-3", (isApproved || isSigned) && "border-emerald-500/40 bg-emerald-500/5")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-sm">{report.title}</span>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 text-xs",
                isSigned ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400" :
                isApproved ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400" :
                "text-muted-foreground",
              )}
            >
              {isSigned ? "Подписан" : isApproved ? "Утверждён" : "Черновик"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{new Date(report.createdAt).toLocaleString("ru-RU")}</span>
            {report.watermark && <span className="text-emerald-600">WM: {report.watermark}</span>}
          </div>
        </div>
      </div>

      {/* Signatures */}
      {report.signatures && report.signatures.length > 0 && (
        <div className="mt-2 space-y-1">
          {report.signatures.map((sig) => (
            <div key={sig.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <PenTool className="h-3 w-3 text-emerald-600" />
              <span className="font-medium">{sig.doctor?.fullName ?? "Врач"}</span>
              <span>{sig.signatureType === "approval" ? "Утверждение" : sig.signatureType === "review" ? "Рецензия" : "Со-подписание"}</span>
              <span>{new Date(sig.signedAt).toLocaleString("ru-RU")}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={async () => {
            try {
              await api.downloadReport(report.id);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Не удалось скачать PDF");
            }
          }}
        >
          <FileDown className="h-4 w-4" />
          Скачать PDF
        </Button>

        {!isApproved && !isSigned && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="default" size="sm" className="gap-1.5" disabled={approving}>
                <CheckCircle2 className="h-4 w-4" />
                Утвердить
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Утвердить отчёт?</AlertDialogTitle>
                <AlertDialogDescription>
                  После утверждения отчёт получает статус «Утверждён» с фиксацией даты/времени и ID врача в журнале аудита (ФЗ-152).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={onApprove}>Утвердить</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {isApproved && !isSigned && (
          <div className="flex items-center gap-2">
            {isSigning ? (
              <>
                <Input
                  value={signComment}
                  onChange={(e) => onSignCommentChange(e.target.value)}
                  placeholder="Комментарий к подписи"
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={onSignSubmit} disabled={!signComment.trim()} className="gap-1.5">
                  <PenTool className="h-3.5 w-3.5" />
                  Подписать
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={onSign} className="gap-1.5">
                <PenTool className="h-3.5 w-3.5" />
                ЭЦП
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { Input } from "@/components/ui/input";
