"use client";

// СППВР v4.1 — Диалог полного текста клинической рекомендации Минздрава РФ.
// Загружает полный текст КР через api.getClinrecFull(codeVersion) и показывает
// разделы в виде аккордеона (КР может содержать 30+ разделов).
// Используется в браузере КР (вкладка «КР Минздрава» в базе знаний).

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ru as ruDateFns } from "date-fns/locale/ru";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Минимальная карточка КР, достаточная для открытия диалога. */
export interface ClinrecDialogTarget {
  codeVersion: string;
  name: string;
  url?: string;
  pdfUrl?: string;
}

/** Форматирует дату публикации КР (ISO-строка → «2 марта 2026 г.»). */
export function formatClinrecDate(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return format(d, "d MMMM yyyy 'г.'", { locale: ruDateFns });
  } catch {
    return iso.slice(0, 10);
  }
}

export function MinzdravClinrecDialog({
  clinrec,
  open,
  onOpenChange,
}: {
  clinrec: ClinrecDialogTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const codeVersion = clinrec?.codeVersion ?? null;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["minzdrav-clinrec-full", codeVersion],
    queryFn: () => api.getClinrecFull(codeVersion as string),
    enabled: open && Boolean(codeVersion),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Только содержательные разделы (hasContent), по умолчанию раскрыт
  // первый раздел диагностики (id начинается с "doc_diag").
  const sections = React.useMemo(
    () =>
      (data?.sections ?? []).filter(
        (s) => s.hasContent && s.text.trim().length > 0,
      ),
    [data],
  );

  const [openSections, setOpenSections] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!sections.length) {
      setOpenSections([]);
      return;
    }
    const firstDiag = sections.find((s) => s.id.startsWith("doc_diag"));
    setOpenSections([firstDiag ? firstDiag.id : sections[0].id]);
  }, [sections]);

  const full = data?.clinrec;
  const fallbackUrl =
    clinrec?.url ?? `https://cr.minzdrav.gov.ru/view-cr/${codeVersion ?? ""}`;
  const fallbackPdfUrl =
    clinrec?.pdfUrl ??
    (codeVersion
      ? `https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=${codeVersion}`
      : "#");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpenSections([]);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* ── Шапка: название, код, МКБ, НПС, даты ─────────────────────── */}
        <DialogHeader className="shrink-0 space-y-2 border-b px-4 py-4 text-left sm:px-6">
          <DialogTitle className="flex items-start gap-2 pr-8 text-base leading-snug font-semibold sm:text-lg">
            <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              {full?.name ?? clinrec?.name ?? "Клиническая рекомендация"}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Полный текст клинической рекомендации из официального репозитория
            Минздрава России
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-1.5">
            {codeVersion && (
              <Badge variant="secondary" className="font-mono text-xs">
                {codeVersion}
              </Badge>
            )}
            {full?.npcApproved && (
              <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-3 w-3" />
                Одобрена НПС Минздрава
              </Badge>
            )}
            {full?.adult && full?.child ? (
              <Badge variant="outline" className="text-xs">
                Взрослые и дети
              </Badge>
            ) : full?.adult ? (
              <Badge variant="outline" className="text-xs">
                Взрослые
              </Badge>
            ) : full?.child ? (
              <Badge variant="outline" className="text-xs">
                Дети
              </Badge>
            ) : null}
            {formatClinrecDate(full?.publishDate ?? null) && (
              <Badge variant="outline" className="text-xs">
                Опубликовано: {formatClinrecDate(full?.publishDate ?? null)}
              </Badge>
            )}
          </div>
          {full?.mkb && (
            <p className="break-words text-xs leading-relaxed text-muted-foreground">
              МКБ-10:{" "}
              <span className="font-mono font-medium text-foreground">
                {full.mkb}
              </span>
            </p>
          )}
        </DialogHeader>

        {/* ── Внешние ссылки ────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3 sm:px-6">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={fallbackUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть на cr.minzdrav.gov.ru
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={fallbackPdfUrl} target="_blank" rel="noopener noreferrer">
              <FileText className="h-3.5 w-3.5" />
              Скачать PDF
            </a>
          </Button>
          {data?.sectionsCount != null && (
            <span className="ml-auto text-xs text-muted-foreground">
              Разделов с содержимым:{" "}
              <strong className="tabular-nums text-foreground">
                {sections.length}
              </strong>{" "}
              из {data.sectionsCount}
            </span>
          )}
        </div>

        {/* ── Содержимое: аккордеон разделов ───────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {isLoading || isFetching ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <p className="max-w-md text-sm text-muted-foreground">
                Не удалось загрузить полный текст КР:{" "}
                {(error as Error | null)?.message ?? "неизвестная ошибка"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                className="gap-1.5"
              >
                <Loader2 className="h-3.5 w-3.5" />
                Повторить
              </Button>
            </div>
          ) : sections.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Разделы с текстом не найдены — откройте КР на сайте Минздрава
                или скачайте PDF.
              </p>
            </div>
          ) : (
            <Accordion
              type="multiple"
              value={openSections}
              onValueChange={setOpenSections}
              className="w-full"
            >
              {sections.map((s) => {
                const isDiag = s.id.startsWith("doc_diag");
                const isTherapy = s.id.startsWith("doc_therapy");
                return (
                  <AccordionItem key={s.id} value={s.id}>
                    <AccordionTrigger className="py-3 text-sm hover:no-underline">
                      <span className="flex items-center gap-2 text-left">
                        {isDiag && (
                          <Stethoscope className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        {isTherapy && (
                          <FileText className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                        )}
                        <span className="font-medium">{s.title}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap sm:p-4">
                        {s.text}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
