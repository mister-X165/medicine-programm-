"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  FileDown,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

type AuditLogEntry = {
  id: string;
  action: string;
  details: string;
  createdAt: string;
  case?: { id: string; caseCode: string } | null;
  doctor?: { id: string; fullName: string; doctorCode: string } | null;
};

type AuditLogResponse = { logs: AuditLogEntry[]; total: number };

type DoctorOption = {
  id: string;
  fullName: string;
  specialization: string;
  doctorCode?: string;
};

type VerifyResponse = {
  ok: boolean;
  verified: number;
  brokenAt: { id: string; expectedHash: string; actualHash: string } | null;
  checkedAt: string;
};

type ActionColor = "emerald" | "blue" | "amber" | "purple" | "red" | "slate";

// NOTE: `blue` is retained here ONLY because the existing action-color
// legend (added in v2.0) uses it for `upload`. The primary UI accents
// (buttons, focus rings, integrity badge) use emerald/teal — never indigo
// or blue. The badge classes below are visual tags, not primary actions.
const COLOR_CLASSES: Record<ActionColor, string> = {
  emerald: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  blue: "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
  amber: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  purple: "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300",
  red: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300",
  slate: "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300",
};

function getActionMeta(action: string, locale: "ru" | "en") {
  const meta: Record<string, { icon: React.ElementType; label: string; color: ActionColor }> = {
    create_case: { icon: FileText, label: t("audit.createCase", locale), color: "emerald" },
    upload: { icon: FileText, label: t("audit.upload", locale), color: "blue" },
    analyze: { icon: Cpu, label: t("audit.analyze", locale), color: "amber" },
    generate_report: { icon: FileDown, label: t("audit.generateReport", locale), color: "purple" },
    approve_report: { icon: ShieldCheck, label: t("audit.approveReport", locale), color: "emerald" },
    delete_report: { icon: Trash2, label: t("audit.deleteReport", locale), color: "red" },
    delete_case: { icon: Trash2, label: t("audit.deleteCase", locale), color: "red" },
    update_control: { icon: Sliders, label: t("audit.updateControl", locale), color: "amber" },
  };
  return meta[action] ?? { icon: Activity, label: action, color: "slate" as ActionColor };
}

function getActionFilterOptions(locale: "ru" | "en") {
  return [
    { value: "all", label: t("audit.allActions", locale) },
    { value: "create_case", label: t("audit.createCase", locale) },
    { value: "upload", label: t("audit.upload", locale) },
    { value: "analyze", label: t("audit.analyze", locale) },
    { value: "generate_report", label: t("audit.generateReport", locale) },
    { value: "approve_report", label: t("audit.approveReport", locale) },
    { value: "delete_report", label: t("audit.deleteReport", locale) },
    { value: "update_control", label: t("audit.updateControl", locale) },
    { value: "delete_case", label: t("audit.deleteCase", locale) },
  ];
}

const PAGE_SIZE = 50;

function formatDateTime(iso: string, locale: "ru" | "en"): string {
  try {
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}

function summarizeDetails(action: string, raw: string, locale: "ru" | "en"): string {
  let parsed: Record<string, unknown> = {};
  try { const v = JSON.parse(raw); if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>; else return JSON.stringify(v); } catch { return raw; }
  const pickStr = (...keys: string[]): string | null => { for (const k of keys) { const v = parsed[k]; if (typeof v === "string" && v) return v; if (typeof v === "number" && Number.isFinite(v)) return String(v); } return null; };
  switch (action) {
    case "create_case": return pickStr("caseCode", "caseId") ?? (locale === "ru" ? "Новый случай" : "New case");
    case "upload": { const name = pickStr("fileName", "name"); const type = pickStr("fileType", "type"); return [name, type].filter(Boolean).join(" · ") || (locale === "ru" ? "Документ" : "Document"); }
    case "analyze": { const mode = pickStr("mode"); const mutations = parsed["mutationsCount"] ?? parsed["mutations"]; const mutStr = typeof mutations === "number" ? `${mutations} ${locale === "ru" ? "мут." : "mut."}` : null; return [mode, mutStr].filter(Boolean).join(" · ") || (locale === "ru" ? "Анализ выполнен" : "Analysis completed"); }
    case "generate_report": return pickStr("title", "reportId") ?? (locale === "ru" ? "Отчёт сгенерирован" : "Report generated");
    case "approve_report": return pickStr("newStatus", "to") ?? (locale === "ru" ? "Отчёт утверждён" : "Report approved");
    case "delete_report": return pickStr("reportId", "title") ?? (locale === "ru" ? "Отчёт удалён" : "Report deleted");
    case "delete_case": return pickStr("caseCode", "caseId") ?? (locale === "ru" ? "Случай удалён" : "Case deleted");
    case "update_control": { const weights = parsed["controlWeights"]; if (weights && typeof weights === "object") { const entries = Object.entries(weights as Record<string, unknown>); if (entries.length > 0) return entries.map(([k, v]) => `${k}: ${v}`).slice(0, 3).join(", "); } return pickStr("field", "summary") ?? (locale === "ru" ? "Панель обновлена" : "Panel updated"); }
    default: { const keys = Object.keys(parsed); if (keys.length === 0) return ""; return keys.slice(0, 3).map((k) => `${k}: ${String(parsed[k])}`).join(", "); }
  }
}

// ---------------------------------------------------------------------------
// Hash-chain integrity badge
// ---------------------------------------------------------------------------
type ChainState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; verified: number; checkedAt: string }
  | { status: "broken"; verified: number; brokenAt: VerifyResponse["brokenAt"]; checkedAt: string }
  | { status: "error"; message: string };

function ChainIntegrityBadge({ state, locale }: { state: ChainState; locale: "ru" | "en" }) {
  if (state.status === "checking") {
    return (
      <Badge variant="outline" className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {locale === "ru" ? "Проверка…" : "Verifying…"}
      </Badge>
    );
  }
  if (state.status === "ok") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" aria-live="polite">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {locale === "ru" ? "Цепочка проверена" : "Chain verified"}
            <span className="ml-1 text-[10px] font-normal text-emerald-600/70 dark:text-emerald-400/70">{state.verified}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {locale === "ru" ? "Последняя проверка" : "Last check"}: {formatDateTime(state.checkedAt, locale)}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (state.status === "broken") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1.5 border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" aria-live="assertive">
            <ShieldAlert className="h-3.5 w-3.5" />
            {locale === "ru" ? "Цепочка нарушена" : "Chain broken"}
            <span className="ml-1 text-[10px] font-normal text-red-600/70 dark:text-red-400/70">#{state.verified}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {locale === "ru" ? "Нарушение в записи" : "Broken at record"}: <span className="font-mono">{state.brokenAt?.id ?? "?"}</span>
          <br />
          {formatDateTime(state.checkedAt, locale)}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (state.status === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1.5 border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300">
            <XCircle className="h-3.5 w-3.5" />
            {locale === "ru" ? "Ошибка проверки" : "Verify error"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{state.message}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 border-slate-500/30 bg-slate-500/5 text-slate-600 dark:text-slate-300">
      <ShieldCheck className="h-3.5 w-3.5" />
      {locale === "ru" ? "Не проверено" : "Not verified"}
    </Badge>
  );
}

export function AuditLog() {
  const locale = useAppStore((s) => s.locale);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState<string>("all");
  const [doctorFilter, setDoctorFilter] = React.useState<string>("all");
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [exportFormat, setExportFormat] = React.useState<"csv" | "json">("csv");
  const [page, setPage] = React.useState(0);
  const [chainState, setChainState] = React.useState<ChainState>({ status: "idle" });
  const [isExporting, setIsExporting] = React.useState(false);

  React.useEffect(() => { const id = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(id); }, [search]);
  React.useEffect(() => { setPage(0); }, [debouncedSearch, actionFilter, doctorFilter, dateFrom, dateTo]);

  const offset = page * PAGE_SIZE;

  // ----- Doctors list (for the doctor filter) -----
  const { data: doctorsData } = useQuery({
    queryKey: ["doctors-list"],
    queryFn: () => api.getDoctors(),
    staleTime: 5 * 60 * 1000,
  });
  const doctors: DoctorOption[] = doctorsData?.doctors ?? [];

  // ----- Audit log query -----
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit-logs", debouncedSearch, actionFilter, doctorFilter, dateFrom, dateTo, page],
    queryFn: async (): Promise<AuditLogResponse> => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (doctorFilter !== "all") params.set("doctorId", doctorFilter);
      if (dateFrom) params.set("dateFrom", new Date(dateFrom + "T00:00:00").toISOString());
      if (dateTo) params.set("dateTo", new Date(dateTo + "T00:00:00").toISOString());
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      // v2.6.2: cookie-only аутентификация — Bearer-инъекция удалена
      const res = await fetch(`/api/audit?${params.toString()}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json && typeof json === "object" && "error" in json && String((json as Record<string, unknown>).error)) || `HTTP ${res.status}`);
      return json as AuditLogResponse;
    },
    placeholderData: (prev) => prev,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = page > 0;

  const hasActiveFilters =
    debouncedSearch !== "" ||
    actionFilter !== "all" ||
    doctorFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "";

  const handleReset = () => {
    setSearch("");
    setActionFilter("all");
    setDoctorFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  // ----- Server-side export (CSV/JSON) -----
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { blob, filename } = await api.exportAuditLog({
        format: exportFormat,
        dateFrom: dateFrom ? new Date(dateFrom + "T00:00:00").toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo + "T00:00:00").toISOString() : undefined,
        category: actionFilter !== "all" ? actionFilter : undefined,
        doctorId: doctorFilter !== "all" ? doctorFilter : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(locale === "ru" ? "Журнал аудита экспортирован" : "Audit log exported", { description: filename });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(locale === "ru" ? "Ошибка экспорта" : "Export failed", { description: msg });
    } finally {
      setIsExporting(false);
    }
  };

  // ----- Hash-chain verification -----
  const handleVerify = async () => {
    setChainState({ status: "checking" });
    try {
      const result = await api.verifyAuditChain();
      if (result.ok) {
        setChainState({ status: "ok", verified: result.verified, checkedAt: result.checkedAt });
        toast.success(locale === "ru" ? "Цепочка аудита проверена, нарушений нет" : "Audit chain verified, no issues", {
          description: `${locale === "ru" ? "Проверено записей" : "Records verified"}: ${result.verified}`,
        });
      } else {
        setChainState({
          status: "broken",
          verified: result.verified,
          brokenAt: result.brokenAt,
          checkedAt: result.checkedAt,
        });
        toast.error(locale === "ru" ? "Обнаружено нарушение цепочки аудита" : "Audit chain integrity violation detected", {
          description: result.brokenAt
            ? `${locale === "ru" ? "Запись" : "Record"}: ${result.brokenAt.id}`
            : undefined,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setChainState({ status: "error", message: msg });
      toast.error(locale === "ru" ? "Ошибка проверки цепочки" : "Chain verification error", { description: msg });
    }
  };

  const actionFilterOptions = getActionFilterOptions(locale);

  return (
    <div className="space-y-4">
      {/* Hero header with gradient accent */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 opacity-10">
          <ScrollText className="h-32 w-32 text-primary" />
        </div>
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {locale === "ru" ? "Неизменяемый журнал (WORM)" : "Immutable Log (WORM)"}
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("audit.title", locale)}</h1>
            <p className="text-sm text-muted-foreground">{t("audit.subtitle", locale)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ChainIntegrityBadge state={chainState} locale={locale} />
            <Button
              className="gap-1.5 bg-medical-gradient text-white shadow-lg shadow-emerald-500/20 hover:opacity-90"
              size="sm"
              onClick={handleVerify}
              disabled={chainState.status === "checking"}
              aria-label={locale === "ru" ? "Проверить целостность цепочки аудита" : "Verify audit chain integrity"}
            >
              {chainState.status === "checking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {locale === "ru" ? "Проверить целостность" : "Verify integrity"}
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          {/* Row 1: search (2/3) + action select (1/3) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("audit.search", locale)}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label={t("audit.search", locale)}
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-full" aria-label={t("audit.action", locale)}>
                <Filter className="mr-2 h-4 w-4" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actionFilterOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Row 2: doctor + date from + date to */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select value={doctorFilter} onValueChange={setDoctorFilter}>
              <SelectTrigger className="w-full" aria-label={locale === "ru" ? "Фильтр по врачу" : "Filter by doctor"}>
                <User className="mr-2 h-4 w-4" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === "ru" ? "Все врачи" : "All doctors"}</SelectItem>
                {doctors.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id}>
                    {doc.fullName} <span className="text-muted-foreground">· {doc.doctorCode ?? doc.specialization}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="pl-9"
                aria-label={locale === "ru" ? "Дата начала периода" : "Period start date"}
              />
              <span className="pointer-events-none absolute -top-2 left-9 bg-card px-1 text-[10px] uppercase text-muted-foreground">
                {locale === "ru" ? "С" : "From"}
              </span>
            </div>

            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="pl-9"
                aria-label={locale === "ru" ? "Дата окончания периода" : "Period end date"}
                min={dateFrom || undefined}
              />
              <span className="pointer-events-none absolute -top-2 left-9 bg-card px-1 text-[10px] uppercase text-muted-foreground">
                {locale === "ru" ? "По" : "To"}
              </span>
            </div>
          </div>

          {/* Row 3: found count + reset + export (right-aligned) */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-9 justify-center px-3 text-xs tabular-nums">
                {isFetching && !isLoading ? "…" : `${t("audit.found", locale)}: ${total}`}
              </Badge>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={handleReset}
                  aria-label={locale === "ru" ? "Сбросить фильтры" : "Reset filters"}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {locale === "ru" ? "Сбросить" : "Reset"}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={exportFormat}
                onValueChange={(v) => { if (v) setExportFormat(v as "csv" | "json"); }}
                variant="outline"
                size="sm"
                aria-label={locale === "ru" ? "Формат экспорта" : "Export format"}
              >
                <ToggleGroupItem value="csv" className="px-3 text-xs" aria-label="CSV">CSV</ToggleGroupItem>
                <ToggleGroupItem value="json" className="px-3 text-xs" aria-label="JSON">JSON</ToggleGroupItem>
              </ToggleGroup>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={handleExport}
                disabled={isExporting || total === 0}
                aria-label={locale === "ru" ? `Экспортировать журнал (${exportFormat.toUpperCase()})` : `Export audit log (${exportFormat.toUpperCase()})`}
              >
                {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                {locale === "ru" ? "Экспорт" : "Export"}
              </Button>
            </div>
          </div>

          {/* WORM notice */}
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {locale === "ru"
              ? "Журнал неизменяем (WORM, ФЗ-152 ст. 18 ч. 3). Каждая запись связана с предыдущей через SHA-256 хеш-цепочку."
              : "The log is append-only (WORM, HIPAA §164.312(c)). Each record is chained to the previous one via a SHA-256 hash."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{locale === "ru" ? "Записи журнала" : "Log Records"}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><ScrollText className="h-6 w-6" /></div>
              <div className="text-sm text-muted-foreground">{t("audit.noRecords", locale)}</div>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2 font-medium"><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t("audit.dateTime", locale)}</span></th>
                      <th className="px-2 py-2 font-medium">{t("audit.action", locale)}</th>
                      <th className="px-2 py-2 font-medium">{t("audit.object", locale)}</th>
                      <th className="px-2 py-2 font-medium"><span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{t("audit.doctor", locale)}</span></th>
                      <th className="px-2 py-2 font-medium">{t("audit.details", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const meta = getActionMeta(log.action, locale);
                      const Icon = meta.icon;
                      const summary = summarizeDetails(log.action, log.details, locale);
                      return (
                        <tr key={log.id} className="border-b last:border-0 hover:bg-accent/40">
                          <td className="px-2 py-2 align-top whitespace-nowrap text-xs text-muted-foreground tabular-nums">{formatDateTime(log.createdAt, locale)}</td>
                          <td className="px-2 py-2 align-top"><Badge variant="outline" className={cn("gap-1", COLOR_CLASSES[meta.color])}><Icon className="h-3 w-3" />{meta.label}</Badge></td>
                          <td className="px-2 py-2 align-top">{log.case ? <span className="font-mono text-xs">{log.case.caseCode}</span> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-2 align-top">{log.doctor ? <div className="flex flex-col"><span className="text-xs font-medium">{log.doctor.fullName}</span><span className="font-mono text-[10px] text-muted-foreground">{log.doctor.doctorCode}</span></div> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-2 align-top"><div className="max-w-md truncate font-mono text-xs text-muted-foreground" title={log.details}>{summary}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {logs.map((log) => {
                  const meta = getActionMeta(log.action, locale);
                  const Icon = meta.icon;
                  const summary = summarizeDetails(log.action, log.details, locale);
                  return (
                    <div key={log.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Badge variant="outline" className={cn("gap-1", COLOR_CLASSES[meta.color])}><Icon className="h-3 w-3" />{meta.label}</Badge>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{formatDateTime(log.createdAt, locale)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div><div className="text-[10px] uppercase text-muted-foreground">{t("audit.object", locale)}</div>{log.case ? <span className="font-mono">{log.case.caseCode}</span> : <span className="text-muted-foreground">—</span>}</div>
                        <div><div className="text-[10px] uppercase text-muted-foreground">{t("audit.doctor", locale)}</div>{log.doctor ? <div className="flex flex-col"><span className="font-medium">{log.doctor.fullName}</span><span className="font-mono text-[10px] text-muted-foreground">{log.doctor.doctorCode}</span></div> : <span className="text-muted-foreground">—</span>}</div>
                      </div>
                      <div className="mt-2 truncate font-mono text-xs text-muted-foreground">{summary}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
          <div className="text-xs text-muted-foreground tabular-nums">{t("audit.showing", locale)} {offset + 1}–{Math.min(offset + logs.length, total)} {t("audit.of", locale)} {total}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={!hasPrev || isFetching} aria-label={t("audit.back", locale)}><ChevronLeft className="h-4 w-4" />{t("audit.back", locale)}</Button>
            <span className="text-xs text-muted-foreground tabular-nums">{t("audit.page", locale)} {page + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || isFetching} aria-label={t("audit.forward", locale)}>{t("audit.forward", locale)}<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
