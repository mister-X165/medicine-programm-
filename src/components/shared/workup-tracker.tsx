"use client";

// СППВР — трекер плана дообследования
// ============================================================================
// Задача компонента — превратить «список рекомендованных анализов» в рабочий
// инструмент врача:
//   • статус каждого исследования (в плане → назначено → выполнено →
//     результат) хранится НА СЕРВЕРЕ с автором и временем, а не в localStorage;
//   • под рукой подсказка по интерпретации: норма/пороги, что подтверждает,
//     что исключает, развёрнутое руководство из заключения ИИ;
//   • при вводе результата сразу показывается арифметическое сравнение с
//     референсом («0.12 — выше нормы, норма до 0.04 нг/мл»). Это подсказка,
//     а не заключение: критерий подтверждения/исключения показывается рядом;
//   • фильтры по приоритету и статусу + поиск, чтобы не терять срочное в
//     длинном плане;
//   • копирование плана текстом для вставки в карту/направление.
// ============================================================================

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FlaskConical,
  Info,
  Loader2,
  Search,
  X,
} from "lucide-react";
import type { WorkupItem, WorkupStatus, WorkupTracker, WorkupTrackerEntry } from "@/lib/types";
import {
  WORKUP_STATUSES,
  WORKUP_STATUS_META,
  compareValueToRange,
  planToText,
  sortWorkupByPriority,
  workupKey,
  workupProgress,
  workupStatusMeta,
} from "@/lib/workup";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PRIORITY_META: Record<
  WorkupItem["priority"],
  { label: string; badgeCls: string; borderCls: string }
> = {
  urgent: {
    label: "Срочно",
    badgeCls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    borderCls: "border-l-red-500",
  },
  high: {
    label: "Высокий",
    badgeCls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    borderCls: "border-l-amber-500",
  },
  routine: {
    label: "Плановый",
    badgeCls: "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    borderCls: "border-l-slate-300 dark:border-l-slate-600",
  },
};

type StatusFilter = "all" | "open" | "done" | "result";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "Все" },
  { key: "open", label: "Не закрыто" },
  { key: "done", label: "Выполнено" },
  { key: "result", label: "Есть результат" },
];

export interface WorkupPlanTrackerProps {
  caseId: string;
  items: WorkupItem[];
  tracker?: WorkupTracker;
  caseCode?: string;
  versionLabel?: string;
}

export function WorkupPlanTracker({
  caseId,
  items,
  tracker,
  caseCode,
  versionLabel,
}: WorkupPlanTrackerProps) {
  const qc = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [urgentOnly, setUrgentOnly] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  // Оптимистичные записи: UI реагирует сразу, сервер догоняет.
  const [local, setLocal] = React.useState<WorkupTracker>({});
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});

  // Сбрасываем локальные наложения, когда приходят авторитетные данные.
  React.useEffect(() => {
    setLocal({});
  }, [JSON.stringify(tracker)]);

  const effective: WorkupTracker = React.useMemo(
    () => ({ ...(tracker ?? {}), ...local }),
    [tracker, local],
  );

  const mutation = useMutation({
    mutationFn: (payload: {
      name: string;
      status: WorkupStatus;
      resultValue?: string;
      comment?: string;
    }) => api.setWorkupStatus(caseId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["analysis", caseId] });
    },
    onError: (err: unknown, payload) => {
      const msg = err instanceof Error ? err.message : "не удалось сохранить";
      toast.error(`Статус не сохранён: ${msg}`);
      // Откат оптимистичной записи по этому исследованию.
      const key = workupKey({ name: payload.name, priority: "routine" });
      setLocal((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
  });

  const saveEntry = React.useCallback(
    (
      item: WorkupItem,
      patch: Partial<Pick<WorkupTrackerEntry, "status" | "resultValue" | "comment">>,
    ) => {
      const key = workupKey(item);
      const current = effective[key] ?? { status: "planned" as WorkupStatus };
      const nextEntry: WorkupTrackerEntry = {
        status: patch.status ?? current.status,
        resultValue:
          patch.resultValue !== undefined
            ? patch.resultValue.trim() || undefined
            : current.resultValue,
        comment:
          patch.comment !== undefined ? patch.comment.trim() || undefined : current.comment,
        resultAt: current.resultAt,
        updatedAt: new Date().toISOString(),
      };

      setLocal((prev) => {
        const next = { ...prev };
        if (
          nextEntry.status === "planned" &&
          !nextEntry.resultValue &&
          !nextEntry.comment
        ) {
          delete next[key];
        } else {
          next[key] = nextEntry;
        }
        return next;
      });

      setSaving((prev) => ({ ...prev, [key]: true }));
      mutation.mutate(
        {
          name: item.name,
          status: nextEntry.status,
          resultValue: nextEntry.resultValue,
          comment: nextEntry.comment,
        },
        {
          onSettled: () => setSaving((prev) => ({ ...prev, [key]: false })),
        },
      );
    },
    [effective, mutation],
  );

  const progress = workupProgress(items, effective);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sortWorkupByPriority(items).filter((item) => {
      const entry = effective[workupKey(item)] ?? null;
      const status = (entry?.status ?? "planned") as WorkupStatus;
      const meta = workupStatusMeta(status);

      if (urgentOnly && item.priority !== "urgent") return false;
      if (statusFilter === "open" && (meta.done || status === "cancelled")) return false;
      if (statusFilter === "done" && !meta.done) return false;
      if (statusFilter === "result" && !entry?.resultValue) return false;

      if (!q) return true;
      const hay = [
        item.name,
        item.purpose,
        item.timing,
        item.interpretation,
        ...(item.targetDxConfirm ?? []),
        ...(item.targetDxRefute ?? []),
        item.targetDx,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    return list;
  }, [items, effective, query, statusFilter, urgentOnly]);

  const copyPlan = React.useCallback(async () => {
    const text = planToText(items, effective, {
      caseCode,
      versionLabel,
      includeHints: true,
    });
    if (!text) {
      toast.error("План пуст — нечего копировать");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("План обследования скопирован");
    } catch {
      toast.error("Браузер запретил доступ к буферу обмена");
    }
  }, [items, effective, caseCode, versionLabel]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        План дообследования не сформирован.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Прогресс + экспорт */}
      <div className="rounded-lg border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                Выполнено {progress.done} из {progress.total}
              </span>
              <span className="tabular-nums text-muted-foreground">{progress.pct}%</span>
            </div>
            <Progress
              value={progress.pct}
              className="h-2 [&>div]:bg-emerald-500"
              aria-label={`Выполнение плана обследования: ${progress.pct}%`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className={PRIORITY_META.urgent.badgeCls}>
              срочных: {items.filter((i) => i.priority === "urgent").length}
            </Badge>
            <Badge variant="outline" className={WORKUP_STATUS_META.ordered.badgeCls}>
              назначено: {progress.ordered}
            </Badge>
            <Badge variant="outline" className={WORKUP_STATUS_META.resulted.badgeCls}>
              результаты: {progress.withResult}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={copyPlan}
            >
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              Скопировать план
            </Button>
          </div>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Статусы и результаты сохраняются на сервере от имени врача и попадают в
          журнал аудита. Подсказки по референсам — арифметическая сверка, решение
          о подтверждении диагноза остаётся за врачом.
        </p>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, цели, гипотезе…"
            className="h-8 pl-8 text-xs"
            aria-label="Поиск по плану обследования"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={statusFilter === f.key ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
          <Button
            variant={urgentOnly ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setUrgentOnly((v) => !v)}
            aria-pressed={urgentOnly}
          >
            <AlertCircle className="h-3 w-3" aria-hidden />
            Срочные
          </Button>
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          По выбранным фильтрам ничего нет. Сбросьте фильтры или поиск.
        </p>
      )}

      {/* Пункты плана */}
      <div className="space-y-2">
        {filtered.map((item) => {
          const key = workupKey(item);
          const entry = effective[key] ?? null;
          const status = (entry?.status ?? "planned") as WorkupStatus;
          const statusMeta = workupStatusMeta(status);
          const priority = PRIORITY_META[item.priority ?? "routine"];
          const isOpen = !!expanded[key];
          const isSaving = !!saving[key];
          const comparison = entry?.resultValue
            ? compareValueToRange(entry.resultValue, item.normalRange ?? item.cutoffs)
            : null;

          const hasDetails = !!(
            item.purpose ||
            item.interpretation ||
            item.expectedResult ||
            item.normalRange ||
            item.cutoffs ||
            item.confirmsIf ||
            item.refutesIf ||
            item.preparation ||
            (item.targetDxConfirm && item.targetDxConfirm.length > 0) ||
            (item.targetDxRefute && item.targetDxRefute.length > 0)
          );

          return (
            <div
              key={key}
              className={cn(
                "overflow-hidden rounded-lg border border-l-4 transition-colors",
                priority.borderCls,
                statusMeta.done && "bg-emerald-500/[0.04]",
                status === "cancelled" && "opacity-75",
              )}
            >
              <div className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-start">
                {/* Статус */}
                <div className="flex shrink-0 items-center gap-2 sm:w-[150px]">
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", statusMeta.dotCls)}
                    aria-hidden
                  />
                  <select
                    value={status}
                    onChange={(e) =>
                      saveEntry(item, { status: e.target.value as WorkupStatus })
                    }
                    className={cn(
                      "h-7 w-full cursor-pointer rounded-md border bg-background px-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      statusMeta.badgeCls,
                    )}
                    aria-label={`Статус исследования «${item.name}»`}
                  >
                    {WORKUP_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {WORKUP_STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                  {isSaving && (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                  )}
                </div>

                {/* Название + подсказки */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "text-sm font-medium leading-snug",
                        statusMeta.done && "text-muted-foreground",
                      )}
                    >
                      {item.name}
                    </span>
                    <Badge variant="outline" className={cn("text-[10px]", priority.badgeCls)}>
                      {priority.label}
                    </Badge>
                    {item.timing && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.timing}
                      </Badge>
                    )}
                    {item.targetDxConfirm?.map((dx, i) => (
                      <Badge
                        key={`c-${i}`}
                        variant="outline"
                        className="max-w-[220px] truncate border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                        title={dx}
                      >
                        <Check className="mr-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{dx}</span>
                      </Badge>
                    ))}
                    {item.targetDxRefute?.map((dx, i) => (
                      <Badge
                        key={`r-${i}`}
                        variant="outline"
                        className="max-w-[220px] truncate border-red-500/40 bg-red-500/10 text-[10px] text-red-700 dark:text-red-300"
                        title={dx}
                      >
                        <X className="mr-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{dx}</span>
                      </Badge>
                    ))}
                  </div>

                  {item.purpose && (
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {item.purpose}
                    </p>
                  )}

                  {/* Ключевая подсказка всегда на виду */}
                  {(item.normalRange || item.cutoffs) && (
                    <p className="mt-1 text-[11px] leading-snug">
                      <span className="font-semibold text-muted-foreground">Норма/пороги: </span>
                      <span className="text-foreground">{item.normalRange ?? item.cutoffs}</span>
                    </p>
                  )}

                  {comparison && (
                    <p
                      className={cn(
                        "mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        comparison.verdict === "within" &&
                          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        (comparison.verdict === "above" || comparison.verdict === "below") &&
                          "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
                        comparison.verdict === "unknown" &&
                          "border-slate-500/30 bg-slate-500/10 text-muted-foreground",
                      )}
                    >
                      <FlaskConical className="h-3 w-3" aria-hidden />
                      Результат {entry?.resultValue}: {comparison.label}
                    </p>
                  )}
                </div>

                {/* Раскрыть */}
                {hasDetails && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 self-start px-2 text-[11px] text-primary"
                    onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Скрыть" : "Показать"} подсказки по исследованию «${item.name}»`}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {isOpen ? "Свернуть" : "Подсказки"}
                  </Button>
                )}
              </div>

              {isOpen && (
                <div className="space-y-3 border-t bg-muted/20 p-3">
                  {(item.expectedResult || item.confirmsIf || item.refutesIf || item.preparation) && (
                    <dl className="grid gap-x-4 gap-y-1 text-[11px] leading-snug sm:grid-cols-2">
                      {item.expectedResult && (
                        <div>
                          <dt className="font-semibold text-muted-foreground">Ожидаемый результат</dt>
                          <dd>{item.expectedResult}</dd>
                        </div>
                      )}
                      {item.preparation && (
                        <div>
                          <dt className="font-semibold text-muted-foreground">Подготовка</dt>
                          <dd>{item.preparation}</dd>
                        </div>
                      )}
                      {item.confirmsIf && (
                        <div>
                          <dt className="font-semibold text-emerald-700 dark:text-emerald-300">
                            Подтверждает, если
                          </dt>
                          <dd>{item.confirmsIf}</dd>
                        </div>
                      )}
                      {item.refutesIf && (
                        <div>
                          <dt className="font-semibold text-red-700 dark:text-red-300">
                            Исключает, если
                          </dt>
                          <dd>{item.refutesIf}</dd>
                        </div>
                      )}
                    </dl>
                  )}

                  {item.interpretation && (
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-2">
                      <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <Info className="h-3 w-3" aria-hidden />
                        Как интерпретировать результат
                      </div>
                      <p className="text-[11px] leading-relaxed text-foreground">
                        {item.interpretation}
                      </p>
                    </div>
                  )}

                  {/* Ввод результата и комментария */}
                  <ResultEditor
                    item={item}
                    entry={entry}
                    saving={isSaving}
                    onSave={(resultValue, comment) =>
                      saveEntry(item, {
                        status:
                          resultValue && !workupStatusMeta(status).done ? "resulted" : status,
                        resultValue,
                        comment,
                      })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {progress.done > 0 && progress.done === progress.total && (
        <p className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          Все пункты плана дообследования закрыты — можно переходить к подтверждению диагноза и терапии.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ввод результата: отдельный компонент, чтобы держать текст в локальном стейте
// и не отправлять запрос на каждый символ.
// ---------------------------------------------------------------------------

function ResultEditor({
  item,
  entry,
  saving,
  onSave,
}: {
  item: WorkupItem;
  entry: WorkupTrackerEntry | null;
  saving: boolean;
  onSave: (resultValue: string, comment: string) => void;
}) {
  // DOM id не может содержать пробелы: ключ трекера — нормализованное название
  // с пробелами, поэтому для id используем slug.
  const domId = workupKey(item).replace(/[^a-zа-я0-9-]+/gi, "-");
  const [value, setValue] = React.useState(entry?.resultValue ?? "");
  const [comment, setComment] = React.useState(entry?.comment ?? "");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    setValue(entry?.resultValue ?? "");
    setComment(entry?.comment ?? "");
    setTouched(false);
  }, [entry?.resultValue, entry?.comment]);

  const dirty = touched && (value !== (entry?.resultValue ?? "") || comment !== (entry?.comment ?? ""));

  return (
    <div className="space-y-2 rounded-md border bg-background/60 p-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr]">
        <div className="space-y-1">
          <label
            htmlFor={`result-${domId}`}
            className="text-[11px] font-semibold text-muted-foreground"
          >
            Результат / значение
          </label>
          <Input
            id={`result-${domId}`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            placeholder={item.expectedResult ?? "например, 0.12 нг/мл"}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`comment-${domId}`}
            className="text-[11px] font-semibold text-muted-foreground"
          >
            Комментарий врача
          </label>
          <Textarea
            id={`comment-${domId}`}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setTouched(true);
            }}
            placeholder="Условия выполнения, отклонения, что уточнить"
            className="min-h-[32px] py-1.5 text-xs"
            rows={1}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-[11px]"
          disabled={!dirty || saving}
          onClick={() => onSave(value, comment)}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3 w-3" aria-hidden />
          )}
          Сохранить результат
        </Button>
        {entry?.updatedAt && (
          <span className="text-[10px] text-muted-foreground">
            обновлено {new Date(entry.updatedAt).toLocaleString("ru-RU")}
          </span>
        )}
        {!dirty && !saving && (
          <span className="text-[10px] text-muted-foreground">
            ввод результата переведёт пункт в статус «Результат получен»
          </span>
        )}
      </div>
    </div>
  );
}
