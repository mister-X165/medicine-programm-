"use client";

// СППВР v4.0 — Inline AI Assistant Panel
// =============================================================================
// Встраиваемая панель многомодульного ИИ-ассистента для работы прямо в медкарте.
// Врач работает с медкартой и параллельно консультируется с ИИ:
//   - Быстрый чат (вопросы по текущему пациенту)
//   - Диф. диагноз по симптомам
//   - Интерпретация анализов
//   - Проверка лекарств
//
// Контекст пациента передаётся автоматически (де-идентифицированный).

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Sparkles,
  Send,
  Loader2,
  Brain,
  FlaskConical,
  Pill,
  FileText,
  ChevronRight,
  ChevronLeft,
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  User,
  Landmark,
  ListChecks,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import ReactMarkdown from "react-markdown";

interface InlineAiPanelProps {
  patientId: string;
  patientName: string;
  patientContext?: {
    age?: number;
    sex?: string;
    problems?: string[];
    medications?: string[];
    allergies?: string[];
  };
}

type ModuleType = "chat" | "ddx" | "labs" | "drugs";

/** v4.2: КР Минздрава, разобранная ИИ напрямую из репозитория по теме вопроса. */
interface RagClinrecBadge {
  codeVersion: string;
  name: string;
  url: string;
  fragmentsCount: number;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  ts: string;
  /** v4.2: официальные КР Минздрава, на которые опирался ИИ в этом ответе. */
  ragClinrecs?: RagClinrecBadge[];
}

export function InlineAiPanel({ patientId, patientName, patientContext }: InlineAiPanelProps) {
  const [activeModule, setActiveModule] = React.useState<ModuleType>("chat");
  const [chatMsgs, setChatMsgs] = React.useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = React.useState("");
  const [ddxInput, setDdxInput] = React.useState("");
  const [labInput, setLabInput] = React.useState("");
  const [drugInput, setDrugInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMsgs]);

  // Chat mutation — sends with patient context
  const chatMut = useMutation({
    mutationFn: () => {
      const msgs = chatMsgs.concat(chatInput.trim() ? [{ role: "user" as const, content: chatInput.trim(), ts: new Date().toISOString() }] : []);
      return api.globalChat({
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        patientContext: { patientId },
      });
    },
    onSuccess: (res) => {
      const userMsg: ChatMsg = { role: "user", content: chatInput.trim(), ts: new Date().toISOString() };
      const aiMsg: ChatMsg = {
        role: "assistant",
        content: res.message.content,
        ts: res.message.timestamp,
        // v4.2: КР Минздрава, разобранные ИИ по теме вопроса (для бейджей)
        ragClinrecs: res.meta?.ragClinrecs?.filter((c) => c.codeVersion),
      };
      setChatMsgs((prev) => [...prev, userMsg, aiMsg]);
      setChatInput("");
    },
    onError: (e: Error) => toast.error("Ошибка ИИ", { description: e.message }),
  });

  // DDx mutation
  const ddxMut = useMutation({
    mutationFn: () =>
      api.differentialDiagnosis({
        symptoms: ddxInput.trim(),
        age: patientContext?.age,
        sex: patientContext?.sex,
      }),
    onSuccess: () => toast.success("Диф. диагноз готов"),
    onError: (e: Error) => toast.error("Ошибка анализа", { description: e.message }),
  });

  // Lab interpretation mutation
  const labMut = useMutation({
    mutationFn: () => {
      // Parse lab input: one test per line "Name Value Unit RefLow-RefHigh"
      const tests = labInput
        .trim()
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0] || "—",
            value: parseFloat(parts[1]) || 0,
            unit: parts[2] || "",
            refLow: parts[3] ? parseFloat(parts[3].split("-")[0]) : undefined,
            refHigh: parts[3] ? parseFloat(parts[3].split("-")[1]) : undefined,
          };
        });
      return api.interpretLabs({
        testResults: tests,
        patientAge: patientContext?.age,
        patientSex: patientContext?.sex,
      });
    },
    onSuccess: () => toast.success("Интерпретация готова"),
    onError: (e: Error) => toast.error("Ошибка анализа", { description: e.message }),
  });

  // Drug check mutation
  const drugMut = useMutation({
    mutationFn: () => {
      const meds = drugInput
        .trim()
        .split(/[,\n]/)
        .map((m) => m.trim())
        .filter(Boolean);
      return api.checkDrugs({
        medications: meds,
        patientConditions: patientContext?.problems,
      });
    },
    onSuccess: () => toast.success("Проверка лекарств выполнена"),
    onError: (e: Error) => toast.error("Ошибка проверки", { description: e.message }),
  });

  const handleChatSend = () => {
    if (!chatInput.trim() || chatMut.isPending) return;
    chatMut.mutate();
  };

  const contextSummary = [
    patientContext?.age ? `${patientContext.age} лет` : null,
    patientContext?.sex,
    patientContext?.problems?.length ? `${patientContext.problems.length} диагнозов` : null,
    patientContext?.medications?.length ? `${patientContext.medications.length} препаратов` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border bg-gradient-to-r from-emerald-500/5 to-teal-500/5 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold tracking-tight">ИИ-ассистент</div>
            <div className="text-[10px] text-muted-foreground truncate">
              Контекст: {patientName} {contextSummary && `· ${contextSummary}`}
            </div>
          </div>
        </div>
      </div>

      {/* Module tabs */}
      <Tabs value={activeModule} onValueChange={(v) => setActiveModule(v as ModuleType)} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="h-auto w-full grid grid-cols-4 gap-0.5 rounded-none border-b border-border bg-muted/30 p-1">
          <TabsTrigger value="chat" className="flex-col gap-0.5 py-1.5 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <MessageSquare className="h-3.5 w-3.5" />
            Чат
          </TabsTrigger>
          <TabsTrigger value="ddx" className="flex-col gap-0.5 py-1.5 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Brain className="h-3.5 w-3.5" />
            Диф. Dx
          </TabsTrigger>
          <TabsTrigger value="labs" className="flex-col gap-0.5 py-1.5 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <FlaskConical className="h-3.5 w-3.5" />
            Анализы
          </TabsTrigger>
          <TabsTrigger value="drugs" className="flex-col gap-0.5 py-1.5 text-[10px] data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Pill className="h-3.5 w-3.5" />
            Лекарства
          </TabsTrigger>
        </TabsList>

        {/* Chat module */}
        <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden m-0 mt-0">
          <ScrollArea className="flex-1" ref={scrollRef as never}>
            <div className="min-h-full p-3 space-y-3">
              {chatMsgs.length === 0 && !chatMut.isPending ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <Stethoscope className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground max-w-[200px]">
                    Задайте вопрос по пациенту. Контекст передаётся автоматически.
                  </p>
                </div>
              ) : (
                chatMsgs.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("flex gap-2", msg.role === "user" && "flex-row-reverse")}
                  >
                    <div className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-emerald-500/10 text-emerald-600",
                    )}>
                      {msg.role === "user" ? <User className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    </div>
                    <div className={cn(
                      "max-w-[80%] rounded-lg border px-2.5 py-1.5 text-xs",
                      msg.role === "user" ? "border-primary/20 bg-primary/5" : "border-border bg-card",
                    )}>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-xs max-w-none dark:prose-invert prose-p:my-1 prose-li:my-0 prose-headings:text-xs prose-headings:mb-1">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      )}
                      {/* v4.2: КР Минздрава, разобранные ИИ по теме вопроса */}
                      {msg.role === "assistant" && msg.ragClinrecs && msg.ragClinrecs.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border/50 pt-1.5">
                          {msg.ragClinrecs.map((cr) => (
                            <a
                              key={cr.codeVersion}
                              href={cr.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`${cr.name} — открыть на cr.minzdrav.gov.ru`}
                              className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                            >
                              <Landmark className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">КР Минздрава {cr.codeVersion}</span>
                              {cr.fragmentsCount > 0 && (
                                <span className="shrink-0 rounded-full bg-emerald-600/10 px-1 font-semibold">{cr.fragmentsCount} фрагм.</span>
                              )}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
              {chatMut.isPending && (
                <div className="flex gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10">
                    <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
                    ИИ анализирует…
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="border-t border-border p-2">
            <div className="flex items-end gap-1.5">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSend();
                  }
                }}
                placeholder="Вопрос по пациенту…"
                className="min-h-[36px] flex-1 resize-none text-xs"
                maxLength={2000}
              />
              <Button size="icon" className="h-8 w-8 shrink-0 bg-gradient-to-br from-emerald-500 to-teal-600" onClick={handleChatSend} disabled={!chatInput.trim() || chatMut.isPending}>
                {chatMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* DDx module */}
        <TabsContent value="ddx" className="flex-1 flex flex-col overflow-hidden m-0 mt-0">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Симптомы</label>
                <Textarea
                  value={ddxInput}
                  onChange={(e) => setDdxInput(e.target.value)}
                  placeholder="Опишите симптомы пациента…"
                  className="mt-1 min-h-[80px] text-xs"
                />
              </div>
              <Button
                size="sm"
                className="w-full gap-2 bg-gradient-to-br from-emerald-500 to-teal-600"
                onClick={() => ddxMut.mutate()}
                disabled={!ddxInput.trim() || ddxMut.isPending}
              >
                {ddxMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                Анализировать
              </Button>
              {ddxMut.data?.diagnoses && (
                <div className="space-y-2">
                  {ddxMut.data.clinrecSummary && ddxMut.data.clinrecSummary.matched > 0 && (
                    <div className="flex items-center gap-1.5 rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-1.5 text-[10px] font-medium text-teal-700 dark:text-teal-400">
                      <Landmark className="h-3 w-3 shrink-0" />
                      {ddxMut.data.clinrecSummary.matched} из {ddxMut.data.clinrecSummary.total} диагнозов подтверждены официальными КР Минздрава РФ
                    </div>
                  )}
                  {ddxMut.data.diagnoses.map((d, i) => (
                    <div key={i} className="rounded-md border border-border bg-muted/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{i + 1}. {d.diagnosis}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{Math.round(d.probability * 100)}%</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {d.icd10 && <span className="text-[10px] text-muted-foreground">МКБ-10: {d.icd10}</span>}
                        {d.clinrec && (
                          <a
                            href={d.clinrec.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 rounded border border-teal-500/40 bg-teal-500/10 px-1.5 py-0.5 text-[9px] font-medium text-teal-700 transition-colors hover:bg-teal-500/20 dark:text-teal-400"
                            title={`КР Минздрава РФ: ${d.clinrec.name}${d.clinrec.npcApproved ? " (одобрена НПС)" : ""}`}
                          >
                            <Landmark className="h-2.5 w-2.5" />
                            КР Минздрава {d.clinrec.codeVersion}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{d.rationale}</p>
                      {d.redFlags && (
                        <div className="mt-1 flex items-start gap-1 rounded bg-amber-500/10 px-1.5 py-1 text-[10px] text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span><strong>Red flags:</strong> {d.redFlags}</span>
                        </div>
                      )}
                      {d.workup && d.workup.length > 0 && (
                        <div className="mt-1 flex items-start gap-1 text-[10px] text-muted-foreground">
                          <ListChecks className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                          <span><strong>Обследование:</strong> {d.workup.join("; ")}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Labs module */}
        <TabsContent value="labs" className="flex-1 flex flex-col overflow-hidden m-0 mt-0">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Анализы (по строкам: Название Значение Ед Норма)</label>
                <Textarea
                  value={labInput}
                  onChange={(e) => setLabInput(e.target.value)}
                  placeholder={"Гемоглобин 125 г/л 130-160\nГлюкоза 8.5 ммоль/л 3.9-6.1"}
                  className="mt-1 min-h-[80px] font-mono text-xs"
                />
              </div>
              <Button
                size="sm"
                className="w-full gap-2 bg-gradient-to-br from-emerald-500 to-teal-600"
                onClick={() => labMut.mutate()}
                disabled={!labInput.trim() || labMut.isPending}
              >
                {labMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                Интерпретировать
              </Button>
              {labMut.data && (
                <div className="space-y-2">
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-xs">{labMut.data.summary}</p>
                  </div>
                  {labMut.data.abnormalities.length > 0 && (
                    <div className="space-y-1">
                      {labMut.data.abnormalities.map((a, i) => (
                        <div key={i} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium">{a.test}</span>
                            <Badge variant="outline" className="text-[9px] text-amber-600">{a.severity}</Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{a.interpretation}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Drugs module */}
        <TabsContent value="drugs" className="flex-1 flex flex-col overflow-hidden m-0 mt-0">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Препараты (через запятую или по строкам)</label>
                <Textarea
                  value={drugInput}
                  onChange={(e) => setDrugInput(e.target.value)}
                  placeholder="Метформин, Аспирин, Аторвастатин"
                  className="mt-1 min-h-[60px] text-xs"
                />
              </div>
              <Button
                size="sm"
                className="w-full gap-2 bg-gradient-to-br from-emerald-500 to-teal-600"
                onClick={() => drugMut.mutate()}
                disabled={!drugInput.trim() || drugMut.isPending}
              >
                {drugMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pill className="h-3.5 w-3.5" />}
                Проверить
              </Button>
              {drugMut.data && (
                <div className="space-y-2">
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-xs">{drugMut.data.summary}</p>
                  </div>
                  {drugMut.data.interactions.length > 0 && (
                    <div className="space-y-1">
                      {drugMut.data.interactions.map((it, i) => (
                        <div key={i} className={cn(
                          "rounded-md border p-1.5",
                          it.severity === "severe" || it.severity === "contraindicated"
                            ? "border-rose-500/20 bg-rose-500/5"
                            : "border-amber-500/20 bg-amber-500/5",
                        )}>
                          <div className="flex items-center gap-1">
                            {it.severity === "severe" || it.severity === "contraindicated" ? (
                              <AlertTriangle className="h-3 w-3 text-rose-600" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-600" />
                            )}
                            <span className="text-[11px] font-medium">{it.drugA} + {it.drugB}</span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{it.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {drugMut.data.interactions.length === 0 && (
                    <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-xs text-emerald-700">Взаимодействий не выявлено</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Inline icon for chat tab
function MessageSquare({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
