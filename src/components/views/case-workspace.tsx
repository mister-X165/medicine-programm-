"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  Cpu,
  Sliders,
  FileDown,
  Loader2,
  User,
  Calendar,
  AlertTriangle,
  Hand,
  Share2,
  Sparkles,
  ClipboardCheck,
  ShieldAlert,
  Code,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadZone } from "@/components/shared/upload-zone";
import { DocumentViewer } from "@/components/shared/document-viewer";
import { AnalysisPanel } from "@/components/shared/analysis-panel";
import { ControlPanel } from "@/components/shared/control-panel";
import { ReportPanel } from "@/components/shared/report-panel";
import { CaseSharePanel } from "@/components/shared/case-share-panel";
import { TherapyRecommendationsPanel } from "@/components/shared/therapy-recommendations-panel";
import { AiChatPanel } from "@/components/shared/ai-chat-panel";
import { ConsentManager } from "@/components/shared/consent-manager";
import { PatientSummaryCard } from "@/components/shared/patient-summary-card";
import { toast } from "sonner";

export function CaseWorkspace() {
  const { selectedCaseId, selectCase, currentDoctor } = useAppStore();
  const qc = useQueryClient();

  // Lifted Tabs state — allows the consent gate's "Перейти к согласиям" button
  // (and the post-grant auto-switch) to programmatically change the active tab.
  const [activeTab, setActiveTab] = React.useState("documents");

  const { data, isLoading, error } = useQuery({
    queryKey: ["case", selectedCaseId],
    queryFn: () => api.getCase(selectedCaseId!),
    enabled: !!selectedCaseId,
  });

  // Consent gate: we need to know whether the patient has granted the
  // `ai_analysis` consent before enabling the analyze buttons. We fetch the
  // consents list in parallel with the case data — the query is reused by
  // the ConsentsPanel below (same queryKey), so no extra network round-trip.
  const { data: consentsData } = useQuery({
    queryKey: ["consents", selectedCaseId],
    queryFn: () => api.getConsents(selectedCaseId!),
    enabled: !!selectedCaseId,
  });
  const hasAiConsent = !!consentsData?.consents.find(
    (c) => c.consentType === "ai_analysis" && c.granted,
  );

  const therapyRecommendations = React.useMemo(() => {
    const analysis = data?.case?.analysis;
    if (!analysis?.therapyRecommendations) return [];
    try {
      if (typeof analysis.therapyRecommendations === "string") return JSON.parse(analysis.therapyRecommendations);
      return Array.isArray(analysis.therapyRecommendations) ? analysis.therapyRecommendations : [];
    } catch { return []; }
  }, [data?.case?.analysis?.therapyRecommendations]);

  const analyzeMut = useMutation({
    mutationFn: (manual: boolean) => {
      // Defensive double-check: even if the UI gate fails, never run the
      // analysis without the ai_analysis consent. This is the last line of
      // defence before the request leaves the browser.
      if (!hasAiConsent) {
        throw new Error(
          "Требуется согласие пациента на ИИ-анализ (ФЗ-152 ст.9)",
        );
      }
      return api.runAnalysis(selectedCaseId!, manual);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", selectedCaseId] });
      qc.invalidateQueries({ queryKey: ["analysis", selectedCaseId] });
      toast.success("Анализ завершён");
    },
    onError: (e: Error) => toast.error("Ошибка анализа: " + e.message),
  });

  if (!selectedCaseId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground">Случай не выбран</p>
        <Button variant="outline" className="mt-4" onClick={() => useAppStore.getState().setView("dashboard")}>Вернуться к списку</Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">{error?.message ?? "Случай не найден"}</p>
          <Button variant="outline" className="mt-4" onClick={() => selectCase(null)}>Назад</Button>
        </CardContent>
      </Card>
    );
  }

  const { case: caseData } = data;
  const documents = caseData.documents ?? [];
  const analysis = caseData.analysis ?? null;
  const reports = caseData.reports ?? [];
  const hasDocuments = documents.length > 0;
  const hasAnalysis = !!analysis;
  const isCaseOwner = currentDoctor?.id === caseData.doctor?.id;

  return (
    <div className="space-y-4">
      {/* Enhanced case header with gradient accent */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                // v2.7.2 (audit fix): «Назад» возвращает в контекст, из которого
                // открыт кейс — в карту пациента (если кейс привязан к выбранному
                // пациенту) или на рабочий стол.
                const state = useAppStore.getState();
                selectCase(null);
                if (state.view === "case-workspace") {
                  const backToPatient =
                    !!caseData.patientId &&
                    state.selectedPatientId === caseData.patientId;
                  state.setView(backToPatient ? "medical-record" : "dashboard");
                }
              }}
              className="shrink-0 bg-background/60 backdrop-blur-sm"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight md:text-2xl">{caseData.caseCode}</h1>
                <CaseStatusBadge status={caseData.status} />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{caseData.diagnosisHint ?? "Без предварительного диагноза"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {caseData.birthYear && <span className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1"><Calendar className="h-3.5 w-3.5" />{caseData.birthYear} г.р.</span>}
            {caseData.sex && <span className="rounded-full border border-sky-500/20 bg-sky-500/5 px-2.5 py-1">{caseData.sex === "М" ? "♂ Муж" : "♀ Жен"}</span>}
            <span className="flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/5 px-2.5 py-1"><User className="h-3.5 w-3.5" />{caseData.doctor?.fullName}</span>
          </div>
        </div>
      </div>

      {/* Patient Summary Card — at-a-glance clinical overview */}
      <PatientSummaryCard
        caseData={caseData}
        analysis={analysis}
        documents={documents}
        onJumpToTab={setActiveTab}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={cn("grid w-full", isCaseOwner ? "grid-cols-3 sm:grid-cols-7" : "grid-cols-3 sm:grid-cols-6")}>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Документы</span>
            {documents.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{documents.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1.5">
            <Cpu className="h-4 w-4" />
            <span className="hidden sm:inline">Анализ</span>
          </TabsTrigger>
          <TabsTrigger value="therapy" className="gap-1.5" disabled={!hasAnalysis}>
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Терапия</span>
          </TabsTrigger>
          <TabsTrigger value="control" className="gap-1.5" disabled={!hasAnalysis}>
            <Sliders className="h-4 w-4" />
            <span className="hidden sm:inline">Контроль</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5">
            <FileDown className="h-4 w-4" />
            <span className="hidden sm:inline">Отчёты</span>
            {reports.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{reports.length}</Badge>}
          </TabsTrigger>
          {isCaseOwner && (
            <TabsTrigger value="share" className="gap-1.5">
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Доступы</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="consents" className="gap-1.5">
            <ClipboardCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Согласия</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Загрузка данных</h3>
              <UploadZone caseId={selectedCaseId} />
            </CardContent>
          </Card>
          <div>
            <h3 className="mb-3 text-sm font-semibold">Загруженные документы</h3>
            <DocumentViewer caseId={selectedCaseId} documents={documents} />
          </div>
          {hasDocuments && (
            <div className="space-y-3">
              {!hasAiConsent && (
                <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-900 dark:text-amber-200">
                    Требуется согласие пациента на ИИ-анализ
                  </AlertTitle>
                  <AlertDescription className="flex flex-col gap-2 text-amber-800 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm">
                      В соответствии с ФЗ-152 ст.9 запуск ИИ-анализа без согласия
                      пациента запрещён.
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 gap-1.5 border-amber-500/50 text-amber-800 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-500/20"
                      onClick={() => setActiveTab("consents")}
                      aria-label="Перейти к управлению согласиями"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      Перейти к согласиям
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex justify-center">
                <Button
                  size="lg"
                  onClick={() => analyzeMut.mutate(false)}
                  disabled={analyzeMut.isPending || !hasAiConsent}
                  className="gap-2"
                  title={
                    !hasAiConsent
                      ? "Требуется согласие пациента на ИИ-анализ (ФЗ-152 ст.9)"
                      : undefined
                  }
                  aria-disabled={!hasAiConsent}
                >
                  {analyzeMut.isPending ? (
                    <><Loader2 className="h-5 w-5 animate-spin" />Анализ выполняется…</>
                  ) : (
                    <><Cpu className="h-5 w-5" />Запустить мультимодальный анализ</>
                  )}
                </Button>
              </div>
              {!hasAiConsent && (
                <p className="text-center text-xs text-muted-foreground">
                  Кнопка отключена: нет согласия на ИИ-анализ (ФЗ-152 ст.9)
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analysis">
          {analyzeMut.isPending && !hasAnalysis ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                <p className="text-sm font-medium">Выполняется анализ…</p>
                <p className="mt-1 text-xs text-muted-foreground">NER · интерпретация мутаций · RAG · генерация заключения</p>
              </CardContent>
            </Card>
          ) : hasAnalysis ? (
            <AnalysisPanel analysis={analysis} caseId={selectedCaseId} onRunAnalysis={(m) => analyzeMut.mutate(m)} isAnalyzing={analyzeMut.isPending} hasDocuments={hasDocuments} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Cpu className="mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium">Анализ не выполнен</p>
                <p className="mt-1 text-xs text-muted-foreground">Загрузите документы и запустите анализ</p>
                {!hasAiConsent && hasDocuments && (
                  <Alert className="mt-4 max-w-md border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-sm text-amber-900 dark:text-amber-200">
                      Требуется согласие на ИИ-анализ (ФЗ-152 ст.9)
                    </AlertTitle>
                    <AlertDescription className="flex flex-col gap-2 text-amber-800 dark:text-amber-300">
                      <span className="text-xs">
                        Без согласия пациента запуск ИИ-анализа запрещён.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-fit gap-1.5 border-amber-500/50 text-amber-800 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-500/20"
                        onClick={() => setActiveTab("consents")}
                        aria-label="Перейти к управлению согласиями"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        Перейти к согласиям
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  variant="outline"
                  className="mt-4 gap-2"
                  disabled={!hasDocuments || analyzeMut.isPending || !hasAiConsent}
                  onClick={() => analyzeMut.mutate(false)}
                  title={
                    !hasAiConsent
                      ? "Требуется согласие пациента на ИИ-анализ (ФЗ-152 ст.9)"
                      : !hasDocuments
                        ? "Сначала загрузите документы"
                        : undefined
                  }
                  aria-disabled={!hasAiConsent || !hasDocuments}
                >
                  <Cpu className="h-4 w-4" />Запустить анализ
                </Button>
                {!hasAiConsent && hasDocuments && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Кнопка отключена: нет согласия на ИИ-анализ
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="therapy">
          <div className="flex h-[calc(100vh-12rem)] gap-4">
            <div className="flex-1 overflow-y-auto pr-1">
              <TherapyRecommendationsPanel caseId={selectedCaseId} hasAnalysis={hasAnalysis} initialRecommendations={therapyRecommendations} />
            </div>
            <div className="hidden w-80 shrink-0 lg:block">
              <AiChatPanel
                caseContext={{ diagnosisHint: caseData.diagnosisHint ?? undefined, analysisSummary: analysis?.conclusion ?? undefined }}
                documentText={documents.map((d) => `--- ${d.fileName} ---\n${d.deidContent || d.rawContent || ""}`).join("\n\n")}
                documentTitle={`Документы случая ${caseData.caseCode}`}
              />
            </div>
          </div>
          <div className="mt-4 lg:hidden">
            <AiChatPanel
              caseContext={{ diagnosisHint: caseData.diagnosisHint ?? undefined, analysisSummary: analysis?.conclusion ?? undefined }}
              documentText={documents.map((d) => `--- ${d.fileName} ---\n${d.deidContent || d.rawContent || ""}`).join("\n\n")}
              documentTitle={`Документы случая ${caseData.caseCode}`}
            />
          </div>
        </TabsContent>

        <TabsContent value="control">
          {hasAnalysis ? (
            <ControlPanel caseId={selectedCaseId} analysis={analysis} />
          ) : (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Сначала выполните анализ</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="reports">
          <ReportPanel caseId={selectedCaseId} reports={reports} hasAnalysis={hasAnalysis} />
        </TabsContent>

        {isCaseOwner && (
          <TabsContent value="share">
            <CaseSharePanel caseId={selectedCaseId} />
          </TabsContent>
        )}

        <TabsContent value="consents">
          <ConsentManager
            caseId={selectedCaseId}
            onConsentGranted={(type) => {
              // After granting ai_analysis, switch back to the documents tab
              // so the doctor can immediately proceed with the analysis.
              if (type === "ai_analysis") {
                setActiveTab("documents");
              }
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CaseStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    new: { label: "Новый", color: "bg-muted text-muted-foreground" },
    uploaded: { label: "Загружен", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
    analyzing: { label: "Анализ", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    analyzed: { label: "Готов", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    reported: { label: "Отчёт", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400" },
  };
  const cfg = map[status] ?? map.new;
  return <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>;
}


