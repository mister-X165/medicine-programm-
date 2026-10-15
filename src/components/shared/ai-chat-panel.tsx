"use client";

import * as React from "react";
import {
  MessageCircle,
  Send,
  Loader2,
  Bot,
  User,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Copy,
  Check,
  Clock,
  History,
  Landmark,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** v4.2: КР Минздрава, разобранная ИИ напрямую из репозитория по теме вопроса. */
interface RagClinrecBadge {
  codeVersion: string;
  name: string;
  url: string;
  fragmentsCount: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  /** v4.2: официальные КР Минздрава, на которые опирался ИИ в этом ответе. */
  ragClinrecs?: RagClinrecBadge[];
}

interface StoredConversation {
  messages: ChatMessage[];
  lastUpdated: string;
}

interface Props {
  caseContext?: {
    diagnosisHint?: string;
    analysisSummary?: string;
    therapyRecommendations?: string;
  };
  // NEW v2.2: optional document text passed DIRECTLY to the AI.
  // The backend chunks long documents and feeds each chunk to the model,
  // so the AI can answer questions about the actual document content.
  documentText?: string;
  documentTitle?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUICK_PROMPTS = [
  "Объясните диагноз подробнее",
  "Какие анализы рекомендуете?",
  "Предложите тактику лечения",
  "Какие препараты показаны?",
  "Какие есть противопоказания?",
  "Коррекция дозы для пациента",
];

const SYNC_EVENT = "sppvr-chat-sync";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function getStorageKey(caseId: string | null): string {
  return `sppvr-chat-${caseId || "global"}`;
}

function loadConversation(key: string): StoredConversation | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConversation;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveConversation(key: string, conv: StoredConversation): void {
  try {
    localStorage.setItem(key, JSON.stringify(conv));
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded) — fail silently.
  }
}

function clearConversation(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Russian formatting helpers
// ---------------------------------------------------------------------------

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${pluralRu(min, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${pluralRu(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${pluralRu(days, "день", "дня", "дней")} назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering (no prose plugin — manual Tailwind styling)
// ---------------------------------------------------------------------------

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">{children}</pre>
  ),
  h1: ({ children }) => <h3 className="mb-2 text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-1.5 text-sm font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1 text-sm font-medium">{children}</h5>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-emerald-400 pl-2 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={typeof href === "string" ? href : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-600 underline hover:text-emerald-700"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  hr: () => <hr className="my-2 border-border" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AiChatPanel({ caseContext, documentText, documentTitle }: Props) {
  // caseId is read from the Zustand store so we don't need to change parent
  // components (case-workspace.tsx is owned by another agent). Both the desktop
  // sidebar instance and the mobile stacked instance share the same caseId, so
  // they persist/load the same localStorage key.
  const caseId = useAppStore((s) => s.selectedCaseId);
  const storageKey = getStorageKey(caseId);

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<string | undefined>(undefined);
  const [input, setInput] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Synchronous mirror of `messages` so we can read the latest value inside
  // async callbacks without waiting for React state to flush.
  const messagesRef = React.useRef<ChatMessage[]>([]);

  // ----- Load from localStorage on mount / when caseId changes -------------
  React.useEffect(() => {
    const stored = loadConversation(storageKey);
    if (stored) {
      messagesRef.current = stored.messages;
      setMessages(stored.messages);
      setLastUpdated(stored.lastUpdated);
    } else {
      messagesRef.current = [];
      setMessages([]);
      setLastUpdated(undefined);
    }
    // Reset input state when switching cases.
    setInput("");
  }, [storageKey]);

  // ----- Cross-instance sync ---------------------------------------------
  // Two AiChatPanel instances are mounted simultaneously in case-workspace
  // (desktop sidebar visible on lg+, mobile stacked visible below lg). They
  // share the same caseId. To keep both in sync without lifting state to
  // Zustand, we dispatch a CustomEvent whenever one instance updates and have
  // the other instance mirror the new state.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ caseId: string | null; messages: ChatMessage[]; lastUpdated?: string }>
      ).detail;
      if (!detail || detail.caseId !== caseId) return;
      messagesRef.current = detail.messages;
      setMessages(detail.messages);
      setLastUpdated(detail.lastUpdated);
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [caseId]);

  // ----- Helper: persist + notify ----------------------------------------
  const updateMessages = React.useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      const next = updater(messagesRef.current);
      messagesRef.current = next;
      const ts = new Date().toISOString();
      setMessages(next);
      setLastUpdated(ts);
      saveConversation(storageKey, { messages: next, lastUpdated: ts });
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SYNC_EVENT, {
            detail: { caseId, messages: next, lastUpdated: ts },
          }),
        );
      }
    },
    [storageKey, caseId],
  );

  // ----- Auto-scroll on new message --------------------------------------
  const scrollToBottom = React.useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ----- Send -------------------------------------------------------------
  const handleSend = async (text?: string) => {
    const messageText = (text || input).trim();
    if (!messageText || isSending) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: messageText,
      timestamp: new Date().toISOString(),
    };
    // Snapshot for API: previous messages + new user message.
    const apiMessages = [...messagesRef.current, userMessage];

    updateMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const result = await api.sendChatMessage(apiMessages, caseContext, {
        text: documentText,
        title: documentTitle,
      });
      updateMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message.content,
          timestamp: result.message.timestamp || new Date().toISOString(),
          // v4.2: КР Минздрава, разобранные ИИ по теме вопроса (для бейджей)
          ragClinrecs: result.meta?.ragClinrecs?.filter((c) => c.codeVersion),
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка при отправке сообщения";
      toast.error(msg);
      updateMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Ошибка: ${msg}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
      // Re-focus input after the async operation completes.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ----- Clear ------------------------------------------------------------
  const handleClear = () => {
    clearConversation(storageKey);
    messagesRef.current = [];
    setMessages([]);
    setLastUpdated(undefined);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENT, {
          detail: { caseId, messages: [], lastUpdated: undefined },
        }),
      );
    }
    toast.success("История чата очищена");
  };

  // ----- Copy -------------------------------------------------------------
  const handleCopy = async (content: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      toast.success("Скопировано в буфер обмена");
      setTimeout(() => setCopiedIdx((prev) => (prev === idx ? null : prev)), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  // ----- Collapsed view ---------------------------------------------------
  if (isCollapsed) {
    return (
      <div className="flex h-full flex-col items-center justify-center border-l bg-sidebar/50 p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="gap-1.5 text-xs"
          title="Открыть чат с ИИ"
          aria-label="Открыть чат с ИИ"
        >
          <ChevronLeft className="h-4 w-4" />
          <MessageCircle className="h-4 w-4" />
        </Button>
        <span className="mt-1 text-[10px] text-muted-foreground [writing-mode:vertical-lr]">
          ИИ-чат
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l bg-sidebar/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              ИИ-ассистент
              {messages.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                  {messages.length}
                </Badge>
              )}
            </h3>
            <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5 shrink-0" />
              {lastUpdated
                ? `Последнее: ${formatRelativeTime(lastUpdated)}`
                : "Диалог по диагнозу и терапии"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Очистить историю"
                  aria-label="Очистить историю чата"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Очистить историю чата?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Все сообщения этого диалога будут удалены без возможности восстановления.
                    История хранится только локально в вашем браузере для текущего случая.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClear}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Очистить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsCollapsed(true)}
            title="Свернуть чат"
            aria-label="Свернуть чат"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages / Empty state */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
              <Sparkles className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="mb-1 text-sm font-medium text-foreground">ИИ-ассистент готов помочь</p>
            <p className="mb-4 max-w-[240px] text-xs text-muted-foreground">
              Задайте вопрос по диагнозу, обследованию или терапии. История диалога сохраняется
              локально в браузере для этого случая.
            </p>
            <div className="grid w-full gap-1.5">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  disabled={isSending}
                  className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-emerald-400/40 hover:bg-emerald-50/50 hover:text-foreground disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="mt-4 flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <History className="h-2.5 w-2.5" />
              История сохраняется локально для этого случая
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  "group rounded-lg px-3 py-2.5 text-sm",
                  msg.role === "user"
                    ? "ml-4 border border-primary/20 bg-primary/10"
                    : "mr-2 border border-border/50 bg-background",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    {msg.role === "user" ? (
                      <User className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {msg.role === "user" ? "Врач" : "Ассистент"}
                    </span>
                  </div>
                  {msg.role === "assistant" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                      onClick={() => handleCopy(msg.content, idx)}
                      aria-label="Копировать ответ ИИ"
                      title="Копировать"
                    >
                      {copiedIdx === idx ? (
                        <>
                          <Check className="h-3 w-3" />
                          Скопировано
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Копировать
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {msg.role === "assistant" ? (
                  <div className="text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap leading-relaxed text-foreground/90">
                    {msg.content}
                  </div>
                )}
                {/* v4.2: КР Минздрава, разобранные ИИ напрямую из репозитория по теме вопроса */}
                {msg.role === "assistant" && msg.ragClinrecs && msg.ragClinrecs.length > 0 && (
                  <div className="mt-2 border-t border-border/40 pt-1.5">
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                      <Landmark className="h-3 w-3 text-emerald-600" />
                      ИИ разобрал репозиторий КР Минздрава РФ по теме вопроса:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {msg.ragClinrecs.map((cr) => (
                        <a
                          key={cr.codeVersion}
                          href={cr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${cr.name} — открыть на cr.minzdrav.gov.ru`}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                        >
                          <Landmark className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">КР Минздрава {cr.codeVersion}</span>
                          {cr.fragmentsCount > 0 && (
                            <span className="shrink-0 rounded-full bg-emerald-600/10 px-1 font-semibold">
                              {cr.fragmentsCount} фрагм.
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {msg.timestamp && (
                  <div className="mt-1 text-right text-[10px] text-muted-foreground/60">
                    {formatTime(msg.timestamp)}
                  </div>
                )}
              </div>
            ))}
            {isSending && (
              <div className="mr-2 flex items-center gap-2 rounded-lg border border-border/50 bg-background px-3 py-2.5">
                <Bot className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="flex items-center gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
                </div>
                <span className="text-xs text-muted-foreground">ИИ думает...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick prompts — horizontally scrollable on mobile */}
      {messages.length > 0 && (
        <div className="border-t px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleSend(prompt)}
                disabled={isSending}
                className="shrink-0 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-emerald-400/40 hover:bg-emerald-50/50 hover:text-foreground disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t px-3 py-2">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задайте вопрос..."
            disabled={isSending}
            className="h-9 text-sm"
            aria-label="Введите вопрос к ИИ"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => handleSend()}
            disabled={isSending || !input.trim()}
            aria-label="Отправить сообщение"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1 text-center text-[10px] text-muted-foreground/60">
          Рекомендации ИИ носят вспомогательный характер
        </p>
      </div>
    </div>
  );
}
