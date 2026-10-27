"use client";

// СППВР v2.2 — Consent Manager (ФЗ-152 ст.9, ст.18)
// ============================================================================
// Full grant/revoke UI for the 5 patient consent types:
//   - data_processing
//   - ai_analysis      (blocks AI analysis if not granted)
//   - genetic_analysis
//   - report_sharing
//   - data_retention
//
// Each consent row exposes:
//   - Russian label + status badge (Дано / Не дано)
//   - "Выдать согласие" button (opens dialog with notes + optional validUntil)
//   - "Отозвать" button (one-tap revoke with confirmation)
//   - Last-updated timestamp + doctor name (resolved from consent.doctor relation
//     or, if missing, from the current session)
//
// Mutations hit the case-scoped endpoints:
//   POST  /api/cases/[id]/consents  — upsert (grant or revoke via granted flag)
//   PATCH /api/cases/[id]/consents  — partial update (revoke / update notes)
//
// We bypass `api.createConsent` / `api.updateConsent` in @/lib/api because those
// point to /api/consents/* routes that don't exist in this codebase. Instead we
// use a small local fetch wrapper that injects the JWT via getAuthToken().

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Loader2,
  Plus,
  X,
  CalendarIcon,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Info,
} from "lucide-react";
import { ru } from "react-day-picker/locale";
import { format, formatISO } from "date-fns";
import { ru as ruDateFns } from "date-fns/locale/ru";

import { useAppStore } from "@/lib/store";
import type { ConsentRecord } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsentType =
  | "data_processing"
  | "ai_analysis"
  | "genetic_analysis"
  | "report_sharing"
  | "data_retention";

// The GET endpoint includes `doctor` via Prisma relation, but ConsentRecord
// in src/lib/types.ts doesn't reflect that. Extend locally so we can render
// the granting doctor's name without an extra API call.
type ConsentWithDoctor = ConsentRecord & {
  doctor?: { id: string; fullName: string; doctorCode?: string };
};

interface ConsentManagerProps {
  caseId: string;
  /**
   * Called whenever any consent is successfully granted (not revoked).
   * Used by case-workspace.tsx to switch back to the documents tab so the
   * doctor can immediately proceed with AI analysis after granting
   * the ai_analysis consent.
   */
  onConsentGranted?: (type: ConsentType) => void;
}

// ---------------------------------------------------------------------------
// Static metadata
// ---------------------------------------------------------------------------

const CONSENT_TYPES: ConsentType[] = [
  "data_processing",
  "ai_analysis",
  "genetic_analysis",
  "report_sharing",
  "data_retention",
];

const CONSENT_LABELS: Record<ConsentType, string> = {
  data_processing: "Обработка данных",
  ai_analysis: "ИИ-анализ",
  genetic_analysis: "Генетический анализ",
  report_sharing: "Обмен отчётами",
  data_retention: "Хранение данных",
};

const CONSENT_DESCRIPTIONS: Record<ConsentType, string> = {
  data_processing:
    "Обработка персональных данных пациента в медицинской информационной системе.",
  ai_analysis:
    "Использование ИИ-моделей для анализа медицинских данных пациента. Без этого согласия запуск ИИ-анализа невозможен (ФЗ-152 ст.9).",
  genetic_analysis:
    "Обработка и интерпретация генетических данных (мутации, полиморфизмы).",
  report_sharing:
    "Передача медицинских отчётов другим врачам консилиума или специалистам.",
  data_retention:
    "Хранение данных пациента после закрытия случая (срок определяется регламентом клиники).",
};

// ---------------------------------------------------------------------------
// Local fetch wrapper — mirrors api.ts fetchJSON but is self-contained so we
// don't have to modify @/lib/api.ts (owned by another agent).
// ---------------------------------------------------------------------------

async function consentFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  // v2.6.2: cookie-only аутентификация (HttpOnly) — заголовки не нужны
  const headers = new Headers(options?.headers || {});
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...options, headers, credentials: "include" });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConsentManager({ caseId, onConsentGranted }: ConsentManagerProps) {
  const qc = useQueryClient();
  const { currentDoctor } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ["consents", caseId],
    queryFn: () =>
      consentFetch<{ consents: ConsentWithDoctor[] }>(
        `/api/cases/${caseId}/consents`,
      ),
  });

  const consents = data?.consents ?? [];

  // -- Grant mutation (POST upsert with granted=true) ----------------------
  const grantMut = useMutation({
    mutationFn: (vars: {
      consentType: ConsentType;
      notes?: string;
      validUntil?: string;
    }) =>
      consentFetch<{ consent: ConsentWithDoctor }>(
        `/api/cases/${caseId}/consents`,
        {
          method: "POST",
          body: JSON.stringify({
            consentType: vars.consentType,
            granted: true,
            notes: vars.notes ?? "",
            validUntil: vars.validUntil ?? undefined,
          }),
        },
      ),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["consents", caseId] });
      toast.success(`Согласие «${CONSENT_LABELS[vars.consentType]}» выдано`, {
        description: "Запись добавлена в журнал аудита (ФЗ-152 ст.18).",
      });
      onConsentGranted?.(vars.consentType);
    },
    onError: (e: Error) => {
      toast.error("Не удалось выдать согласие", { description: e.message });
    },
  });

  // -- Revoke mutation (PATCH with granted=false) --------------------------
  const revokeMut = useMutation({
    mutationFn: (vars: { consentType: ConsentType; notes?: string }) =>
      consentFetch<{ consent: ConsentWithDoctor }>(
        `/api/cases/${caseId}/consents`,
        {
          method: "PATCH",
          body: JSON.stringify({
            consentType: vars.consentType,
            granted: false,
            notes: vars.notes ?? undefined,
          }),
        },
      ),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["consents", caseId] });
      toast.success(`Согласие «${CONSENT_LABELS[vars.consentType]}» отозвано`, {
        description: "Запись об отзыве сохранена в журнале аудита.",
      });
    },
    onError: (e: Error) => {
      toast.error("Не удалось отозвать согласие", { description: e.message });
    },
  });

  // Resolve doctor name from the consent record's relation, falling back to
  // the current session doctor (common case right after grant/revoke), then
  // to the raw doctorId.
  const resolveDoctorName = (c: ConsentWithDoctor): string => {
    if (c.doctor?.fullName) return c.doctor.fullName;
    if (c.doctorId === currentDoctor?.id) return currentDoctor?.fullName ?? "—";
    return c.doctorId;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Согласия пациента
            <Badge
              variant="outline"
              className="ml-auto bg-slate-500/10 text-slate-600 dark:text-slate-300"
            >
              ФЗ-152
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Управление согласиями пациента на обработку персональных данных
            (ФЗ-152 ст.9). Без согласия на ИИ-анализ запуск анализа невозможен.
          </p>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-lg bg-muted"
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CONSENT_TYPES.map((type) => {
                const consent = consents.find((c) => c.consentType === type);
                const granted = !!consent?.granted;
                return (
                  <ConsentCard
                    key={type}
                    type={type}
                    consent={consent}
                    granted={granted}
                    doctorName={consent ? resolveDoctorName(consent) : undefined}
                    onGrant={(notes, validUntil) =>
                      grantMut.mutate({ consentType: type, notes, validUntil })
                    }
                    onRevoke={(notes) =>
                      revokeMut.mutate({ consentType: type, notes })
                    }
                    isGranting={
                      grantMut.isPending &&
                      grantMut.variables?.consentType === type
                    }
                    isRevoking={
                      revokeMut.isPending &&
                      revokeMut.variables?.consentType === type
                    }
                  />
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              При отзыве согласия запись сохраняется в базе (не удаляется) для
              сохранения целостности журнала аудита (ФЗ-152 ст.18 ч.3).
              Отзыв автоматически блокирует соответствующие операции.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single consent card — presentational + interactive
// ---------------------------------------------------------------------------

interface ConsentCardProps {
  type: ConsentType;
  consent?: ConsentWithDoctor;
  granted: boolean;
  doctorName?: string;
  onGrant: (notes: string, validUntil?: string) => void;
  onRevoke: (notes?: string) => void;
  isGranting: boolean;
  isRevoking: boolean;
}

function ConsentCard({
  type,
  consent,
  granted,
  doctorName,
  onGrant,
  onRevoke,
  isGranting,
  isRevoking,
}: ConsentCardProps) {
  // Dialog state for grant flow (notes + optional validUntil)
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [validUntil, setValidUntil] = React.useState<Date | undefined>(undefined);

  // AlertDialog state for revoke flow
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [revokeNotes, setRevokeNotes] = React.useState("");

  const isAiAnalysis = type === "ai_analysis";

  const handleGrantSubmit = () => {
    const validUntilStr = validUntil
      ? formatISO(validUntil, { representation: "complete" })
      : undefined;
    onGrant(notes.trim(), validUntilStr);
    setNotes("");
    setValidUntil(undefined);
    setGrantOpen(false);
  };

  const handleGrantCancel = () => {
    setNotes("");
    setValidUntil(undefined);
    setGrantOpen(false);
  };

  const handleRevokeConfirm = () => {
    onRevoke(revokeNotes.trim() || undefined);
    setRevokeNotes("");
    setRevokeOpen(false);
  };

  const handleRevokeCancel = () => {
    setRevokeNotes("");
    setRevokeOpen(false);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        granted
          ? "border-emerald-500/40 bg-emerald-500/5"
          : isAiAnalysis
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-slate-200 bg-card dark:border-slate-800",
      )}
    >
      {/* Header: label + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{CONSENT_LABELS[type]}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {CONSENT_DESCRIPTIONS[type]}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0",
            granted
              ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 text-amber-700 dark:text-amber-400",
          )}
        >
          {granted ? (
            <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
          ) : (
            <ShieldX className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          {granted ? "Дано" : "Не дано"}
        </Badge>
      </div>

      {/* Last-updated metadata */}
      {consent && (
        <div className="text-xs text-muted-foreground">
          <p>
            Врач: <span className="font-medium text-foreground">{doctorName ?? "—"}</span>
          </p>
          <p>
            Записано:{" "}
            <span className="font-medium text-foreground">
              {formatDateTime(consent.createdAt)}
            </span>
          </p>
          {consent.validUntil && (
            <p>
              Действует до:{" "}
              <span className="font-medium text-foreground">
                {format(new Date(consent.validUntil), "dd.MM.yyyy", {
                  locale: ruDateFns,
                })}
              </span>
            </p>
          )}
          {consent.notes && (
            <p className="mt-1 italic">
              «{consent.notes}»
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-wrap gap-2">
        {granted ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-red-500/30 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-400"
            onClick={() => setRevokeOpen(true)}
            disabled={isRevoking}
            aria-label={`Отозвать согласие «${CONSENT_LABELS[type]}»`}
          >
            {isRevoking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Отозвать
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            className={cn(
              "h-9 gap-1.5",
              isAiAnalysis
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-slate-700 text-white hover:bg-slate-800",
            )}
            onClick={() => setGrantOpen(true)}
            disabled={isGranting}
            aria-label={`Выдать согласие «${CONSENT_LABELS[type]}»`}
          >
            {isGranting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Выдать согласие
          </Button>
        )}
      </div>

      {/* ===== Grant Dialog ===== */}
      <Dialog open={grantOpen} onOpenChange={(o) => (o ? setGrantOpen(true) : handleGrantCancel())}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Выдать согласие
            </DialogTitle>
            <DialogDescription>
              «{CONSENT_LABELS[type]}». Согласие будет зафиксировано в журнале
              аудита с привязкой к вашему профилю врача (ФЗ-152 ст.9, ст.18).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`consent-notes-${type}`}>
                Комментарий (необязательно)
              </Label>
              <Textarea
                id={`consent-notes-${type}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Напр.: Получено письменно от пациента 15.01.2025, подпись на бумажном носителе в карте №…"
                rows={4}
                className="resize-y"
                disabled={isGranting}
              />
              <p className="text-xs text-muted-foreground">
                Укажите способ получения и реквизиты документа, если применимо.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Срок действия (необязательно)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-9 w-full justify-start text-left font-normal"
                    disabled={isGranting}
                    aria-label="Выбрать дату окончания действия согласия"
                  >
                    <CalendarIcon className="h-4 w-4 opacity-60" />
                    {validUntil
                      ? format(validUntil, "dd.MM.yyyy", { locale: ruDateFns })
                      : "Бессрочно (по умолчанию)"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={validUntil}
                    onSelect={setValidUntil}
                    locale={ru}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              {validUntil && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setValidUntil(undefined)}
                  disabled={isGranting}
                >
                  Сбросить срок
                </Button>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleGrantCancel}
              disabled={isGranting}
            >
              Отмена
            </Button>
            <Button
              onClick={handleGrantSubmit}
              disabled={isGranting}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isGranting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Подтвердить согласие
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Revoke AlertDialog ===== */}
      <AlertDialog open={revokeOpen} onOpenChange={(o) => (o ? setRevokeOpen(true) : handleRevokeCancel())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Отозвать согласие?
            </AlertDialogTitle>
            <AlertDialogDescription>
              «{CONSENT_LABELS[type]}»
              {isAiAnalysis && (
                <span className="mt-2 block rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
                  Внимание: после отзыва согласия на ИИ-анализ запуск новых
                  анализов будет заблокирован. Уже выполненные анализы остаются
                  доступны для просмотра.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`revoke-notes-${type}`}>
              Причина отзыва (необязательно)
            </Label>
            <Textarea
              id={`revoke-notes-${type}`}
              value={revokeNotes}
              onChange={(e) => setRevokeNotes(e.target.value)}
              placeholder="Напр.: Пациент отозвал согласие устно на приёме…"
              rows={3}
              className="resize-y"
              disabled={isRevoking}
            />
          </div>

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={isRevoking}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              disabled={isRevoking}
              className="gap-2 bg-red-600 text-white hover:bg-red-700"
            >
              {isRevoking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              Подтвердить отзыв
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
