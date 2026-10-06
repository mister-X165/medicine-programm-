"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  Area, AreaChart, ReferenceLine, Legend,
} from "recharts";
import {
  UserRound, Plus, Search, Filter, ArrowUpDown, ChevronLeft, ChevronRight,
  Calendar, Phone, Mail, MapPin, Heart, Activity, Pill, FlaskConical,
  Syringe, Stethoscope, ClipboardList, AlertTriangle, ShieldAlert, CheckCircle2,
  TrendingUp, TrendingDown, FileText, User, Cpu, Clock, Trash2, Loader2,
  Droplet, Thermometer, Weight, Ruler, Wind, Brain, Cigarette, Wine,
  IdCard, Briefcase, Award, HeartPulse, Printer, Sparkles, X, type LucideIcon,
  Microscope, Scan, Camera, Users, CircleDot, Landmark, MoreHorizontal, Ban,
  LayoutGrid, List, CalendarClock, Lock, ShieldCheck, FileLock2, Upload, Share2, Globe,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useE2EESession } from "@/lib/e2ee/session";
import { PatientExportDialog, PatientImportDialog } from "@/components/e2ee/patient-export-dialog";
import { PatientShareDialog } from "@/components/e2ee/patient-share-dialog";
import { calcAgeFromBirthDate } from "@/lib/e2ee/transform";
import { InlineAiPanel } from "@/components/shared/inline-ai-panel";
import { PatientAnalysisTab } from "@/components/shared/patient-analysis-tab";
import { DdiStreamDialog } from "@/components/shared/ddi-stream-checker";
import type {
  PatientSummary, PatientDetail, VitalSign, LabResult,
  Examination, ExaminationResultParam, ExaminationStats, ClinrecMatch,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============================================================================
// Status helpers
// ============================================================================
const PATIENT_STATUS: Record<string, { label: string; color: string; dot: string }> = {
  active: { label: "Активен", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", dot: "bg-emerald-500" },
  archived: { label: "Архив", color: "bg-muted text-muted-foreground border-muted-foreground/20", dot: "bg-muted-foreground" },
  deceased: { label: "Умер", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30", dot: "bg-rose-500" },
};

const LAB_FLAG: Record<string, { label: string; color: string }> = {
  normal: { label: "Норма", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  low: { label: "↓ Снижен", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  high: { label: "↑ Повышен", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  critical: { label: "⚠ Критич.", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  abnormal: { label: "Отклонение", color: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
};

const MED_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Активен", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  completed: { label: "Завершён", color: "bg-muted text-muted-foreground" },
  discontinued: { label: "Отменён", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  on_hold: { label: "Приостановлен", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

const PROBLEM_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Активна", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  resolved: { label: "Разрешена", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  chronic: { label: "Хроническая", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  controlled: { label: "Контролируется", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  uncontrolled: { label: "Неконтролируемая", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};

const SEVERITY: Record<string, string> = {
  mild: "Лёгкая", moderate: "Средняя", severe: "Тяжёлая", critical: "Критическая",
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("ru-RU"); } catch { return "—"; }
}
function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
}

// ============================================================================
// Main MedicalRecord component
// ============================================================================
export function MedicalRecord() {
  const { selectedPatientId, selectPatient } = useAppStore();

  if (selectedPatientId) {
    return <PatientDetailWorkspace patientId={selectedPatientId} onBack={() => selectPatient(null)} />;
  }
  return <PatientListPanel />;
}

// ----------------------------------------------------------------------------
// E2EE v2.6 — хелперы отображения защищённых полей
// ----------------------------------------------------------------------------

function SecureLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <Lock className="h-3 w-3 text-emerald-600" aria-label="Поле шифруется до отправки" />
      {children}
    </span>
  );
}

function ForeignField({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs italic text-muted-foreground" title="Зашифровано ключом другого врача — нет ключа расшифровки">
      <Lock className="h-3 w-3" /> {label || "🔒 Зашифровано"}
    </span>
  );
}

// ============================================================================
// Patient List
// ============================================================================
type SortKey = "updated" | "created" | "token" | "status" | "name";

function PatientListPanel() {
  const { selectPatient, currentDoctor } = useAppStore();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState<SortKey>("updated");
  const [quickFilter, setQuickFilter] = React.useState<"all" | "allergies" | "chronic" | "recent">("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const e2eeStatus = useE2EESession((s) => s.status);
  const e2eeUnlocked = e2eeStatus === "unlocked";

  // E2EE v2.6: поиск по ФИО/СНИЛС выполняется НА КЛИЕНТЕ — сервер видит
  // только шифротекст. Загружаем полный список (в сфере врача) и фильтруем
  // локально ПОСЛЕ расшифрования (расшифрование — в api.getPatients).
  const { data, isLoading } = useQuery({
    queryKey: ["patients", statusFilter, e2eeStatus],
    queryFn: () => api.getPatients({ status: statusFilter }),
  });

  // v2.5.10: Fetch batch health scores for all patients
  const { data: scoresData } = useQuery({
    queryKey: ["health-scores-batch"],
    queryFn: () => api.getHealthScoresBatch(),
    staleTime: 60000,
  });

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createPatient(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      setCreateOpen(false);
      toast.success(`Пациент ${res.patient.patientToken} создан`);
      selectPatient(res.patient.id);
    },
    onError: (e: Error) => toast.error("Ошибка создания: " + e.message),
  });

  const allPatients = data?.patients ?? [];

  // E2EE v2.6: клиентский поиск по расшифрованным полям
  const searchedPatients = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allPatients;
    return allPatients.filter((p) => {
      const fullName = [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ").toLowerCase();
      return (
        fullName.includes(q) ||
        p.patientToken.toLowerCase().includes(q) ||
        (p.snils || "").toLowerCase().includes(q) ||
        (p.omiPolicy || "").toLowerCase().includes(q) ||
        (p.phone || "").toLowerCase().includes(q)
      );
    });
  }, [allPatients, search]);

  // Apply quick filter (client-side)
  const filteredPatients = React.useMemo(() => {
    if (quickFilter === "all") return searchedPatients;
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return searchedPatients.filter((p) => {
      if (quickFilter === "allergies") return (p.allergies?.length ?? 0) > 0;
      if (quickFilter === "chronic") return (p.chronicDiseases?.length ?? 0) > 0;
      if (quickFilter === "recent") return new Date(p.updatedAt).getTime() > weekAgo;
      return true;
    });
  }, [searchedPatients, quickFilter]);

  const patients = React.useMemo(() => {
    let result = filteredPatients;
    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "created": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "token": return a.patientToken.localeCompare(b.patientToken, "ru");
        case "status": return a.status.localeCompare(b.status);
        case "name": return (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName, "ru");
        case "updated": default: return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [filteredPatients, sortBy]);

  const stats = React.useMemo(() => {
    const total = allPatients.length;
    const active = allPatients.filter((p) => p.status === "active").length;
    const chronic = allPatients.filter((p) => p.chronicDiseases?.length > 0).length;
    const allergies = allPatients.filter((p) => p.allergies?.length > 0).length;
    return { total, active, chronic, allergies };
  }, [allPatients]);

  const quickFilters = [
    { id: "all" as const, label: "Все", count: stats.total, icon: UserRound, color: "emerald" },
    { id: "allergies" as const, label: "Аллергии", count: stats.allergies, icon: ShieldAlert, color: "rose" },
    { id: "chronic" as const, label: "Хронические", count: stats.chronic, icon: Activity, color: "amber" },
    { id: "recent" as const, label: "За неделю", count: allPatients.filter((p) => Date.now() - new Date(p.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000).length, icon: Clock, color: "sky" },
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 p-6">
        <div className="absolute right-0 top-0 h-40 w-40 -translate-y-12 translate-x-12 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
              <UserRound className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Медицинская карта</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Полноценная ЭМК пациента: визиты, витальные показатели, медикаменты, лабораторные данные
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setImportOpen(true)}
              disabled={!e2eeUnlocked}
              title={e2eeUnlocked ? "Импорт карты из контейнера CryptoVault (.cvlt)" : "Разблокируйте хранилище шифрования"}
              variant="outline"
              className="gap-2 border-emerald-600/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
            >
              <Upload className="h-4 w-4" /> Импорт .cvlt
            </Button>
            <Button 
              onClick={() => setCreateOpen(true)} 
              disabled={!e2eeUnlocked}
              title={e2eeUnlocked ? undefined : "Создание пациентов доступно только при разблокированном хранилище шифрования"}
              className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
            >
              <Plus className="h-4 w-4" /> Новый пациент
            </Button>
          </div>
        </div>
      </div>

      {/* E2EE v2.6 — баннер состояния шифрования */}
      <Card className={cn(
        "border-l-4",
        e2eeUnlocked
          ? "border-l-emerald-500 bg-emerald-500/5"
          : "border-l-amber-500 bg-amber-500/5",
      )}>
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={cn(
              "relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              e2eeUnlocked ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600",
            )}>
              {e2eeUnlocked && (
                <span className="absolute inset-0 animate-ping rounded-lg bg-emerald-500/10 [animation-duration:2.5s]" />
              )}
              {e2eeUnlocked ? <ShieldCheck className="relative h-4 w-4" /> : <Lock className="relative h-4 w-4" />}
            </div>
            <div>
              <p className="text-sm font-medium">
                {e2eeUnlocked
                  ? "Сквозное шифрование данных пациентов (E2EE)"
                  : "Хранилище шифрования заблокировано"}
              </p>
              <p className="text-xs text-muted-foreground">
                {e2eeUnlocked
                  ? "Прямые идентификаторы (ФИО, СНИЛС, ОМС, контакты) шифруются в браузере каскадом AES-256-GCM-SIV + ChaCha20-Poly1305 до отправки на сервер. Сервер хранит только шифротекст."
                  : "Введите пароль в диалоге разблокировки, чтобы расшифровать данные и вводить новые записи. Ввод заблокирован — открытые идентификаторы никогда не отправляются на сервер."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {["Argon2id 64 MiB", "AES-256-GCM-SIV", "ChaCha20-Poly1305", "BLAKE3-256"].map((algo) => (
              <span
                key={algo}
                className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
              >
                <Lock className="h-2.5 w-2.5" />
                {algo}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={UserRound} label="Всего пациентов" value={stats.total} color="from-emerald-500 to-teal-600" />
        <StatCard icon={HeartPulse} label="Активные" value={stats.active} color="from-sky-500 to-cyan-600" />
        <StatCard icon={Activity} label="Хронические" value={stats.chronic} color="from-amber-500 to-orange-600" />
        <StatCard icon={ShieldAlert} label="Аллергии" value={stats.allergies} color="from-rose-500 to-pink-600" />
      </div>

      {/* Quick filter chips */}
      <div className="flex flex-wrap gap-2">
        {quickFilters.map((qf) => {
          const Icon = qf.icon;
          const active = quickFilter === qf.id;
          const colorMap: Record<string, string> = {
            emerald: active ? "bg-emerald-600 text-white border-emerald-600" : "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10",
            rose: active ? "bg-rose-600 text-white border-rose-600" : "border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10",
            amber: active ? "bg-amber-600 text-white border-amber-600" : "border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10",
            sky: active ? "bg-sky-600 text-white border-sky-600" : "border-sky-500/30 text-sky-700 dark:text-sky-300 hover:bg-sky-500/10",
          };
          return (
            <button
              key={qf.id}
              onClick={() => setQuickFilter(qf.id)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all", colorMap[qf.color])}
            >
              <Icon className="h-3.5 w-3.5" />
              {qf.label}
              <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums", active ? "bg-white/20" : "bg-muted")}>
                {qf.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени, токену, СНИЛС…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="archived">Архивные</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="w-full md:w-48">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">По обновлению</SelectItem>
                <SelectItem value="created">По созданию</SelectItem>
                <SelectItem value="token">По токену</SelectItem>
                <SelectItem value="name">По ФИО</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Patient list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 text-emerald-600" />
            Реестр пациентов ({patients.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : patients.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <UserRound className="mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">Пациенты не найдены</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Создайте нового пациента или измените параметры поиска</p>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
              {patients.map((p) => (
                <PatientRow key={p.id} patient={p} score={scoresData?.scores?.[p.id]} onOpen={() => selectPatient(p.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreatePatientDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={(d) => createMut.mutate(d)} loading={createMut.isPending} doctorName={currentDoctor?.fullName} />
      <PatientImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: number; color: string }) {
  return (
    <Card className="overflow-hidden border-none shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow", color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-tight">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function PatientRow({ patient, score, onOpen }: { patient: PatientSummary; score?: { score: number; riskLevel: string; riskLabel: string }; onOpen: () => void }) {
  const status = PATIENT_STATUS[patient.status] ?? PATIENT_STATUS.active;
  const foreign = (patient as PatientSummary & { foreignEncrypted?: boolean }).foreignEncrypted;
  const fullName = foreign
    ? "🔒 Зашифровано (нет ключа)"
    : [patient.lastName, patient.firstName, patient.middleName].filter(Boolean).join(" ") || patient.patientToken;
  const allergies = patient.allergies?.length || 0;
  const chronic = patient.chronicDiseases?.length || 0;
  const initials = foreign
    ? "🔒"
    : (patient.lastName?.[0] || "") + (patient.firstName?.[0] || "") || patient.patientToken.slice(0, 2);
  // E2EE v2.6: точный возраст — из расшифрованной полной даты рождения
  const age = calcAgeFromBirthDate(patient.birthDate) ?? patient.age;

  // v2.5.10: Health score badge colors
  const SCORE_BADGE: Record<string, string> = {
    low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    moderate: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    high: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
    critical: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  };
  const SCORE_DOT: Record<string, string> = {
    low: "bg-emerald-500", moderate: "bg-amber-500", high: "bg-orange-500", critical: "bg-rose-500",
  };

  // Format relative time
  const updatedDate = new Date(patient.updatedAt);
  const diffMs = Date.now() - updatedDate.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const relTime = diffMin < 1 ? "только что" : diffMin < 60 ? `${diffMin} мин` : diffHr < 24 ? `${diffHr} ч` : diffDay < 7 ? `${diffDay} дн` : updatedDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

  return (
    <button
      onClick={onOpen}
      className={cn(
        "group relative flex w-full items-center gap-4 border-b p-4 text-left transition-all duration-200 last:border-b-0",
        "hover:bg-muted/60 hover:pl-5 hover:shadow-[inset_3px_0_0_0_theme(colors.emerald.500)]",
        foreign && "opacity-75",
      )}
    >
      {/* Индикатор шифрования записи (E2EE) */}
      {!foreign && (
        <span
          title="Запись зашифрована каскадом AES-256-GCM-SIV + ChaCha20-Poly1305 (E2EE)"
          className="absolute right-3 top-3 hidden h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)] sm:block"
        />
      )}
      <div className="relative shrink-0">
        <div className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm transition-transform duration-200 group-hover:scale-105",
          foreign
            ? "bg-gradient-to-br from-slate-400 to-slate-500"
            : "bg-gradient-to-br from-emerald-500 to-teal-600",
        )}>
          {initials === "🔒" ? initials : initials.toUpperCase()}
        </div>
        {score && (
          <div className={cn("absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-background text-[10px] font-bold tabular-nums", SCORE_BADGE[score.riskLevel] || SCORE_BADGE.moderate)}>
            {score.score}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{fullName}</span>
          <Badge variant="outline" className={cn("border text-[10px]", status.color)}>
            <span className={cn("mr-1 h-1.5 w-1.5 rounded-full", status.dot)} /> {status.label}
          </Badge>
          {patient.accessRole === "granted" && (
            <Badge
              variant="outline"
              title={patient.myGrant ? `Передал: ${patient.myGrant.grantorName} (${patient.myGrant.grantorCode}) · ${new Date(patient.myGrant.grantedAt).toLocaleString("ru-RU")}` : "Карта передана вам другим врачом"}
              className="gap-1 border-teal-500/40 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-300"
            >
              <Share2 className="h-3 w-3" /> доступ от {patient.myGrant?.grantorCode ?? "врача"}
            </Badge>
          )}
          {patient.accessRole === "owner" && (patient._count?.accessGrants ?? 0) > 0 && (
            <Badge
              variant="outline"
              title="Карта передана другим врачам (X25519 key-wrapping)"
              className="gap-1 border-violet-500/40 bg-violet-500/10 text-[10px] text-violet-700 dark:text-violet-300"
            >
              <Users className="h-3 w-3" /> передана · {patient._count?.accessGrants}
            </Badge>
          )}
          {score && (
            <Badge variant="outline" className={cn("hidden text-[9px] sm:inline-flex", SCORE_BADGE[score.riskLevel] || SCORE_BADGE.moderate)}>
              <span className={cn("mr-1 h-1.5 w-1.5 rounded-full", SCORE_DOT[score.riskLevel] || SCORE_DOT.moderate)} />
              {score.riskLabel}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{patient.patientToken}</span>
          {age != null && <span>{age} лет</span>}
          {patient.sex && <span>{patient.sex === "М" ? "♂ Муж" : "♀ Жен"}</span>}
          {patient.bloodType && <span className="font-semibold text-rose-600">{patient.bloodType}</span>}
          {chronic > 0 && <span className="text-amber-600">⚠ {chronic} хрон.</span>}
          {allergies > 0 && <span className="text-rose-600">⚠ {allergies} аллерг.</span>}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <Badge variant="outline" className="text-[10px]">{patient._count?.visits ?? 0} визитов</Badge>
        <Badge variant="outline" className="text-[10px]">{patient._count?.cases ?? 0} кейсов</Badge>
        <Badge variant="outline" className="text-[10px]">{patient._count?.medications ?? 0} препар.</Badge>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" /> {relTime}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

// ============================================================================
// Create patient dialog
// ============================================================================
function CreatePatientDialog({
  open, onOpenChange, onSubmit, loading, doctorName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (d: Record<string, unknown>) => void;
  loading: boolean;
  doctorName?: string;
}) {
  const [lastName, setLastName] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [middleName, setMiddleName] = React.useState("");
  const [sex, setSex] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [bloodType, setBloodType] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [snils, setSnils] = React.useState("");
  const [omiPolicy, setOmiPolicy] = React.useState("");
  const [occupation, setOccupation] = React.useState("");
  const [smokingStatus, setSmokingStatus] = React.useState("unknown");
  const [alcoholUse, setAlcoholUse] = React.useState("unknown");
  const [height, setHeight] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const submit = () => {
    onSubmit({
      lastName, firstName, middleName, sex, birthDate: birthDate || undefined,
      bloodType, phone, email, snils, omiPolicy, occupation, smokingStatus, alcoholUse,
      height: height || 0, weight: weight || 0, notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-emerald-600" /> Новый пациент
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Lock className="h-3 w-3" />
            Идентификаторы (ФИО, СНИЛС, ОМС, контакты) шифруются в этом браузере до отправки на сервер
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div>
            <Label><SecureLabel>Фамилия</SecureLabel></Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Иванов" />
          </div>
          <div>
            <Label><SecureLabel>Имя</SecureLabel></Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Иван" />
          </div>
          <div>
            <Label><SecureLabel>Отчество</SecureLabel></Label>
            <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Иванович" />
          </div>
          <div>
            <Label><SecureLabel>Дата рождения</SecureLabel></Label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div>
            <Label>Пол</Label>
            <Select value={sex} onValueChange={setSex}>
              <SelectTrigger><SelectValue placeholder="Выберите пол" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="М">Мужской</SelectItem>
                <SelectItem value="Ж">Женский</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Группа крови</Label>
            <Select value={bloodType} onValueChange={setBloodType}>
              <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="O(I)+">O(I) Rh+</SelectItem>
                <SelectItem value="O(I)-">O(I) Rh−</SelectItem>
                <SelectItem value="A(II)+">A(II) Rh+</SelectItem>
                <SelectItem value="A(II)-">A(II) Rh−</SelectItem>
                <SelectItem value="B(III)+">B(III) Rh+</SelectItem>
                <SelectItem value="B(III)-">B(III) Rh−</SelectItem>
                <SelectItem value="AB(IV)+">AB(IV) Rh+</SelectItem>
                <SelectItem value="AB(IV)-">AB(IV) Rh−</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label><SecureLabel>Телефон</SecureLabel></Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" />
          </div>
          <div>
            <Label><SecureLabel>Email</SecureLabel></Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ivanov@example.com" />
          </div>
          <div>
            <Label><SecureLabel>СНИЛС</SecureLabel></Label>
            <Input value={snils} onChange={(e) => setSnils(e.target.value)} placeholder="123-456-789 00" />
          </div>
          <div>
            <Label><SecureLabel>Полис ОМС</SecureLabel></Label>
            <Input value={omiPolicy} onChange={(e) => setOmiPolicy(e.target.value)} placeholder="0000000000000000" />
          </div>
          <div>
            <Label><SecureLabel>Профессия</SecureLabel></Label>
            <Input value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="Инженер" />
          </div>
          <div>
            <Label>Курение</Label>
            <Select value={smokingStatus} onValueChange={setSmokingStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Не курит</SelectItem>
                <SelectItem value="former">Бросил</SelectItem>
                <SelectItem value="current">Курит</SelectItem>
                <SelectItem value="unknown">Неизвестно</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Алкоголь</Label>
            <Select value={alcoholUse} onValueChange={setAlcoholUse}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не употребляет</SelectItem>
                <SelectItem value="occasional">Изредка</SelectItem>
                <SelectItem value="moderate">Умеренно</SelectItem>
                <SelectItem value="heavy">Часто</SelectItem>
                <SelectItem value="unknown">Неизвестно</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Рост (см)</Label>
            <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="175" />
          </div>
          <div>
            <Label>Вес (кг)</Label>
            <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="70" />
          </div>
          <div className="sm:col-span-2">
            <Label><SecureLabel>Заметки</SecureLabel></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Дополнительная информация о пациенте (шифруется)" rows={2} />
          </div>
        </div>
        {doctorName && (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Лечащий врач: <span className="font-medium text-foreground">{doctorName}</span>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading || !lastName || !firstName} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Создать карту
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Patient detail workspace
// ============================================================================
function PatientDetailWorkspace({ patientId, onBack }: { patientId: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["patient", patientId],
    queryFn: () => api.getPatient(patientId),
    enabled: !!patientId,
  });

  const [aiPanelOpen, setAiPanelOpen] = React.useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data?.patient) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <p className="text-sm font-medium">Не удалось загрузить карту пациента</p>
            <Button onClick={onBack} variant="outline" className="mt-3">Вернуться к списку</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const p = data.patient;

  // Build AI patient context — v5.2: передаём ИИ РЕАЛЬНЫЕ данные карты
  // (анамнез жизни, вредные привычки, аллергии, наследственность, жалобы,
  // витальные показатели, анализы и обследования). Раньше контекст был бедным,
  // и модель «додумывала» отсутствующие факты (например, курение при «не курит»).
  const fmtLabs = (p: NonNullable<typeof data.patient>) =>
    (p.labResults ?? [])
      .slice(-30)
      .map((l) => {
        const norm =
          l.refRangeLow != null || l.refRangeHigh != null
            ? ` (норма ${l.refRangeLow ?? ""}-${l.refRangeHigh ?? ""})`
            : "";
        return `${l.testName} ${l.value}${l.unit ? " " + l.unit : ""}${norm}${l.flag && l.flag !== "normal" ? ` [${l.flag}]` : ""}`;
      })
      .join("; ");
  const fmtExams = (p: NonNullable<typeof data.patient>) =>
    (p.examinations ?? [])
      .filter((e) => e.status === "completed")
      .slice(-15)
      .map((e) => {
        const params = (e.resultData ?? []).map((r) => `${r.parameter}: ${r.value}${r.unit ? ` ${r.unit}` : ""}`).join(", ");
        return `${e.name}${params ? ` — ${params}` : ""}${e.conclusion ? `; заключение: ${e.conclusion}` : ""}`;
      })
      .join("; ");
  const fmtVitals = (p: NonNullable<typeof data.patient>) =>
    (p.vitalSigns ?? [])
      .slice(-5)
      .map((v) => `${v.recordedAt?.slice(0, 10) ?? ""} ЧСС ${v.heartRate ?? "—"}, АД ${v.systolicBP ?? "—"}/${v.diastolicBP ?? "—"}, SpO2 ${v.oxygenSaturation ?? "—"}%, t° ${v.temperature ?? "—"}°C, ЧДД ${v.respiratoryRate ?? "—"}, рост ${v.height ?? "—"} см, вес ${v.weight ?? "—"} кг, ИМТ ${v.bmi ?? "—"}`)
      .join("; ");

  const aiContext = {
    age: p.birthDate ? Math.floor((Date.now() - new Date(p.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : undefined,
    sex: p.sex || undefined,
    problems: p.problems?.filter(pr => pr.status === "active").map(pr => pr.title) ?? [],
    medications: p.medications?.filter(m => m.status === "active").map(m => m.drugName) ?? [],
    allergies: p.allergies?.map(a => a.allergen) ?? [],
    // v5.2 — строковые блоки для диф. диагноза (см. api.differentialDiagnosis)
    history: [
      p.smokingStatus ? `Курение: ${p.smokingStatus}` : "Курение: данных нет",
      p.alcoholUse ? `Алкоголь: ${p.alcoholUse}` : "Алкоголь: данных нет",
      p.occupation ? `Профессия: ${p.occupation}` : "",
      p.allergies?.length ? `Аллергоанамнез: ${p.allergies.map((a) => `${a.allergen}${a.reaction ? ` — ${a.reaction}` : ""}`).join("; ")}` : "Аллергоанамнез: данных нет",
      p.chronicDiseases?.length ? `Хронические заболевания: ${p.chronicDiseases.map((c) => `${c.name}${c.icd10 ? ` (${c.icd10})` : ""}`).join("; ")}` : "Хронические заболевания: по карте не указаны",
      p.familyHistory?.length ? `Наследственный анамнез: ${p.familyHistory.map((f) => `${f.relation}: ${f.condition}`).join("; ")}` : "Наследственный анамнез: данных нет",
      (p.visits ?? []).slice(-3).map((v) => `Визит ${v.completedAt?.slice(0, 10) ?? v.scheduledAt?.slice(0, 10) ?? ""}: ${v.chiefComplaint || v.visitReason || ""}`).filter((s) => s.trim().length > 8).join("; "),
      p.notes ? `Заметки врача: ${p.notes}` : "",
    ].filter(Boolean).join("\n"),
    examiners: [
      fmtVitals(p) && `Витальные показатели: ${fmtVitals(p)}`,
      fmtLabs(p) && `Анализы: ${fmtLabs(p)}`,
      fmtExams(p) && `Обследования: ${fmtExams(p)}`,
    ].filter(Boolean).join("\n"),
  };
  const patientName = [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ") || p.patientToken;

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0">
      {/* Medical record panel */}
      <div className={cn("flex-1 overflow-y-auto transition-all", aiPanelOpen ? "lg:mr-[420px]" : "")}>
        <div className="space-y-5 p-4 md:p-6">
          <PatientHero patient={p} onBack={onBack} onToggleAi={() => setAiPanelOpen(!aiPanelOpen)} aiOpen={aiPanelOpen} />
          <PatientTabs patient={p} />
        </div>
      </div>

      {/* AI Assistant side panel */}
      {aiPanelOpen && (
        <div className="fixed right-0 top-14 z-30 h-[calc(100vh-3.5rem)] w-full border-l border-border bg-card shadow-lg lg:w-[420px]">
          <InlineAiPanel patientId={patientId} patientName={patientName} patientContext={aiContext} />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-2 top-2 z-10 h-7 w-7 p-0"
            onClick={() => setAiPanelOpen(false)}
            aria-label="Закрыть ИИ-панель"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function PatientHero({ patient, onBack, onToggleAi, aiOpen }: { patient: PatientDetail; onBack: () => void; onToggleAi?: () => void; aiOpen?: boolean }) {
  const { selectCase, selectPatient } = useAppStore();
  const qc = useQueryClient();
  const [createCaseOpen, setCreateCaseOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [scoreOpen, setScoreOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const foreign = (patient as PatientDetail & { foreignEncrypted?: boolean }).foreignEncrypted;
  const fullName = foreign
    ? "🔒 Зашифровано — нет ключа расшифровки"
    : [patient.lastName, patient.firstName, patient.middleName].filter(Boolean).join(" ") || patient.patientToken;
  // E2EE v2.6: точный возраст из расшифрованной полной даты
  const exactAge = calcAgeFromBirthDate(patient.birthDate);
  const age = exactAge ?? patient.age;
  const status = PATIENT_STATUS[patient.status] ?? PATIENT_STATUS.active;
  const bmi = patient.height > 0 && patient.weight > 0
    ? (patient.weight / Math.pow(patient.height / 100, 2)).toFixed(1)
    : null;
  const bmiCat = bmi ? (Number(bmi) < 18.5 ? "Снижен" : Number(bmi) < 25 ? "Норма" : Number(bmi) < 30 ? "Избыток" : "Ожирение") : null;
  const bmiColor = bmiCat === "Норма" ? "text-emerald-600" : bmiCat === "Снижен" ? "text-sky-600" : "text-amber-600";

  // v2.5.9: Fetch health score
  const { data: healthScore, isLoading: scoreLoading } = useQuery({
    queryKey: ["health-score", patient.id],
    queryFn: () => api.getHealthScore(patient.id),
    staleTime: 60000,
  });

  const createCaseMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createCase(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setCreateCaseOpen(false);
      toast.success(`Случай ${res.case.caseCode} создан и связан с пациентом`);
      selectCase(res.case.id);
    },
    onError: (e: Error) => toast.error("Ошибка создания случая: " + e.message),
  });

  const editMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.updatePatient(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      setEditOpen(false);
      toast.success("Данные пациента обновлены");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 p-5 md:p-6">
      <div className="absolute right-0 top-0 h-48 w-48 -translate-y-12 translate-x-12 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-32 w-32 translate-y-12 -translate-x-12 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-2">
          <Button onClick={onBack} variant="ghost" size="sm" className="gap-1 backdrop-blur-sm">
            <ChevronLeft className="h-4 w-4" /> Назад
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditOpen(true)} variant="ghost" size="sm" className="gap-1 backdrop-blur-sm">
              <FileText className="h-4 w-4" /> Изменить
            </Button>
            <Button onClick={() => window.print()} variant="ghost" size="sm" className="gap-1 backdrop-blur-sm">
              <Printer className="h-4 w-4" /> Печать
            </Button>
            <Button
              onClick={() => setExportOpen(true)}
              disabled={foreign}
              title={foreign ? "Данные зашифрованы ключом другого врача" : "Экспорт карты в зашифрованный контейнер .cvlt (CryptoVault)"}
              variant="ghost" size="sm" className="gap-1 backdrop-blur-sm"
            >
              <FileLock2 className="h-4 w-4" /> Экспорт .cvlt
            </Button>
            <Button
              onClick={() => setShareOpen(true)}
              title="Передача доступа к карте другому врачу (X25519 key-wrapping, без раскрытия ключа)"
              variant="ghost" size="sm" className="gap-1 backdrop-blur-sm"
            >
              <Share2 className="h-4 w-4" /> Передать доступ
            </Button>
            {onToggleAi && (
              <Button
                onClick={onToggleAi}
                size="sm"
                variant={aiOpen ? "default" : "outline"}
                className="gap-1.5"
              >
                <Sparkles className="h-4 w-4" /> {aiOpen ? "Закрыть ИИ" : "ИИ-ассистент"}
              </Button>
            )}
            <Button
              onClick={() => setCreateCaseOpen(true)}
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md hover:from-emerald-700 hover:to-teal-700"
            >
              <Cpu className="h-4 w-4" /> ИИ-анализ
            </Button>
            <Badge variant="outline" className={cn("border", status.color)}>
              <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", status.dot)} /> {status.label}
            </Badge>
          </div>
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-2xl font-bold text-white shadow-lg">
            {foreign ? "🔒" : patient.lastName?.[0] || patient.patientToken[0]}
          </div>
          <div className="flex-1 space-y-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{fullName}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 font-mono text-xs">
                <IdCard className="h-3 w-3" /> {patient.patientToken}
              </Badge>
              {age != null && (
                <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300">
                  <Calendar className="h-3 w-3" /> {age} лет{patient.birthDate ? ` (${fmtDate(patient.birthDate)})` : ""}
                </Badge>
              )}
              {patient.sex && (
                <Badge variant="outline" className={cn("gap-1 text-xs", patient.sex === "М" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
                  {patient.sex === "М" ? "♂ Муж" : "♀ Жен"}
                </Badge>
              )}
              {patient.bloodType && (
                <Badge variant="outline" className="gap-1 bg-rose-500/10 text-xs font-semibold text-rose-700 dark:text-rose-300">
                  <Droplet className="h-3 w-3" /> {patient.bloodType}
                </Badge>
              )}
              {bmi && (
                <Badge variant="outline" className={cn("gap-1 text-xs", bmiColor)}>
                  <Weight className="h-3 w-3" /> ИМТ {bmi} ({bmiCat})
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {foreign && <span className="flex items-center gap-1 italic"><Lock className="h-3 w-3" />Идентификаторы зашифрованы ключом другого врача</span>}
              {patient.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{patient.phone}</span>}
              {patient.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{patient.email}</span>}
              {patient.occupation && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{patient.occupation}</span>}
              {patient.snils && <span className="flex items-center gap-1"><IdCard className="h-3 w-3" />СНИЛС: {patient.snils}</span>}
              {patient.primaryDoctor && <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />Леч. врач: {patient.primaryDoctor.fullName}</span>}
            </div>
          </div>
        </div>

        {/* Linked AI cases */}
        {patient.cases && patient.cases.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <Cpu className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">ИИ-кейсы пациента:</span>
            {patient.cases.slice(0, 3).map((c) => (
              <Badge key={c.id} variant="outline" className="cursor-pointer gap-1 text-[10px] hover:bg-emerald-500/10" >
                {c.caseCode} · {c.status}
              </Badge>
            ))}
            {patient.cases.length > 3 && <span className="text-[10px] text-muted-foreground">+{patient.cases.length - 3}</span>}
          </div>
        )}

        {/* Quick metrics */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <QuickMetric icon={Calendar} label="Визитов" value={patient.visits?.length ?? 0} color="text-sky-600" />
          <QuickMetric icon={Pill} label="Препаратов" value={patient.medications?.filter(m => m.status === "active").length ?? 0} color="text-emerald-600" />
          <QuickMetric icon={FlaskConical} label="Анализов" value={patient.labResults?.length ?? 0} color="text-violet-600" />
          <QuickMetric icon={ClipboardList} label="Проблем" value={patient.problems?.filter(p => p.status === "active").length ?? 0} color="text-rose-600" />
        </div>

        {/* v2.5.9: Health Score gauge */}
        <HealthScoreGauge data={healthScore} loading={scoreLoading} onClick={() => setScoreOpen(true)} />
      </div>

      <HealthScoreDialog
        open={scoreOpen}
        onOpenChange={setScoreOpen}
        data={healthScore}
        loading={scoreLoading}
      />

      <CreateCaseFromPatientDialog
        open={createCaseOpen}
        onOpenChange={setCreateCaseOpen}
        patient={patient}
        onSubmit={(d) => createCaseMut.mutate(d)}
        loading={createCaseMut.isPending}
      />
      <EditPatientDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        patient={patient}
        onSubmit={(d) => editMut.mutate(d)}
        loading={editMut.isPending}
      />
      <PatientExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        patient={patient}
      />
      <PatientShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        patient={patient as unknown as Parameters<typeof PatientShareDialog>[0]["patient"]}
      />
    </div>
  );
}

function QuickMetric({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2 backdrop-blur-sm">
      <Icon className={cn("h-4 w-4", color)} />
      <div>
        <div className="text-lg font-bold leading-tight">{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Health Score Gauge + Dialog (v2.5.9)
// ============================================================================
const SCORE_COLORS: Record<string, { text: string; bg: string; border: string; gauge: string; label: string }> = {
  low: { text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", gauge: "stroke-emerald-500", label: "Низкий риск" },
  moderate: { text: "text-amber-700 dark:text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30", gauge: "stroke-amber-500", label: "Умеренный риск" },
  high: { text: "text-orange-700 dark:text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/30", gauge: "stroke-orange-500", label: "Высокий риск" },
  critical: { text: "text-rose-700 dark:text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/30", gauge: "stroke-rose-500", label: "Критический риск" },
};

function HealthScoreGauge({ data, loading, onClick }: {
  data?: {
    score: number;
    riskLevel: "low" | "moderate" | "high" | "critical";
    riskLabel: string;
  };
  loading: boolean;
  onClick: () => void;
}) {
  if (loading) {
    return <Skeleton className="h-20 w-full rounded-lg" />;
  }
  if (!data) return null;

  const cfg = SCORE_COLORS[data.riskLevel] ?? SCORE_COLORS.moderate;
  const score = data.score;
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (score / 100) * circumference;

  return (
    <button
      onClick={onClick}
      className={cn("flex w-full items-center gap-4 rounded-lg border bg-background/60 p-3 text-left backdrop-blur-sm transition-all hover:shadow-md", cfg.border)}
    >
      {/* Circular gauge */}
      <div className="relative h-16 w-16 shrink-0">
        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/30" />
          <circle
            cx="32" cy="32" r="28" fill="none" strokeWidth="5" strokeLinecap="round"
            className={cn("transition-all duration-700", cfg.gauge)}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn("text-lg font-bold tabular-nums", cfg.text)}>{score}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Индекс здоровья</span>
          <Badge variant="outline" className={cn("text-[9px]", cfg.text, cfg.border)}>{cfg.label}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {score >= 80 ? "Хорошее состояние — нажмите для деталей" : score >= 60 ? "Требует внимания — нажмите для деталей" : score >= 40 ? "Требует вмешательства — нажмите для деталей" : "Критическое состояние — нажмите для деталей"}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function HealthScoreDialog({ open, onOpenChange, data, loading }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data?: {
    score: number;
    riskLevel: "low" | "moderate" | "high" | "critical";
    riskLabel: string;
    factors: Array<{ category: string; label: string; impact: "positive" | "neutral" | "negative" | "critical"; detail: string; points: number }>;
    totalDeduction: number;
  };
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Индекс здоровья</DialogTitle>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const cfg = SCORE_COLORS[data.riskLevel] ?? SCORE_COLORS.moderate;
  const IMPACT_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
    positive: { icon: "✓", color: "text-emerald-600", bg: "bg-emerald-500/10" },
    neutral: { icon: "—", color: "text-muted-foreground", bg: "bg-muted" },
    negative: { icon: "↓", color: "text-amber-600", bg: "bg-amber-500/10" },
    critical: { icon: "⚠", color: "text-rose-600", bg: "bg-rose-500/10" },
  };

  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (data.score / 100) * circumference;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="sr-only">Индекс здоровья пациента</DialogTitle>
        <div className="flex flex-col items-center gap-4 py-2">
          {/* Score gauge */}
          <div className="relative h-24 w-24">
            <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
              <circle
                cx="40" cy="40" r="36" fill="none" strokeWidth="6" strokeLinecap="round"
                className={cn("transition-all duration-700", cfg.gauge)}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-2xl font-bold tabular-nums", cfg.text)}>{data.score}</span>
              <span className="text-[9px] uppercase text-muted-foreground">из 100</span>
            </div>
          </div>
          <div className="text-center">
            <Badge variant="outline" className={cn("text-xs", cfg.text, cfg.border)}>{data.riskLabel}</Badge>
            <p className="mt-1 text-xs text-muted-foreground">Суммарное снижение: {data.totalDeduction} баллов</p>
          </div>
        </div>

        {/* Contributing factors */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Факторы, влияющие на оценку</div>
          {data.factors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных для расчёта</p>
          ) : (
            data.factors.map((f, i) => {
              const impCfg = IMPACT_CONFIG[f.impact] ?? IMPACT_CONFIG.neutral;
              return (
                <div key={i} className={cn("flex items-start gap-2 rounded-md border p-2", f.impact === "critical" ? "border-rose-500/30 bg-rose-500/5" : f.impact === "negative" ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5")}>
                  <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", impCfg.bg, impCfg.color)}>
                    {impCfg.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{f.label}</span>
                      {f.points < 0 && <span className={cn("text-[10px] font-mono font-bold", impCfg.color)}>{f.points}</span>}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{f.detail}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Patient detail tabs
// ============================================================================
function PatientTabs({ patient }: { patient: PatientDetail }) {
  return (
    <Tabs defaultValue="overview" className="w-full">
      <div className="sticky top-[4.5rem] z-30 -mx-4 mb-2 rounded-lg bg-background/95 px-4 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
        <TabsList className="flex h-auto w-full flex-wrap gap-1">
          <TabsTrigger value="overview" className="gap-1.5"><User className="h-3.5 w-3.5" /> Обзор</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> Хронология</TabsTrigger>
          <TabsTrigger value="visits" className="gap-1.5"><Calendar className="h-3.5 w-3.5" /> Визиты ({patient.visits?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="vitals" className="gap-1.5"><Heart className="h-3.5 w-3.5" /> Витальные</TabsTrigger>
          <TabsTrigger value="medications" className="gap-1.5"><Pill className="h-3.5 w-3.5" /> Препараты ({patient.medications?.filter(m => m.status === "active").length ?? 0})</TabsTrigger>
          <TabsTrigger value="labs" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Лаборатория</TabsTrigger>
          <TabsTrigger value="examinations" className="gap-1.5">
            <Microscope className="h-3.5 w-3.5" /> Обследования ({(patient.examinations ?? []).filter(e => e.status === "ordered" || e.status === "scheduled" || e.status === "in_progress").length})
          </TabsTrigger>
          <TabsTrigger value="problems" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Проблемы ({patient.problems?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="immunizations" className="gap-1.5"><Syringe className="h-3.5 w-3.5" /> Прививки</TabsTrigger>
          <TabsTrigger value="careplans" className="gap-1.5"><Award className="h-3.5 w-3.5" /> Планы</TabsTrigger>
          <TabsTrigger value="ai-analysis" className="gap-1.5"><Cpu className="h-3.5 w-3.5" /> ИИ-Анализ</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="mt-4"><OverviewTab patient={patient} /></TabsContent>
      <TabsContent value="timeline" className="mt-4"><TimelineTab patient={patient} /></TabsContent>
      <TabsContent value="visits" className="mt-4"><VisitsTab patient={patient} /></TabsContent>
      <TabsContent value="vitals" className="mt-4"><VitalsTab patient={patient} /></TabsContent>
      <TabsContent value="medications" className="mt-4"><MedicationsTab patient={patient} /></TabsContent>
      <TabsContent value="labs" className="mt-4"><LabsTab patient={patient} /></TabsContent>
      <TabsContent value="examinations" className="mt-4"><ExaminationsTab patient={patient} /></TabsContent>
      <TabsContent value="problems" className="mt-4"><ProblemsTab patient={patient} /></TabsContent>
      <TabsContent value="immunizations" className="mt-4"><ImmunizationsTab patient={patient} /></TabsContent>
      <TabsContent value="careplans" className="mt-4"><CarePlansTab patient={patient} /></TabsContent>
      <TabsContent value="ai-analysis" className="mt-4"><PatientAnalysisTab patient={patient} /></TabsContent>
    </Tabs>
  );
}

// ============================================================================
// Timeline Tab — unified chronological feed of all patient events
// ============================================================================
type TimelineEvent = {
  id: string;
  date: string;
  type: "visit" | "vital" | "medication" | "lab" | "problem" | "immunization" | "careplan" | "case";
  title: string;
  subtitle?: string;
  details?: string[];
  color: string;
  icon: LucideIcon;
};

function TimelineTab({ patient }: { patient: PatientDetail }) {
  const events = React.useMemo<TimelineEvent[]>(() => {
    const evs: TimelineEvent[] = [];

    for (const v of patient.visits ?? []) {
      evs.push({
        id: v.id, date: v.scheduledAt, type: "visit",
        title: `Визит — ${({ outpatient: "Амбулаторный", inpatient: "Стационарный", emergency: "Экстренный", telemedicine: "Телемедицина", home: "Дом", consultation: "Консультация" } as Record<string, string>)[v.visitType] || v.visitType}`,
        subtitle: v.chiefComplaint ? `Жалобы: ${v.chiefComplaint}` : undefined,
        details: [v.soapAssessment, v.soapPlan].filter(Boolean),
        color: "border-sky-500/40 bg-sky-500/5", icon: Calendar,
      });
    }

    for (const v of patient.vitalSigns ?? []) {
      const parts: string[] = [];
      if (v.systolicBP) parts.push(`АД ${v.systolicBP}/${v.diastolicBP}`);
      if (v.heartRate) parts.push(`ЧСС ${v.heartRate}`);
      if (v.temperature) parts.push(`T ${v.temperature}°C`);
      if (v.oxygenSaturation) parts.push(`SpO₂ ${v.oxygenSaturation}%`);
      if (v.weight) parts.push(`Вес ${v.weight} кг`);
      evs.push({
        id: v.id, date: v.recordedAt, type: "vital",
        title: "Витальные показатели",
        subtitle: parts.join(" · ") || "Измерение",
        color: "border-rose-500/40 bg-rose-500/5", icon: Heart,
      });
    }

    for (const m of patient.medications ?? []) {
      evs.push({
        id: m.id, date: m.startDate, type: "medication",
        title: `${m.status === "active" ? "Назначен" : m.status === "completed" ? "Завершён" : m.status === "discontinued" ? "Отменён" : "Препарат"}: ${m.drugName}`,
        subtitle: [m.dosage, m.frequency, m.indication].filter(Boolean).join(" · "),
        details: m.notes ? [m.notes] : undefined,
        color: "border-emerald-500/40 bg-emerald-500/5", icon: Pill,
      });
    }

    for (const l of patient.labResults ?? []) {
      const flagLabel = ({ normal: "норма", low: "↓ снижен", high: "↑ повышен", critical: "⚠ критич.", abnormal: "отклонение" } as Record<string, string>)[l.flag] || l.flag;
      evs.push({
        id: l.id, date: l.collectedAt, type: "lab",
        title: `Анализ: ${l.testName}`,
        subtitle: `Результат: ${l.value} ${l.unit} (${flagLabel})`,
        details: l.refRangeLow != null && l.refRangeHigh != null ? [`Норма: ${l.refRangeLow}–${l.refRangeHigh} ${l.unit}`] : undefined,
        color: l.flag === "critical" ? "border-rose-500/50 bg-rose-500/10" : l.flag !== "normal" ? "border-amber-500/40 bg-amber-500/5" : "border-violet-500/40 bg-violet-500/5",
        icon: FlaskConical,
      });
    }

    for (const p of patient.problems ?? []) {
      evs.push({
        id: p.id, date: p.onsetDate ?? "", type: "problem",
        title: `${p.isPrimary ? "Основная проблема: " : ""}${p.title}`,
        subtitle: [p.icd10 ? `МКБ-10: ${p.icd10}` : "", ({ active: "Активна", resolved: "Разрешена", chronic: "Хроническая", controlled: "Контролируется", uncontrolled: "Неконтролируемая" } as Record<string, string>)[p.status] || p.status].filter(Boolean).join(" · "),
        details: p.description ? [p.description] : undefined,
        color: "border-rose-500/40 bg-rose-500/5", icon: ClipboardList,
      });
    }

    for (const i of patient.immunizations ?? []) {
      evs.push({
        id: i.id, date: i.administeredAt, type: "immunization",
        title: `Прививка: ${i.vaccineName}`,
        subtitle: [i.targetDisease ? `Против: ${i.targetDisease}` : "", `Доза №${i.doseNumber}`].filter(Boolean).join(" · "),
        details: i.reaction ? [`Реакция: ${i.reaction}`] : undefined,
        color: "border-violet-500/40 bg-violet-500/5", icon: Syringe,
      });
    }

    for (const c of patient.carePlans ?? []) {
      evs.push({
        id: c.id, date: c.startDate, type: "careplan",
        title: `План: ${c.title}`,
        subtitle: [({ treatment: "Лечение", monitoring: "Наблюдение", prevention: "Профилактика", rehabilitation: "Реабилитация", palliative: "Паллиатив" } as Record<string, string>)[c.type] || c.type, ({ draft: "Черновик", active: "Активен", completed: "Завершён", on_hold: "Приостановлен", cancelled: "Отменён" } as Record<string, string>)[c.status] || c.status].filter(Boolean).join(" · "),
        details: c.goals?.length ? [`Цели: ${c.goals.map(g => g.description).join("; ")}`] : undefined,
        color: "border-amber-500/40 bg-amber-500/5", icon: Award,
      });
    }

    for (const c of patient.cases ?? []) {
      evs.push({
        id: c.id, date: c.createdAt, type: "case",
        title: `ИИ-кейс: ${c.caseCode}`,
        subtitle: [c.diagnosisHint || "Без диагноза", ({ new: "Новый", uploaded: "Загружен", analyzing: "Анализ", analyzed: "Проанализирован", reported: "Отчёт", archived: "Архив" } as Record<string, string>)[c.status] || c.status].filter(Boolean).join(" · "),
        color: "border-emerald-500/40 bg-emerald-500/5", icon: Cpu,
      });
    }

    // Sort by date descending
    evs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return evs;
  }, [patient]);

  const typeCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
    return counts;
  }, [events]);

  const TYPE_LABELS: Record<string, string> = {
    visit: "Визиты", vital: "Витальные", medication: "Препараты", lab: "Анализы",
    problem: "Проблемы", immunization: "Прививки", careplan: "Планы", case: "ИИ-кейсы",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Хронология событий</h3>
          <p className="text-xs text-muted-foreground">Единая лента всех медицинских событий пациента</p>
        </div>
        <Badge variant="outline" className="text-xs">{events.length} событий</Badge>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(TYPE_LABELS).filter(([t]) => typeCounts[t]).map(([t, label]) => (
          <Badge key={t} variant="outline" className="gap-1 text-[10px]">
            {label} <span className="font-mono text-muted-foreground">{typeCounts[t]}</span>
          </Badge>
        ))}
      </div>

      {events.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">События отсутствуют</CardContent></Card>
      ) : (
        <div className="relative space-y-3 before:absolute before:left-[18px] before:top-2 before:h-[calc(100%-1rem)] before:w-0.5 before:bg-gradient-to-b before:from-emerald-500/40 before:via-muted-foreground/20 before:to-transparent">
          {events.map((e) => {
            const Icon = e.icon;
            return (
              <div key={`${e.type}-${e.id}`} className="relative flex gap-3 pl-0">
                <div className={cn("relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-background shadow-sm", e.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <Card className={cn("flex-1 border-l-4 py-0", e.color)}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{e.title}</span>
                        </div>
                        {e.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{e.subtitle}</p>}
                        {e.details && e.details.length > 0 && (
                          <div className="mt-1.5 space-y-1">
                            {e.details.map((d, i) => (
                              <p key={i} className="text-xs opacity-80">{d}</p>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[10px] font-medium text-muted-foreground">{fmtDate(e.date)}</div>
                        <div className="text-[10px] text-muted-foreground/70">{fmtDateTime(e.date).split(",")[1]?.trim()}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================
function OverviewTab({ patient }: { patient: PatientDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4 text-rose-500" /> Аллергии и реакции</CardTitle></CardHeader>
        <CardContent>
          {patient.allergies?.length > 0 ? (
            <div className="space-y-2">
              {patient.allergies.map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{a.allergen}</div>
                    <div className="text-xs text-muted-foreground">{a.reaction}</div>
                  </div>
                  <Badge variant="outline" className="text-rose-600 border-rose-500/30">{a.severity || "?"}</Badge>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Аллергии не зарегистрированы</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-amber-500" /> Хронические заболевания</CardTitle></CardHeader>
        <CardContent>
          {patient.chronicDiseases?.length > 0 ? (
            <div className="space-y-2">
              {patient.chronicDiseases.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{d.name}</div>
                    {d.icd10 && <div className="text-xs text-muted-foreground">МКБ-10: {d.icd10}</div>}
                  </div>
                  {d.status && <Badge variant="outline" className="text-xs">{d.status}</Badge>}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Хронические заболевания отсутствуют</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><User className="h-4 w-4 text-sky-500" /> Семейный анамнез</CardTitle></CardHeader>
        <CardContent>
          {patient.familyHistory?.length > 0 ? (
            <div className="space-y-2">
              {patient.familyHistory.map((f, i) => (
                <div key={i} className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-sm font-medium">{f.relation}: {f.condition}</div>
                  {f.notes && <div className="text-xs text-muted-foreground">{f.notes}</div>}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Семейный анамнез не указан</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Cigarette className="h-4 w-4 text-orange-500" /> Образ жизни</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground"><Cigarette className="h-4 w-4" /> Курение</span>
            <Badge variant="outline">{({ never: "Не курит", former: "Бросил", current: "Курит", unknown: "Неизвестно" } as Record<string, string>)[patient.smokingStatus]}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground"><Wine className="h-4 w-4" /> Алкоголь</span>
            <Badge variant="outline">{({ none: "Не употребляет", occasional: "Изредка", moderate: "Умеренно", heavy: "Часто", unknown: "Неизвестно" } as Record<string, string>)[patient.alcoholUse]}</Badge>
          </div>
          {patient.height > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Ruler className="h-4 w-4" /> Рост</span>
              <span className="font-medium">{patient.height} см</span>
            </div>
          )}
          {patient.weight > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Weight className="h-4 w-4" /> Вес</span>
              <span className="font-medium">{patient.weight} кг</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* v4.1: Обследования — сводка по реестру */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Microscope className="h-4 w-4 text-teal-500" /> Обследования
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <QuickMetric icon={Microscope} label="Всего" value={patient.examinations?.length ?? 0} color="text-teal-600" />
            <QuickMetric icon={CalendarClock} label="Назначено" value={(patient.examinations ?? []).filter(e => e.status === "ordered" || e.status === "scheduled" || e.status === "in_progress").length} color="text-amber-600" />
            <QuickMetric icon={CheckCircle2} label="Проведено" value={(patient.examinations ?? []).filter(e => e.status === "completed").length} color="text-emerald-600" />
            {(patient.examinations ?? []).filter(e => e.isAbnormal).length > 0 && (
              <QuickMetric icon={AlertTriangle} label="С отклонениями" value={(patient.examinations ?? []).filter(e => e.isAbnormal).length} color="text-rose-600" />
            )}
            <p className="text-xs text-muted-foreground md:ml-auto">
              Обследования: {(patient.examinations ?? []).filter(e => e.status === "ordered" || e.status === "scheduled" || e.status === "in_progress").length} назначено, {(patient.examinations ?? []).filter(e => e.status === "completed").length} проведено — полная информация во вкладке «Обследования»
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Vitals Tab — with charts
// ============================================================================
function VitalsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const vitals = (patient.vitalSigns ?? []).slice().reverse().map(v => ({
    ...v, date: new Date(v.recordedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
  }));

  const addMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.addVital(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("Витальные показатели добавлены");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const latest = vitals[vitals.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Жизненные показатели (тренды)</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Добавить
        </Button>
      </div>

      {/* Latest snapshot */}
      {latest && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          <VitalCard icon={Heart} label="АД" value={latest.systolicBP ? `${latest.systolicBP}/${latest.diastolicBP}` : "—"} unit="мм рт.ст." color="text-rose-600" />
          <VitalCard icon={Activity} label="ЧСС" value={latest.heartRate || "—"} unit="уд/мин" color="text-rose-500" />
          <VitalCard icon={Thermometer} label="Темп." value={latest.temperature || "—"} unit="°C" color="text-amber-600" />
          <VitalCard icon={Wind} label="SpO₂" value={latest.oxygenSaturation || "—"} unit="%" color="text-sky-600" />
          <VitalCard icon={Weight} label="Вес" value={latest.weight || "—"} unit="кг" color="text-emerald-600" />
          <VitalCard icon={Brain} label="ЧДД" value={latest.respiratoryRate || "—"} unit="/мин" color="text-violet-600" />
        </div>
      )}

      {/* BP chart */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Heart className="h-4 w-4 text-rose-500" /> Артериальное давление</CardTitle></CardHeader>
        <CardContent>
          {vitals.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={vitals}>
                <defs>
                  <linearGradient id="gSys" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gDia" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[40, 200]} />
                <RTooltip />
                <Legend />
                <Area type="monotone" dataKey="systolicBP" name="Сист." stroke="#f43f5e" fill="url(#gSys)" strokeWidth={2} />
                <Area type="monotone" dataKey="diastolicBP" name="Диаст." stroke="#0ea5e9" fill="url(#gDia)" strokeWidth={2} />
                <ReferenceLine y={140} stroke="#f43f5e" strokeDasharray="4 4" label="Гипертония" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">Нет данных по АД</p>}
        </CardContent>
      </Card>

      {/* HR + Temp + SpO2 charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-rose-500" /> Пульс и SpO₂</CardTitle></CardHeader>
          <CardContent>
            {vitals.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={vitals}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Legend />
                  <Line type="monotone" dataKey="heartRate" name="ЧСС" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="oxygenSaturation" name="SpO₂" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="py-6 text-center text-sm text-muted-foreground">Нет данных</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Weight className="h-4 w-4 text-emerald-500" /> Вес и ИМТ</CardTitle></CardHeader>
          <CardContent>
            {vitals.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={vitals}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Legend />
                  <Line yAxisId="l" type="monotone" dataKey="weight" name="Вес" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="r" type="monotone" dataKey="bmi" name="ИМТ" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="py-6 text-center text-sm text-muted-foreground">Нет данных</p>}
          </CardContent>
        </Card>
      </div>

      {/* History table */}
      <Card>
        <CardHeader><CardTitle className="text-sm">История измерений ({vitals.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-80 overflow-y-auto">
            {vitals.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Измерения не зарегистрированы</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">Дата</th>
                    <th className="p-2">АД</th>
                    <th className="p-2">ЧСС</th>
                    <th className="p-2">°C</th>
                    <th className="p-2">SpO₂</th>
                    <th className="p-2">Вес</th>
                    <th className="p-2">ИМТ</th>
                  </tr>
                </thead>
                <tbody>
                  {vitals.slice().reverse().map((v) => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-2 text-xs">{fmtDate(v.recordedAt)}</td>
                      <td className="p-2 font-mono">{v.systolicBP}/{v.diastolicBP}</td>
                      <td className="p-2 font-mono">{v.heartRate || "—"}</td>
                      <td className="p-2 font-mono">{v.temperature || "—"}</td>
                      <td className="p-2 font-mono">{v.oxygenSaturation || "—"}</td>
                      <td className="p-2 font-mono">{v.weight || "—"}</td>
                      <td className="p-2 font-mono">{v.bmi || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      <AddVitalDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={(d) => addMut.mutate(d)} loading={addMut.isPending} />
    </div>
  );
}

function VitalCard({ icon: Icon, label, value, unit, color }: { icon: LucideIcon; label: string; value: string | number; unit: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("h-3 w-3", color)} /> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-bold">{value}</span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function AddVitalDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  onSubmit: (d: Record<string, unknown>) => void; loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const submit = () => {
    onSubmit({
      recordedAt: new Date().toISOString(),
      systolicBP: v.systolicBP, diastolicBP: v.diastolicBP, heartRate: v.heartRate,
      respiratoryRate: v.respiratoryRate, temperature: v.temperature,
      oxygenSaturation: v.oxygenSaturation, height: v.height, weight: v.weight,
      waistCircumference: v.waistCircumference, glucose: v.glucose, painScore: v.painScore,
      consciousness: v.consciousness, notes: v.notes,
    });
    setV({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Добавить витальные показатели</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-3">
          <div><Label>Сист. АД</Label><Input type="number" value={v.systolicBP || ""} onChange={(e) => set("systolicBP", e.target.value)} placeholder="120" /></div>
          <div><Label>Диаст. АД</Label><Input type="number" value={v.diastolicBP || ""} onChange={(e) => set("diastolicBP", e.target.value)} placeholder="80" /></div>
          <div><Label>ЧСС</Label><Input type="number" value={v.heartRate || ""} onChange={(e) => set("heartRate", e.target.value)} placeholder="72" /></div>
          <div><Label>ЧДД</Label><Input type="number" value={v.respiratoryRate || ""} onChange={(e) => set("respiratoryRate", e.target.value)} placeholder="16" /></div>
          <div><Label>T °C</Label><Input type="number" step="0.1" value={v.temperature || ""} onChange={(e) => set("temperature", e.target.value)} placeholder="36.6" /></div>
          <div><Label>SpO₂ %</Label><Input type="number" value={v.oxygenSaturation || ""} onChange={(e) => set("oxygenSaturation", e.target.value)} placeholder="98" /></div>
          <div><Label>Рост (см)</Label><Input type="number" value={v.height || ""} onChange={(e) => set("height", e.target.value)} placeholder="175" /></div>
          <div><Label>Вес (кг)</Label><Input type="number" step="0.1" value={v.weight || ""} onChange={(e) => set("weight", e.target.value)} placeholder="70" /></div>
          <div><Label>Талия (см)</Label><Input type="number" value={v.waistCircumference || ""} onChange={(e) => set("waistCircumference", e.target.value)} placeholder="85" /></div>
          <div><Label>Глюкоза</Label><Input type="number" step="0.1" value={v.glucose || ""} onChange={(e) => set("glucose", e.target.value)} placeholder="5.5" /></div>
          <div><Label>Боль (0-10)</Label><Input type="number" value={v.painScore || ""} onChange={(e) => set("painScore", e.target.value)} placeholder="0" /></div>
          <div><Label>Сознание</Label><Input value={v.consciousness || ""} onChange={(e) => set("consciousness", e.target.value)} placeholder="Ясное" /></div>
          <div className="col-span-2 sm:col-span-3"><Label>Заметки</Label><Input value={v.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="…" /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Medications Tab
// ============================================================================
function MedicationsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const active = patient.medications?.filter((m) => m.status === "active") ?? [];
  const history = patient.medications?.filter((m) => m.status !== "active") ?? [];

  // v2.5.8: Fetch DDI overview for all active medications
  const { data: ddiData, isLoading: ddiLoading } = useQuery({
    queryKey: ["ddi-overview", patient.id],
    queryFn: () => api.getDdiOverview(patient.id),
    enabled: active.length > 0,
    staleTime: 30000,
  });

  const addMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.addMedication(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("Препарат добавлен");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Фармакотерапия</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Назначить
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Pill className="h-4 w-4 text-emerald-500" /> Активные ({active.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {active.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Нет активных препаратов</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {active.map((m) => (
                <div key={m.id} className="flex items-start gap-3 border-b p-3 last:border-0 hover:bg-muted/30">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
                    <Pill className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.drugName}</span>
                      {m.brandName && <span className="text-xs text-muted-foreground">({m.brandName})</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {m.dosage && <span>Дозировка: <b className="font-mono text-foreground">{m.dosage}</b></span>}
                      {m.frequency && <span>Кратность: {m.frequency}</span>}
                      {m.route && <span>Путь: {m.route}</span>}
                      {m.duration && <span>Длительность: {m.duration}</span>}
                    </div>
                    {m.indication && <div className="mt-1 text-xs text-muted-foreground">Показание: {m.indication}</div>}
                  </div>
                  <Badge variant="outline" className="bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300">{MED_STATUS[m.status]?.label || m.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* v2.5.8: DDI Overview — drug-drug interactions + allergy conflicts */}
      {active.length > 0 && (
        <DdiOverviewCard
          data={ddiData}
          loading={ddiLoading}
          medications={active.map((m) => m.drugName).filter(Boolean)}
        />
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">История препаратов ({history.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-60 overflow-y-auto">
              {history.map((m) => (
                <div key={m.id} className="flex items-center gap-3 border-b p-3 text-sm last:border-0">
                  <Pill className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{m.drugName}</span>
                  <span className="text-xs text-muted-foreground">{m.dosage}</span>
                  <Badge variant="outline" className={cn("ml-auto text-xs", MED_STATUS[m.status]?.color)}>{MED_STATUS[m.status]?.label || m.status}</Badge>
                  <span className="text-xs text-muted-foreground">{fmtDate(m.startDate)} — {fmtDate(m.endDate)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AddMedicationDialog open={addOpen} onOpenChange={setAddOpen} patientId={patient.id} onSubmit={(d) => addMut.mutate(d)} loading={addMut.isPending} />
    </div>
  );
}

// ============================================================================
// DDI Overview Card — shows all drug interactions for active medications
// ============================================================================
function DdiOverviewCard({ data, loading, medications }: {
  data?: {
    totalMeds: number;
    interactions: Array<{ drug1: string; drug2: string; severity: string; description: string; mechanism: string; management: string; evidenceLevel: string }>;
    allergyWarnings: Array<{ medication: string; allergen: string; reaction: string; severity: string }>;
    summary: { total: number; contraindications: number; major: number; moderate: number; minor: number; allergyConflicts: number };
  };
  loading: boolean;
  /** Активные препараты пациента (для потоковой онлайн-проверки v5.0). */
  medications: string[];
}) {
  const [onlineCheckOpen, setOnlineCheckOpen] = React.useState(false);

  const SEV_CONFIG: Record<string, { label: string; color: string; border: string; bg: string }> = {
    contraindication: { label: "Противопоказано", color: "text-rose-700 dark:text-rose-300", border: "border-l-rose-500", bg: "bg-rose-500/5" },
    major: { label: "Серьёзное", color: "text-orange-700 dark:text-orange-300", border: "border-l-orange-500", bg: "bg-orange-500/5" },
    moderate: { label: "Умеренное", color: "text-amber-700 dark:text-amber-300", border: "border-l-amber-500", bg: "bg-amber-500/5" },
    minor: { label: "Незначительное", color: "text-sky-700 dark:text-sky-300", border: "border-l-sky-500", bg: "bg-sky-500/5" },
  };

  if (loading) {
    return (
      <Card className="rounded-xl">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { interactions, allergyWarnings, summary } = data;
  const hasIssues = summary.total > 0;

  return (
    <Card className={cn("rounded-xl", hasIssues && summary.contraindications > 0 ? "border-l-4 border-l-rose-500" : hasIssues && summary.major > 0 ? "border-l-4 border-l-orange-500" : hasIssues ? "border-l-4 border-l-amber-500" : "border-l-4 border-l-emerald-500")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", hasIssues ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-600")}>
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Обзор лекарственных взаимодействий</CardTitle>
              <p className="text-[10px] text-muted-foreground">Проверка {data.totalMeds} активных препаратов (локальная база)</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {medications.length >= 2 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-primary/40 text-[11px] text-primary hover:bg-primary/10"
                onClick={() => setOnlineCheckOpen(true)}
              >
                <Globe className="h-3 w-3" />
                Онлайн-проверка (РФ)
              </Button>
            )}
            {hasIssues ? (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {summary.contraindications > 0 && <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px]">{summary.contraindications} против.</Badge>}
                {summary.major > 0 && <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 text-[10px]">{summary.major} серьёзн.</Badge>}
                {summary.moderate > 0 && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px]">{summary.moderate} умер.</Badge>}
                {summary.minor > 0 && <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 text-[10px]">{summary.minor} незнач.</Badge>}
                {summary.allergyConflicts > 0 && <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px]">{summary.allergyConflicts} аллерг.</Badge>}
              </div>
            ) : (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px]">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Взаимодействий не выявлено
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      {hasIssues && (
        <CardContent className="space-y-2 pt-0">
          {/* Allergy warnings */}
          {allergyWarnings.length > 0 && (
            <div className="space-y-1.5">
              {allergyWarnings.map((w, i) => (
                <div key={`allergy-${i}`} className={cn("flex items-start gap-2 rounded-md border-l-4 p-2.5", SEV_CONFIG.contraindication.border, SEV_CONFIG.contraindication.bg)}>
                  <ShieldAlert className={cn("mt-0.5 h-4 w-4 shrink-0", SEV_CONFIG.contraindication.color)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{w.medication}</span>
                      <Badge variant="outline" className={cn("text-[9px]", SEV_CONFIG.contraindication.color, "border-rose-500/30")}>Аллергия</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Аллерген: <b>{w.allergen}</b> — {w.reaction} ({w.severity})
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* DDI interactions */}
          {interactions.length > 0 && (
            <div className="space-y-1.5">
              {interactions.map((int, i) => {
                const cfg = SEV_CONFIG[int.severity] ?? SEV_CONFIG.moderate;
                return (
                  <div key={`ddi-${i}`} className={cn("flex items-start gap-2 rounded-md border-l-4 p-2.5", cfg.border, cfg.bg)}>
                    <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.color)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{int.drug1} ↔ {int.drug2}</span>
                        <Badge variant="outline" className={cn("text-[9px]", cfg.color, "border-current/30")}>{cfg.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{int.description}</p>
                      {int.mechanism && <p className="mt-0.5 text-[11px] text-muted-foreground/70">Механизм: {int.mechanism}</p>}
                      {int.management && <p className="mt-0.5 text-[11px] text-muted-foreground/70">Рекомендация: {int.management}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}

      {/* v5.0: Потоковая онлайн-проверка режима пациента в базах РФ */}
      {medications.length >= 2 && (
        <DdiStreamDialog
          open={onlineCheckOpen}
          onOpenChange={setOnlineCheckOpen}
          medications={medications}
          title="Онлайн-проверка схемы фармакотерапии"
        />
      )}
    </Card>
  );
}

function AddMedicationDialog({ open, onOpenChange, patientId, onSubmit, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  patientId: string;
  onSubmit: (d: Record<string, unknown>) => void; loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const [safetyCheck, setSafetyCheck] = React.useState<{
    loading: boolean;
    level: "safe" | "caution" | "major_warning" | "contraindicated" | null;
    allergyAlerts: Array<{ allergen: string; reaction: string; severity: string }>;
    ddiAlerts: Array<{ interactingDrug: string; severity: string; description: string; mechanism: string; management: string }>;
  }>({ loading: false, level: null, allergyAlerts: [], ddiAlerts: [] });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  // v2.5.1: Debounced medication safety check when drugName changes
  React.useEffect(() => {
    if (!v.drugName || v.drugName.trim().length < 3 || !patientId) {
      setSafetyCheck({ loading: false, level: null, allergyAlerts: [], ddiAlerts: [] });
      return;
    }
    setSafetyCheck((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await api.checkMedSafety(patientId, v.drugName);
        setSafetyCheck({
          loading: false,
          level: res.safetyLevel,
          allergyAlerts: res.allergyAlerts,
          ddiAlerts: res.ddiAlerts,
        });
      } catch {
        setSafetyCheck({ loading: false, level: null, allergyAlerts: [], ddiAlerts: [] });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [v.drugName, patientId]);

  const submit = () => {
    onSubmit({
      drugName: v.drugName, brandName: v.brandName, form: v.form || "tablet",
      dosage: v.dosage, route: v.route || "oral", frequency: v.frequency,
      duration: v.duration, startDate: v.startDate || new Date().toISOString().slice(0, 10),
      endDate: v.endDate || undefined, status: "active", indication: v.indication, notes: v.notes,
    });
    setV({});
    setSafetyCheck({ loading: false, level: null, allergyAlerts: [], ddiAlerts: [] });
  };

  const safetyColors: Record<string, { bg: string; text: string; icon: string; label: string }> = {
    safe: { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-700 dark:text-emerald-300", icon: "✓", label: "Безопасно — взаимодействий не выявлено" },
    caution: { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-700 dark:text-amber-300", icon: "⚠", label: "Осторожно — выявлены взаимодействия" },
    major_warning: { bg: "bg-orange-500/10 border-orange-500/30", text: "text-orange-700 dark:text-orange-300", icon: "⚠⚠", label: "Серьёзное предупреждение" },
    contraindicated: { bg: "bg-rose-500/10 border-rose-500/30", text: "text-rose-700 dark:text-rose-300", icon: "✕", label: "ПРОТИВОПОКАЗАНО" },
  };
  const DDI_SEV: Record<string, { label: string; color: string }> = {
    contraindication: { label: "Противопоказано", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
    major: { label: "Серьёзное", color: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
    moderate: { label: "Умеренное", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    minor: { label: "Незначительное", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Pill className="h-5 w-5 text-emerald-600" /> Назначить препарат</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>МНН *</Label>
            <Input value={v.drugName || ""} onChange={(e) => set("drugName", e.target.value)} placeholder="Метформин" />
            {safetyCheck.loading && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Проверка безопасности…
              </p>
            )}
            {!safetyCheck.loading && safetyCheck.level && safetyColors[safetyCheck.level] && (
              <div className={cn("mt-2 rounded-md border px-3 py-2 text-xs", safetyColors[safetyCheck.level].bg, safetyColors[safetyCheck.level].text)}>
                <div className="flex items-center gap-1.5 font-semibold">
                  <span>{safetyColors[safetyCheck.level].icon}</span>
                  <span>{safetyColors[safetyCheck.level].label}</span>
                </div>
                {safetyCheck.allergyAlerts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {safetyCheck.allergyAlerts.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <ShieldAlert className="h-3 w-3 shrink-0" />
                        <span><b>Аллергия:</b> {a.allergen} — {a.reaction} ({a.severity})</span>
                      </div>
                    ))}
                  </div>
                )}
                {safetyCheck.ddiAlerts.length > 0 && (
                  <div className="mt-1 space-y-1.5">
                    {safetyCheck.ddiAlerts.map((d, i) => (
                      <div key={i} className="rounded border border-current/20 px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span><b>{d.interactingDrug}</b> — <Badge variant="outline" className={cn("ml-1 text-[9px]", DDI_SEV[d.severity]?.color)}>{DDI_SEV[d.severity]?.label || d.severity}</Badge></span>
                        </div>
                        <p className="mt-0.5 text-[11px] opacity-90">{d.description}</p>
                        {d.management && <p className="mt-0.5 text-[11px] opacity-75">Рекомендация: {d.management}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div><Label>Торговое название</Label><Input value={v.brandName || ""} onChange={(e) => set("brandName", e.target.value)} placeholder="Глюкофаж" /></div>
          <div>
            <Label>Форма</Label>
            <Select value={v.form || "tablet"} onValueChange={(val) => set("form", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tablet">Таблетки</SelectItem>
                <SelectItem value="capsule">Капсулы</SelectItem>
                <SelectItem value="solution">Раствор</SelectItem>
                <SelectItem value="injection">Инъекция</SelectItem>
                <SelectItem value="ointment">Мазь</SelectItem>
                <SelectItem value="drops">Капли</SelectItem>
                <SelectItem value="inhaler">Ингалятор</SelectItem>
                <SelectItem value="other">Другое</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Дозировка</Label><Input value={v.dosage || ""} onChange={(e) => set("dosage", e.target.value)} placeholder="500 мг" /></div>
          <div>
            <Label>Путь введения</Label>
            <Select value={v.route || "oral"} onValueChange={(val) => set("route", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="oral">Внутрь</SelectItem>
                <SelectItem value="iv">В/в</SelectItem>
                <SelectItem value="im">В/м</SelectItem>
                <SelectItem value="sc">П/к</SelectItem>
                <SelectItem value="topical">Наружно</SelectItem>
                <SelectItem value="inhalation">Ингаляция</SelectItem>
                <SelectItem value="rectal">Ректально</SelectItem>
                <SelectItem value="sublingual">Сублингвально</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Кратность</Label><Input value={v.frequency || ""} onChange={(e) => set("frequency", e.target.value)} placeholder="2 раза в день" /></div>
          <div><Label>Длительность</Label><Input value={v.duration || ""} onChange={(e) => set("duration", e.target.value)} placeholder="7 дней" /></div>
          <div><Label>Дата начала</Label><Input type="date" value={v.startDate || ""} onChange={(e) => set("startDate", e.target.value)} /></div>
          <div><Label>Дата окончания</Label><Input type="date" value={v.endDate || ""} onChange={(e) => set("endDate", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Показание</Label><Input value={v.indication || ""} onChange={(e) => set("indication", e.target.value)} placeholder="Сахарный диабет 2 типа" /></div>
          <div className="sm:col-span-2"><Label>Заметки</Label><Input value={v.notes || ""} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button
            onClick={submit}
            disabled={loading || !v.drugName || safetyCheck.level === "contraindicated"}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {safetyCheck.level === "contraindicated" ? "Противопоказано" : "Назначить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Labs Tab — with trend charts
// ============================================================================
function LabsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [categoryFilter, setCategoryFilter] = React.useState("all");
  const labs = patient.labResults ?? [];
  const filtered = categoryFilter === "all" ? labs : labs.filter((l) => l.category === categoryFilter);

  // Build trend data per test name
  const trendsByTest = React.useMemo(() => {
    const map: Record<string, LabResult[]> = {};
    for (const l of labs) {
      if (l.numericValue == null) continue;
      if (!map[l.testName]) map[l.testName] = [];
      map[l.testName].push(l);
    }
    // sort each by collectedAt asc
    Object.values(map).forEach(arr => arr.sort((a, b) => new Date(a.collectedAt).getTime() - new Date(b.collectedAt).getTime()));
    return map;
  }, [labs]);

  const trendTests = Object.keys(trendsByTest).filter(n => trendsByTest[n].length >= 2).slice(0, 4);

  const addMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.addLabResult(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("Результат анализа добавлен");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const abnormalCount = labs.filter(l => l.flag !== "normal").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Лабораторные исследования</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Добавить
        </Button>
      </div>

      {abnormalCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span>Обнаружено <b>{abnormalCount}</b> отклонений от нормы</span>
        </div>
      )}

      {/* Trend charts */}
      {trendTests.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {trendTests.map(testName => {
            const data = trendsByTest[testName].map(l => ({
              date: new Date(l.collectedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
              value: l.numericValue as number,
              unit: l.unit,
            }));
            const first = trendsByTest[testName][0];
            const refLow = first.refRangeLow;
            const refHigh = first.refRangeHigh;
            return (
              <Card key={testName}>
                <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-violet-500" /> {testName}</span>
                  <span className="text-xs font-normal text-muted-foreground">{first.unit}</span>
                </CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={[(refLow ?? 0) * 0.7, (refHigh ?? 100) * 1.3]} />
                      <RTooltip />
                      {refLow != null && <ReferenceLine y={refLow} stroke="#10b981" strokeDasharray="4 4" label="norm" />}
                      {refHigh != null && <ReferenceLine y={refHigh} stroke="#10b981" strokeDasharray="4 4" />}
                      <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Результаты ({filtered.length})</CardTitle>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все категории</SelectItem>
                <SelectItem value="hematology">Гематология</SelectItem>
                <SelectItem value="biochemistry">Биохимия</SelectItem>
                <SelectItem value="electrolytes">Электролиты</SelectItem>
                <SelectItem value="lipids">Липиды</SelectItem>
                <SelectItem value="endocrinology">Эндокринология</SelectItem>
                <SelectItem value="coagulation">Коагулология</SelectItem>
                <SelectItem value="immunology">Иммунология</SelectItem>
                <SelectItem value="urinalysis">Моча</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Дата</th>
                  <th className="p-2">Показатель</th>
                  <th className="p-2">Значение</th>
                  <th className="p-2">Норма</th>
                  <th className="p-2">Флаг</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2 text-xs">{fmtDate(l.collectedAt)}</td>
                    <td className="p-2">
                      <div className="font-medium">{l.testName}</div>
                      <div className="text-[10px] text-muted-foreground">{l.category}</div>
                    </td>
                    <td className="p-2 font-mono">
                      <span className={cn(l.flag !== "normal" && "font-bold", l.flag === "critical" && "text-rose-600", l.flag === "high" && "text-amber-600", l.flag === "low" && "text-sky-600")}>
                        {l.value}
                      </span>
                      <span className="ml-1 text-[10px] text-muted-foreground">{l.unit}</span>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {l.refRangeLow != null && l.refRangeHigh != null ? `${l.refRangeLow}–${l.refRangeHigh}` : "—"}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={cn("text-[10px]", LAB_FLAG[l.flag]?.color)}>{LAB_FLAG[l.flag]?.label || l.flag}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AddLabDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={(d) => addMut.mutate(d)} loading={addMut.isPending} />
    </div>
  );
}

function AddLabDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  onSubmit: (d: Record<string, unknown>) => void; loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const submit = () => {
    onSubmit({
      testName: v.testName, category: v.category || "general", value: v.value,
      numericValue: v.numericValue || undefined, unit: v.unit,
      refRangeLow: v.refRangeLow || undefined, refRangeHigh: v.refRangeHigh || undefined,
      method: v.method, specimen: v.specimen, collectedAt: v.collectedAt || new Date().toISOString().slice(0, 10),
      labName: v.labName, notes: v.notes,
    });
    setV({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-violet-600" /> Добавить результат</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Название показателя *</Label><Input value={v.testName || ""} onChange={(e) => set("testName", e.target.value)} placeholder="Гемоглобин" /></div>
          <div>
            <Label>Категория</Label>
            <Select value={v.category || "general"} onValueChange={(val) => set("category", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Общая</SelectItem>
                <SelectItem value="hematology">Гематология</SelectItem>
                <SelectItem value="biochemistry">Биохимия</SelectItem>
                <SelectItem value="electrolytes">Электролиты</SelectItem>
                <SelectItem value="lipids">Липиды</SelectItem>
                <SelectItem value="endocrinology">Эндокринология</SelectItem>
                <SelectItem value="coagulation">Коагулология</SelectItem>
                <SelectItem value="immunology">Иммунология</SelectItem>
                <SelectItem value="urinalysis">Моча</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Значение *</Label><Input value={v.value || ""} onChange={(e) => set("value", e.target.value)} placeholder="140" /></div>
          <div><Label>Числовое значение</Label><Input type="number" step="0.001" value={v.numericValue || ""} onChange={(e) => set("numericValue", e.target.value)} placeholder="140" /></div>
          <div><Label>Единица</Label><Input value={v.unit || ""} onChange={(e) => set("unit", e.target.value)} placeholder="г/л" /></div>
          <div><Label>Норма ниж.</Label><Input type="number" step="0.001" value={v.refRangeLow || ""} onChange={(e) => set("refRangeLow", e.target.value)} placeholder="120" /></div>
          <div><Label>Норма верх.</Label><Input type="number" step="0.001" value={v.refRangeHigh || ""} onChange={(e) => set("refRangeHigh", e.target.value)} placeholder="160" /></div>
          <div><Label>Метод</Label><Input value={v.method || ""} onChange={(e) => set("method", e.target.value)} placeholder="Циангемоглобин" /></div>
          <div><Label>Биоматериал</Label><Input value={v.specimen || ""} onChange={(e) => set("specimen", e.target.value)} placeholder="Кровь" /></div>
          <div><Label>Дата взятия</Label><Input type="date" value={v.collectedAt || ""} onChange={(e) => set("collectedAt", e.target.value)} /></div>
          <div><Label>Лаборатория</Label><Input value={v.labName || ""} onChange={(e) => set("labName", e.target.value)} placeholder="Инвитро" /></div>
          <div className="sm:col-span-2"><Label>Заметки</Label><Input value={v.notes || ""} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading || !v.testName || !v.value} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// ОБСЛЕДОВАНИЯ (v4.1) — Examinations Tab: registry + lifecycle management
// ============================================================================
const EXAM_TYPE_CONFIG: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  laboratory: { label: "Лабораторное", icon: FlaskConical, color: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  instrumental: { label: "Инструментальное", icon: Activity, color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  consultation: { label: "Консультация", icon: Users, color: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  functional: { label: "Функциональное", icon: HeartPulse, color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  radiology: { label: "Лучевое", icon: Scan, color: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
  endoscopy: { label: "Эндоскопическое", icon: Camera, color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  morphological: { label: "Морфологическое", icon: Microscope, color: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
  other: { label: "Прочее", icon: CircleDot, color: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};

const EXAM_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ordered: { label: "Назначено", color: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  scheduled: { label: "Запланировано", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  in_progress: { label: "Проводится", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  completed: { label: "Проведено", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Отменено", color: "bg-muted text-muted-foreground border-muted-foreground/20" },
};

const EXAM_PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  routine: { label: "Рутинно", color: "bg-muted text-muted-foreground border-muted-foreground/20" },
  urgent: { label: "Срочно", color: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30" },
  stat: { label: "CITO!", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" },
};

const EXAM_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "ordered", label: "Назначено" },
  { value: "scheduled", label: "Запланировано" },
  { value: "in_progress", label: "Проводится" },
  { value: "completed", label: "Проведено" },
  { value: "cancelled", label: "Отменено" },
];

const EXAM_TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Все типы" },
  { value: "laboratory", label: "Лабораторные" },
  { value: "instrumental", label: "Инструментальные" },
  { value: "consultation", label: "Консультации" },
  { value: "functional", label: "Функциональные" },
  { value: "radiology", label: "Лучевые" },
  { value: "endoscopy", label: "Эндоскопические" },
  { value: "morphological", label: "Морфологические" },
  { value: "other", label: "Прочие" },
];

// Допустимые быстрые переходы статусов (жизненный цикл обследования)
const EXAM_STATUS_TRANSITIONS: Record<string, Array<{ value: string; label: string }>> = {
  ordered: [
    { value: "scheduled", label: "Запланировать" },
    { value: "in_progress", label: "Начать проведение" },
  ],
  scheduled: [
    { value: "in_progress", label: "Начать проведение" },
    { value: "completed", label: "Отметить проведённым" },
  ],
  in_progress: [
    { value: "completed", label: "Отметить проведённым" },
  ],
};

/** GET /patients/[id]/examinations возвращает resultData JSON-строкой — приводим к массиву. */
function parseExamResultData(raw: unknown): ExaminationResultParam[] {
  if (Array.isArray(raw)) return raw as ExaminationResultParam[];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as ExaminationResultParam[]) : [];
    } catch { return []; }
  }
  return [];
}

function isExamOverdue(e: Examination): boolean {
  return (e.status === "ordered" || e.status === "scheduled") &&
    e.scheduledAt != null && new Date(e.scheduledAt).getTime() < Date.now();
}

function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ExamCreatePayload = Parameters<typeof api.createExamination>[1];
type ExamUpdatePayload = Parameters<typeof api.updateExamination>[1];

function ExaminationsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const currentDoctor = useAppStore((s) => s.currentDoctor);
  const canDelete = currentDoctor?.role === "admin" || currentDoctor?.role === "head";

  const [statusFilter, setStatusFilter] = React.useState("all");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [view, setView] = React.useState<"cards" | "table">("cards");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [resultExam, setResultExam] = React.useState<Examination | null>(null);
  const [cancelExam, setCancelExam] = React.useState<Examination | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [deleteExam, setDeleteExam] = React.useState<Examination | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["examinations", patient.id],
    queryFn: () => api.getExaminations(patient.id),
  });

  const examinations = data?.examinations ?? [];
  const stats: ExaminationStats | undefined = data?.stats;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["examinations", patient.id] });
    qc.invalidateQueries({ queryKey: ["patient", patient.id] });
  };

  const createMut = useMutation({
    mutationFn: (data: ExamCreatePayload) => api.createExamination(patient.id, data),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      toast.success("Обследование назначено");
    },
    onError: (e: Error) => toast.error("Ошибка назначения: " + e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateExamination(id, { status }),
    onSuccess: (_res, vars) => {
      invalidate();
      toast.success(`Статус изменён: «${EXAM_STATUS_CONFIG[vars.status]?.label ?? vars.status}»`);
    },
    onError: (e: Error) => toast.error("Ошибка смены статуса: " + e.message),
  });

  const resultMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExamUpdatePayload }) => api.updateExamination(id, data),
    onSuccess: () => {
      invalidate();
      setResultExam(null);
      toast.success("Результат сохранён");
    },
    onError: (e: Error) => toast.error("Ошибка сохранения результата: " + e.message),
  });

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.updateExamination(id, { status: "cancelled", cancelReason: reason }),
    onSuccess: () => {
      invalidate();
      setCancelExam(null);
      setCancelReason("");
      toast.success("Обследование отменено");
    },
    onError: (e: Error) => toast.error("Ошибка отмены: " + e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteExamination(id),
    onSuccess: () => {
      invalidate();
      setDeleteExam(null);
      toast.success("Обследование удалено");
    },
    onError: (e: Error) => toast.error("Ошибка удаления: " + e.message),
  });

  // Фильтрация (клиентская, чтобы не дёргать API на каждый чих)
  const filtered = React.useMemo(() => {
    return examinations.filter((e) =>
      (statusFilter === "all" || e.status === statusFilter) &&
      (typeFilter === "all" || e.examType === typeFilter),
    );
  }, [examinations, statusFilter, typeFilter]);

  // Группировка: активные → проведённые → отменённые (внутри — по дате назначения, новые сверху)
  const groups = React.useMemo(() => {
    const byDate = (a: Examination, b: Examination) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime();
    return [
      {
        key: "active",
        label: "Активные",
        items: filtered.filter((e) => e.status === "ordered" || e.status === "scheduled" || e.status === "in_progress").sort(byDate),
      },
      {
        key: "completed",
        label: "Проведены",
        items: filtered.filter((e) => e.status === "completed").sort((a, b) =>
          new Date(b.completedAt ?? b.orderedAt).getTime() - new Date(a.completedAt ?? a.orderedAt).getTime()),
      },
      {
        key: "cancelled",
        label: "Отменены",
        items: filtered.filter((e) => e.status === "cancelled").sort(byDate),
      },
    ].filter((g) => g.items.length > 0);
  }, [filtered]);

  const statCards = stats
    ? [
        { label: "Всего", value: stats.total, tone: "" },
        { label: "Назначено", value: stats.ordered, tone: "" },
        { label: "Ожидают", value: stats.scheduled + stats.inProgress, tone: "" },
        { label: "Проведено", value: stats.completed, tone: "emerald" },
        { label: "Отменено", value: stats.cancelled, tone: "" },
        { label: "Отклонения", value: stats.abnormal, tone: stats.abnormal > 0 ? "rose" : "" },
        { label: "Просрочено", value: stats.overdue, tone: stats.overdue > 0 ? "amber" : "" },
        { label: "Срочные", value: stats.urgent, tone: stats.urgent > 0 ? "rose" : "" },
      ]
    : [];

  const openCancel = (e: Examination) => {
    setCancelReason("");
    setCancelExam(e);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Microscope className="h-4 w-4 text-teal-600" /> Обследования
          </h3>
          <p className="text-xs text-muted-foreground">
            Реестр назначенных обследований: жизненный цикл, результаты и связь с КР Минздрава РФ
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
        >
          <Plus className="h-4 w-4" /> Назначить обследование
        </Button>
      </div>

      {/* Stats row */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {statCards.map((s) => (
            <div
              key={s.label}
              className={cn(
                "rounded-lg border px-3 py-2",
                s.tone === "rose" && "border-rose-500/40 bg-rose-500/5",
                s.tone === "amber" && "border-amber-500/40 bg-amber-500/5",
                s.tone === "emerald" && "border-emerald-500/40 bg-emerald-500/5",
              )}
            >
              <div className={cn(
                "text-xl font-bold leading-tight tabular-nums",
                s.tone === "rose" && "text-rose-600 dark:text-rose-400",
                s.tone === "amber" && "text-amber-600 dark:text-amber-400",
                s.tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
              )}>{s.value}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar: filters + view toggle */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXAM_STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-56">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXAM_TYPE_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 self-start rounded-lg border bg-muted/30 p-0.5 sm:ml-auto">
          <button
            type="button"
            onClick={() => setView("cards")}
            aria-label="Карточки"
            className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-colors", view === "cards" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            aria-label="Таблица"
            className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-colors", view === "table" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Registry */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Microscope className="mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">Обследования не найдены</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Назначьте первое обследование или измените фильтры</p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              {view === "cards" ? (
                groups.map((g) => (
                  <div key={g.key}>
                    <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      {g.label}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{g.items.length}</span>
                    </div>
                    {g.items.map((e) => (
                      <ExamRowCard
                        key={e.id}
                        exam={e}
                        canDelete={canDelete}
                        onStatus={(status) => statusMut.mutate({ id: e.id, status })}
                        onResult={() => setResultExam(e)}
                        onCancel={() => openCancel(e)}
                        onDelete={() => setDeleteExam(e)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="p-2.5">Обследование</th>
                      <th className="p-2.5">Тип</th>
                      <th className="p-2.5">Статус</th>
                      <th className="p-2.5">Приоритет</th>
                      <th className="p-2.5">Назначено</th>
                      <th className="p-2.5">План</th>
                      <th className="p-2.5">Выполнено</th>
                      <th className="p-2.5 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <React.Fragment key={g.key}>
                        <tr className="bg-muted/30">
                          <td colSpan={8} className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {g.label} ({g.items.length})
                          </td>
                        </tr>
                        {g.items.map((e) => (
                          <ExamTableRow
                            key={e.id}
                            exam={e}
                            canDelete={canDelete}
                            onStatus={(status) => statusMut.mutate({ id: e.id, status })}
                            onResult={() => setResultExam(e)}
                            onCancel={() => openCancel(e)}
                            onDelete={() => setDeleteExam(e)}
                          />
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateExaminationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(d) => createMut.mutate(d)}
        loading={createMut.isPending}
      />

      <ResultExaminationDialog
        exam={resultExam}
        open={!!resultExam}
        onOpenChange={(o) => !o && setResultExam(null)}
        onSubmit={(data) => resultExam && resultMut.mutate({ id: resultExam.id, data })}
        loading={resultMut.isPending}
      />

      {/* Отмена обследования */}
      <AlertDialog open={!!cancelExam} onOpenChange={(o) => { if (!o) { setCancelExam(null); setCancelReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-amber-600" /> Отменить обследование?
            </AlertDialogTitle>
            <AlertDialogDescription>
              «{cancelExam?.name}» будет переведено в статус «Отменено». Причина будет сохранена в заметках.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label>Причина отмены</Label>
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Например: пациент отказался / обследование неактуально"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Не отменять</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                if (cancelExam) cancelMut.mutate({ id: cancelExam.id, reason: cancelReason });
              }}
              disabled={cancelMut.isPending}
              className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
            >
              {cancelMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Отменить обследование
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Удаление (только admin/head) */}
      <AlertDialog open={!!deleteExam} onOpenChange={(o) => !o && setDeleteExam(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-rose-600" /> Удалить обследование?
            </AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteExam?.name}» будет удалено безвозвратно вместе с результатами. Действие доступно только администратору и заведующему отделением.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                if (deleteExam) deleteMut.mutate(deleteExam.id);
              }}
              disabled={deleteMut.isPending}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Бейдж кликабельной ссылки на официальную КР Минздрава. */
function ClinrecBadge({ exam }: { exam: Examination }) {
  if (!exam.clinrecCodeVersion) return null;
  return (
    <a
      href={`https://cr.minzdrav.gov.ru/view-cr/${exam.clinrecCodeVersion}`}
      target="_blank"
      rel="noopener noreferrer"
      title={exam.clinrecName || exam.clinrecCodeVersion}
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
    >
      <Badge className="gap-1 border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300">
        <Landmark className="h-3 w-3" /> КР Минздрава {exam.clinrecCodeVersion}
      </Badge>
    </a>
  );
}

/** Мини-пилюля параметра результата с референсным интервалом. */
function ExamParamPill({ p }: { p: ExaminationResultParam }) {
  const flagCls =
    p.flag === "low" ? "text-sky-600 dark:text-sky-400"
    : p.flag === "high" ? "text-amber-600 dark:text-amber-400"
    : p.flag === "critical" ? "text-rose-600 dark:text-rose-400"
    : p.flag === "abnormal" ? "text-violet-600 dark:text-violet-400"
    : "text-foreground";
  const hasRef = p.refLow != null || p.refHigh != null;
  return (
    <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]">
      {p.parameter}: <b className={flagCls}>{String(p.value)}</b>
      {p.unit ? ` ${p.unit}` : ""}
      {hasRef && (
        <span className="text-muted-foreground">
          {" "}({p.refLow != null ? p.refLow : "−"}–{p.refHigh != null ? p.refHigh : "−"})
        </span>
      )}
    </span>
  );
}

/** Меню действий над обследованием (статусы, результат, отмена, удаление). */
function ExamActionsMenu({
  exam, canDelete, onStatus, onResult, onCancel, onDelete,
}: {
  exam: Examination;
  canDelete: boolean;
  onStatus: (status: string) => void;
  onResult: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const transitions = EXAM_STATUS_TRANSITIONS[exam.status] ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Действия с обследованием">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {transitions.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide">Изменить статус</DropdownMenuLabel>
            {transitions.map((t) => (
              <DropdownMenuItem key={t.value} onClick={() => onStatus(t.value)}>
                <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> {t.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuItem onClick={onResult} disabled={exam.status === "cancelled"}>
          <ClipboardList className="mr-2 h-3.5 w-3.5" /> Внести результат
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {exam.status !== "cancelled" && (
          <DropdownMenuItem onClick={onCancel} className="text-amber-600 focus:text-amber-700">
            <Ban className="mr-2 h-3.5 w-3.5" /> Отменить обследование
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem onClick={onDelete} className="text-rose-600 focus:text-rose-700">
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Карточка обследования (вид «Карточки»). */
function ExamRowCard({
  exam, canDelete, onStatus, onResult, onCancel, onDelete,
}: {
  exam: Examination;
  canDelete: boolean;
  onStatus: (status: string) => void;
  onResult: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const t = EXAM_TYPE_CONFIG[exam.examType] ?? EXAM_TYPE_CONFIG.other;
  const TypeIcon = t.icon;
  const st = EXAM_STATUS_CONFIG[exam.status] ?? EXAM_STATUS_CONFIG.ordered;
  const pr = EXAM_PRIORITY_CONFIG[exam.priority] ?? EXAM_PRIORITY_CONFIG.routine;
  const overdue = isExamOverdue(exam);
  const resultData = parseExamResultData(exam.resultData);

  return (
    <div className="flex items-start gap-3 border-b p-3 pl-4 transition-colors last:border-0 hover:bg-muted/30">
      <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", t.color)}>
        <TypeIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{exam.name}</span>
          {exam.code && <span className="font-mono text-[10px] text-muted-foreground">{exam.code}</span>}
          <Badge variant="outline" className={cn("text-[10px]", st.color)}>{st.label}</Badge>
          {exam.priority !== "routine" && (
            <Badge variant="outline" className={cn("text-[10px] font-semibold", pr.color)}>{pr.label}</Badge>
          )}
          {exam.isAbnormal && (
            <Badge variant="outline" className="gap-1 border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-3 w-3" /> Отклонение
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px] font-normal">{t.label}</Badge>
          {exam.modality && <span>{exam.modality}</span>}
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> назначено {fmtDate(exam.orderedAt)}</span>
          {exam.scheduledAt && (
            <span className={cn("flex items-center gap-1", overdue && "font-semibold text-rose-600 dark:text-rose-400")}>
              <CalendarClock className="h-3 w-3" /> план {fmtDateTime(exam.scheduledAt)}{overdue ? " · просрочено" : ""}
            </span>
          )}
          {exam.completedAt && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> выполнено {fmtDateTime(exam.completedAt)}
            </span>
          )}
          {exam.performedAt && <span>{exam.performedAt}</span>}
          {exam.orderedByName && <span>врач: {exam.orderedByName}</span>}
        </div>
        {exam.indication && (
          <p className="text-xs text-muted-foreground">
            Показание: {exam.indication}{exam.icd10 ? ` (МКБ-10: ${exam.icd10})` : ""}
          </p>
        )}
        {exam.status === "completed" && exam.resultValue && (
          <p className="line-clamp-1 text-xs">
            <FileText className="mr-1 inline h-3 w-3 text-emerald-600" />
            {exam.resultValue}
          </p>
        )}
        {exam.status === "completed" && exam.interpretation && (
          <p className="line-clamp-1 text-xs text-muted-foreground">Интерпретация: {exam.interpretation}</p>
        )}
        {resultData.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {resultData.map((p, i) => <ExamParamPill key={i} p={p} />)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <ClinrecBadge exam={exam} />
        </div>
      </div>
      <ExamActionsMenu
        exam={exam}
        canDelete={canDelete}
        onStatus={onStatus}
        onResult={onResult}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    </div>
  );
}

/** Строка таблицы обследований (вид «Таблица»). */
function ExamTableRow({
  exam, canDelete, onStatus, onResult, onCancel, onDelete,
}: {
  exam: Examination;
  canDelete: boolean;
  onStatus: (status: string) => void;
  onResult: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const t = EXAM_TYPE_CONFIG[exam.examType] ?? EXAM_TYPE_CONFIG.other;
  const st = EXAM_STATUS_CONFIG[exam.status] ?? EXAM_STATUS_CONFIG.ordered;
  const pr = EXAM_PRIORITY_CONFIG[exam.priority] ?? EXAM_PRIORITY_CONFIG.routine;
  const overdue = isExamOverdue(exam);

  return (
    <tr className="border-b transition-colors last:border-0 hover:bg-muted/30">
      <td className="p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="max-w-[220px] truncate font-medium" title={exam.name}>{exam.name}</span>
          {exam.isAbnormal && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Отклонение" />}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {exam.modality && <span>{exam.modality}</span>}
          {exam.code && <span className="font-mono">{exam.code}</span>}
          {exam.clinrecCodeVersion && <span className="font-mono text-emerald-600">КР {exam.clinrecCodeVersion}</span>}
        </div>
      </td>
      <td className="p-2.5">
        <Badge variant="secondary" className="text-[10px] font-normal">{t.label}</Badge>
      </td>
      <td className="p-2.5">
        <Badge variant="outline" className={cn("text-[10px]", st.color)}>{st.label}</Badge>
      </td>
      <td className="p-2.5">
        {exam.priority !== "routine" ? (
          <Badge variant="outline" className={cn("text-[10px] font-semibold", pr.color)}>{pr.label}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{pr.label}</span>
        )}
      </td>
      <td className="p-2.5 text-xs text-muted-foreground">{fmtDate(exam.orderedAt)}</td>
      <td className="p-2.5 text-xs">
        {exam.scheduledAt ? (
          <span className={cn(overdue && "font-semibold text-rose-600 dark:text-rose-400")}>
            {fmtDateTime(exam.scheduledAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-2.5 text-xs text-muted-foreground">{fmtDate(exam.completedAt)}</td>
      <td className="p-2.5 text-right">
        <ExamActionsMenu
          exam={exam}
          canDelete={canDelete}
          onStatus={onStatus}
          onResult={onResult}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}

// ============================================================================
// Назначить обследование — диалог с поиском КР Минздрава
// ============================================================================
function CreateExaminationDialog({
  open, onOpenChange, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (d: ExamCreatePayload) => void;
  loading: boolean;
}) {
  const [name, setName] = React.useState("");
  const [examType, setExamType] = React.useState("laboratory");
  const [modality, setModality] = React.useState("");
  const [code, setCode] = React.useState("");
  const [priority, setPriority] = React.useState("routine");
  const [indication, setIndication] = React.useState("");
  const [icd10, setIcd10] = React.useState("");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [performedAt, setPerformedAt] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [crQuery, setCrQuery] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [selectedCr, setSelectedCr] = React.useState<ClinrecMatch | null>(null);

  // Debounce поискового запроса КР
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(crQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [crQuery]);

  // Сброс формы при закрытии
  React.useEffect(() => {
    if (!open) {
      setName(""); setExamType("laboratory"); setModality(""); setCode("");
      setPriority("routine"); setIndication(""); setIcd10(""); setScheduledAt("");
      setPerformedAt(""); setNotes(""); setCrQuery(""); setDebouncedQ(""); setSelectedCr(null);
    }
  }, [open]);

  const { data: crData, isFetching: crFetching } = useQuery({
    queryKey: ["clinrec-search", debouncedQ],
    queryFn: () => api.searchMinzdravClinrecs({ q: debouncedQ, pageSize: 8 }),
    enabled: open && debouncedQ.length >= 3,
    staleTime: 120000,
  });
  const crResults = crData?.results ?? [];

  const submit = () => {
    onSubmit({
      name: name.trim(),
      examType,
      modality: modality.trim(),
      code: code.trim(),
      priority,
      indication: indication.trim(),
      icd10: icd10.trim().toUpperCase(),
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      performedAt: performedAt.trim(),
      clinrecCodeVersion: selectedCr?.codeVersion ?? "",
      clinrecName: selectedCr?.name ?? "",
      clinrecMkb: selectedCr?.mkbString ?? "",
      notes: notes.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Microscope className="h-5 w-5 text-teal-600" /> Назначить обследование
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Название обследования *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: МРТ головного мозга с контрастом"
            />
          </div>
          <div>
            <Label>Тип</Label>
            <Select value={examType} onValueChange={setExamType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXAM_TYPE_FILTERS.filter((f) => f.value !== "all").map((f) => (
                  <SelectItem key={f.value} value={f.value}>{EXAM_TYPE_CONFIG[f.value].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Приоритет</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="routine">Рутинно</SelectItem>
                <SelectItem value="urgent">Срочно</SelectItem>
                <SelectItem value="stat">CITO!</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Модальность</Label>
            <Input value={modality} onChange={(e) => setModality(e.target.value)} placeholder="УЗИ, КТ, МРТ, ЭКГ…" />
          </div>
          <div>
            <Label>Код (ОМС / LOINC)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1.2.643… / 2160-0" />
          </div>
          <div>
            <Label>Плановая дата и время</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Если указана — статус «Запланировано»</p>
          </div>
          <div>
            <Label>Место проведения</Label>
            <Input value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} placeholder="Клиника / отделение" />
          </div>
          <div>
            <Label>МКБ-10 показания</Label>
            <Input
              value={icd10}
              onChange={(e) => setIcd10(e.target.value.toUpperCase())}
              placeholder="I10"
              className="font-mono uppercase"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Показание / клиническая задача</Label>
            <Textarea
              value={indication}
              onChange={(e) => setIndication(e.target.value)}
              placeholder="Например: исключить объёмное образование; контроль на фоне терапии…"
              rows={2}
            />
          </div>

          {/* Привязка КР Минздрава */}
          <div className="sm:col-span-2 space-y-2">
            <Label className="flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5 text-emerald-600" /> Привязать КР Минздрава
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={crQuery}
                onChange={(e) => setCrQuery(e.target.value)}
                placeholder="Поиск по официальным клиническим рекомендациям (мин. 3 символа)…"
                className="pl-9"
              />
              {crFetching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            {selectedCr && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-2">{selectedCr.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                      <span className="font-mono">КР {selectedCr.codeVersion}</span>
                      {selectedCr.mkbString && <span>МКБ: {selectedCr.mkbString}</span>}
                      {selectedCr.npcApproved && <span>Одобрена НПК</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0"
                    onClick={() => setSelectedCr(null)}
                    aria-label="Отвязать КР"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            {debouncedQ.length >= 3 && (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-1">
                {crFetching ? (
                  <div className="space-y-1.5 p-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : crResults.length > 0 ? (
                  crResults.map((cr) => {
                    const selected = selectedCr?.codeVersion === cr.codeVersion;
                    return (
                      <button
                        key={cr.codeVersion}
                        type="button"
                        onClick={() => setSelectedCr(selected ? null : cr)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/60",
                          selected ? "border-emerald-500/50 bg-emerald-500/10" : "border-transparent",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                            selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40",
                          )}
                          aria-hidden
                        >
                          {selected && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-medium leading-snug">{cr.name}</span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            <span className="font-mono">{cr.codeVersion}</span>
                            {cr.mkbString ? ` · МКБ ${cr.mkbString}` : ""}
                            {cr.ageCategory ? ` · ${cr.ageCategory}` : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    Клинические рекомендации не найдены. Проверьте запрос.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <Label>Заметки</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Подготовка, условия проведения, доп. информация"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button
            onClick={submit}
            disabled={loading || !name.trim()}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Назначить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Внести результат — диалог (переход к completed + параметры с референсами)
// ============================================================================
type ResultParamDraft = {
  parameter: string;
  value: string;
  unit: string;
  refLow: string;
  refHigh: string;
};

function computeParamFlag(p: ResultParamDraft): "low" | "high" | "normal" | null {
  if (p.value.trim() === "") return null;
  const num = parseFloat(p.value.replace(",", "."));
  if (Number.isNaN(num)) return null;
  const low = p.refLow.trim() !== "" ? parseFloat(p.refLow) : NaN;
  const high = p.refHigh.trim() !== "" ? parseFloat(p.refHigh) : NaN;
  if (!Number.isNaN(low) && num < low) return "low";
  if (!Number.isNaN(high) && num > high) return "high";
  return "normal";
}

function ResultExaminationDialog({
  exam, open, onOpenChange, onSubmit, loading,
}: {
  exam: Examination | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (d: ExamUpdatePayload) => void;
  loading: boolean;
}) {
  const [status, setStatus] = React.useState("completed");
  const [resultValue, setResultValue] = React.useState("");
  const [params, setParams] = React.useState<ResultParamDraft[]>([]);
  const [interpretation, setInterpretation] = React.useState("");
  const [conclusion, setConclusion] = React.useState("");
  const [completedAt, setCompletedAt] = React.useState("");
  const [manualAbnormal, setManualAbnormal] = React.useState<boolean | null>(null);

  // Инициализация формы при открытии
  React.useEffect(() => {
    if (open && exam) {
      setStatus("completed");
      setResultValue(exam.resultValue || "");
      const existing = parseExamResultData(exam.resultData);
      setParams(existing.map((p) => ({
        parameter: p.parameter || "",
        value: String(p.value ?? ""),
        unit: p.unit || "",
        refLow: p.refLow != null ? String(p.refLow) : "",
        refHigh: p.refHigh != null ? String(p.refHigh) : "",
      })));
      setInterpretation(exam.interpretation || "");
      setConclusion(exam.conclusion || "");
      setCompletedAt(toLocalDateTimeInput(new Date()));
      setManualAbnormal(null);
    }
  }, [open, exam]);

  const setParam = (i: number, field: keyof ResultParamDraft, value: string) => {
    setParams((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  };
  const addParam = () => setParams((prev) => [...prev, { parameter: "", value: "", unit: "", refLow: "", refHigh: "" }]);
  const removeParam = (i: number) => setParams((prev) => prev.filter((_, idx) => idx !== i));

  const autoAbnormal = params.some((p) => {
    const f = computeParamFlag(p);
    return f === "low" || f === "high";
  });
  const effectiveAbnormal = manualAbnormal ?? autoAbnormal;

  const submit = () => {
    const resultData: ExaminationResultParam[] = params
      .filter((p) => p.parameter.trim() !== "" || p.value.trim() !== "")
      .map((p) => {
        const num = parseFloat(p.value.replace(",", "."));
        const low = p.refLow.trim() !== "" && !Number.isNaN(parseFloat(p.refLow)) ? parseFloat(p.refLow) : null;
        const high = p.refHigh.trim() !== "" && !Number.isNaN(parseFloat(p.refHigh)) ? parseFloat(p.refHigh) : null;
        return {
          parameter: p.parameter.trim(),
          value: p.value.trim() !== "" && !Number.isNaN(num) ? num : p.value.trim(),
          unit: p.unit.trim() || undefined,
          refLow: low,
          refHigh: high,
          flag: computeParamFlag(p) ?? "normal",
        };
      });

    const payload: ExamUpdatePayload = {
      status,
      resultValue,
      resultData,
      interpretation,
      conclusion,
      completedAt: status === "completed" ? new Date(completedAt || Date.now()).toISOString() : null,
    };
    if (manualAbnormal !== null) payload.isAbnormal = manualAbnormal;
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-emerald-600" /> Результат обследования
          </DialogTitle>
        </DialogHeader>
        {exam && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
            <span className="font-medium">{exam.name}</span>
            <span className="ml-2 text-muted-foreground">
              {EXAM_TYPE_CONFIG[exam.examType]?.label}
              {exam.modality ? ` · ${exam.modality}` : ""}
              {exam.clinrecCodeVersion ? ` · КР ${exam.clinrecCodeVersion}` : ""}
            </span>
          </div>
        )}
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Итоговый статус</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Проведено</SelectItem>
                  <SelectItem value="in_progress">Проводится</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Дата и время выполнения</Label>
              <Input type="datetime-local" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Заключение / итоговое значение</Label>
            <Textarea
              value={resultValue}
              onChange={(e) => setResultValue(e.target.value)}
              placeholder="Например: без патологических изменений; ФВ ЛЖ 58%…"
              rows={2}
            />
          </div>

          {/* Редактор параметров результата */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Параметры результата (с референсными интервалами)</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addParam}>
                <Plus className="h-3 w-3" /> Добавить параметр
              </Button>
            </div>
            {params.length === 0 && (
              <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                Добавьте измеримые показатели — например: гемоглобин / 135 / г/л / 120–160
              </p>
            )}
            {params.map((p, i) => {
              const flag = computeParamFlag(p);
              return (
                <div key={i} className="grid grid-cols-12 items-center gap-1.5 rounded-md border bg-muted/20 p-2">
                  <Input
                    className="col-span-12 h-8 border-0 bg-transparent text-xs font-medium shadow-none focus-visible:ring-1 sm:col-span-3"
                    placeholder="Показатель"
                    value={p.parameter}
                    onChange={(e) => setParam(i, "parameter", e.target.value)}
                  />
                  <Input
                    className="col-span-4 h-8 border-0 bg-transparent text-xs shadow-none focus-visible:ring-1 sm:col-span-2"
                    placeholder="Значение"
                    value={p.value}
                    onChange={(e) => setParam(i, "value", e.target.value)}
                  />
                  <Input
                    className="col-span-3 h-8 border-0 bg-transparent text-xs shadow-none focus-visible:ring-1 sm:col-span-2"
                    placeholder="Ед."
                    value={p.unit}
                    onChange={(e) => setParam(i, "unit", e.target.value)}
                  />
                  <Input
                    className="col-span-2 h-8 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-1 sm:col-span-2"
                    type="number"
                    step="any"
                    placeholder="Норма ↓"
                    value={p.refLow}
                    onChange={(e) => setParam(i, "refLow", e.target.value)}
                  />
                  <Input
                    className="col-span-2 h-8 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-1 sm:col-span-2"
                    type="number"
                    step="any"
                    placeholder="Норма ↑"
                    value={p.refHigh}
                    onChange={(e) => setParam(i, "refHigh", e.target.value)}
                  />
                  <div className="col-span-1 flex items-center justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600"
                      onClick={() => removeParam(i)}
                      aria-label="Удалить параметр"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {flag && (
                    <div className="col-span-12">
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          flag === "low" && "text-sky-600 dark:text-sky-400",
                          flag === "high" && "text-amber-600 dark:text-amber-400",
                          flag === "normal" && "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {flag === "low" ? "↓ ниже нормы" : flag === "high" ? "↑ выше нормы" : "✓ в пределах нормы"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label className="text-xs">Отклонение от нормы</Label>
              <p className="text-[10px] text-muted-foreground">
                {manualAbnormal === null
                  ? autoAbnormal
                    ? "Автоматически: есть параметры вне референсного интервала"
                    : "Автоматически: все параметры в пределах нормы"
                  : "Задано вручную"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-medium", effectiveAbnormal ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                {effectiveAbnormal ? "Да" : "Нет"}
              </span>
              <Switch checked={effectiveAbnormal} onCheckedChange={(v) => setManualAbnormal(v)} aria-label="Отклонение от нормы" />
            </div>
          </div>

          <div>
            <Label>Клиническая интерпретация</Label>
            <Textarea
              value={interpretation}
              onChange={(e) => setInterpretation(e.target.value)}
              placeholder="Что означают результаты в контексте пациента…"
              rows={2}
            />
          </div>
          <div>
            <Label>Заключение врача</Label>
            <Textarea
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
              placeholder="Итоговое врачебное заключение по обследованию…"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button
            onClick={submit}
            disabled={loading}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Сохранить результат
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Problems Tab
// ============================================================================
function ProblemsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const problems = patient.problems ?? [];

  const addMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.addProblem(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("Проблема добавлена");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Проблемный список</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Добавить
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {problems.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Проблемы не зарегистрированы</CardContent>
          </Card>
        ) : problems.map((p) => (
          <Card key={p.id} className={cn(p.isPrimary && "border-amber-500/40 bg-amber-500/5")}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {p.isPrimary && <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300">Основная</Badge>}
                  <span className="font-medium">{p.title}</span>
                </div>
                <Badge variant="outline" className={cn("text-xs", PROBLEM_STATUS[p.status]?.color)}>{PROBLEM_STATUS[p.status]?.label || p.status}</Badge>
              </div>
              {p.icd10 && <div className="mt-1 font-mono text-xs text-muted-foreground">МКБ-10: {p.icd10}</div>}
              {p.description && <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{SEVERITY[p.severity] || p.severity}</Badge>
                {p.onsetDate && <span>Начало: {fmtDate(p.onsetDate)}</span>}
                {p.resolvedDate && <span>Разрешена: {fmtDate(p.resolvedDate)}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AddProblemDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={(d) => addMut.mutate(d)} loading={addMut.isPending} />
    </div>
  );
}

function AddProblemDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  onSubmit: (d: Record<string, unknown>) => void; loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const submit = () => {
    onSubmit({
      title: v.title, icd10: v.icd10, category: v.category || "chronic",
      status: v.status || "active", severity: v.severity || "mild",
      onsetDate: v.onsetDate || undefined, description: v.description,
      notes: v.notes, isPrimary: v.isPrimary === "true",
    });
    setV({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-rose-600" /> Добавить проблему</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Название *</Label><Input value={v.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="Сахарный диабет 2 типа" /></div>
          <div><Label>МКБ-10</Label><Input value={v.icd10 || ""} onChange={(e) => set("icd10", e.target.value)} placeholder="E11.9" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Категория</Label>
              <Select value={v.category || "chronic"} onValueChange={(val) => set("category", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="chronic">Хроническая</SelectItem>
                  <SelectItem value="acute">Острая</SelectItem>
                  <SelectItem value="recurring">Рецидивирующая</SelectItem>
                  <SelectItem value="resolved">Разрешённая</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Статус</Label>
              <Select value={v.status || "active"} onValueChange={(val) => set("status", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активна</SelectItem>
                  <SelectItem value="resolved">Разрешена</SelectItem>
                  <SelectItem value="chronic">Хроническая</SelectItem>
                  <SelectItem value="controlled">Контролируется</SelectItem>
                  <SelectItem value="uncontrolled">Неконтролируемая</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Тяжесть</Label>
              <Select value={v.severity || "mild"} onValueChange={(val) => set("severity", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mild">Лёгкая</SelectItem>
                  <SelectItem value="moderate">Средняя</SelectItem>
                  <SelectItem value="severe">Тяжёлая</SelectItem>
                  <SelectItem value="critical">Критическая</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Основная?</Label>
              <Select value={v.isPrimary || "false"} onValueChange={(val) => set("isPrimary", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Нет</SelectItem>
                  <SelectItem value="true">Да</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Дата начала</Label><Input type="date" value={v.onsetDate || ""} onChange={(e) => set("onsetDate", e.target.value)} /></div>
          <div><Label>Описание</Label><Textarea value={v.description || ""} onChange={(e) => set("description", e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading || !v.title} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Immunizations Tab
// ============================================================================
function ImmunizationsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const imm = patient.immunizations ?? [];

  const addMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.addImmunization(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("Прививка добавлена");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Иммунизация</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Добавить
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {imm.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Прививки не зарегистрированы</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {imm.map((i) => (
                <div key={i.id} className="flex items-start gap-3 border-b p-3 last:border-0 hover:bg-muted/30">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600">
                    <Syringe className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{i.vaccineName}</span>
                      <Badge variant="outline" className="text-[10px]">#{i.doseNumber} доза</Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{fmtDate(i.administeredAt)}</span>
                      {i.targetDisease && <span>Против: {i.targetDisease}</span>}
                      {i.manufacturer && <span>{i.manufacturer}</span>}
                      {i.series && <span className="font-mono">серия: {i.series}</span>}
                    </div>
                    {i.reaction && <div className="mt-1 text-xs text-rose-600">Реакция: {i.reaction}</div>}
                    {i.nextDoseDate && (
                      <Badge variant="outline" className="mt-1 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
                        Следующая: {fmtDate(i.nextDoseDate)}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddImmunizationDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={(d) => addMut.mutate(d)} loading={addMut.isPending} />
    </div>
  );
}

function AddImmunizationDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  onSubmit: (d: Record<string, unknown>) => void; loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const submit = () => {
    onSubmit({
      vaccineName: v.vaccineName, targetDisease: v.targetDisease,
      doseNumber: v.doseNumber || 1, series: v.series, manufacturer: v.manufacturer,
      lotNumber: v.lotNumber, route: v.route || "im", site: v.site,
      administeredAt: v.administeredAt || new Date().toISOString().slice(0, 10),
      nextDoseDate: v.nextDoseDate || undefined, reaction: v.reaction, notes: v.notes,
    });
    setV({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Syringe className="h-5 w-5 text-violet-600" /> Добавить прививку</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Вакцина *</Label><Input value={v.vaccineName || ""} onChange={(e) => set("vaccineName", e.target.value)} placeholder="ВГВ (гепатит B)" /></div>
          <div><Label>Против заболевания</Label><Input value={v.targetDisease || ""} onChange={(e) => set("targetDisease", e.target.value)} placeholder="Гепатит B" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Доза №</Label><Input type="number" value={v.doseNumber || "1"} onChange={(e) => set("doseNumber", e.target.value)} /></div>
            <div>
              <Label>Путь</Label>
              <Select value={v.route || "im"} onValueChange={(val) => set("route", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="im">В/м</SelectItem>
                  <SelectItem value="sc">П/к</SelectItem>
                  <SelectItem value="id">В/к</SelectItem>
                  <SelectItem value="oral">Per os</SelectItem>
                  <SelectItem value="intranasal">Интраназально</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Серия</Label><Input value={v.series || ""} onChange={(e) => set("series", e.target.value)} placeholder="U1234" /></div>
          <div><Label>Производитель</Label><Input value={v.manufacturer || ""} onChange={(e) => set("manufacturer", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Дата</Label><Input type="date" value={v.administeredAt || ""} onChange={(e) => set("administeredAt", e.target.value)} /></div>
            <div><Label>Следующая доза</Label><Input type="date" value={v.nextDoseDate || ""} onChange={(e) => set("nextDoseDate", e.target.value)} /></div>
          </div>
          <div><Label>Реакция</Label><Input value={v.reaction || ""} onChange={(e) => set("reaction", e.target.value)} placeholder="Без особенностей" /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading || !v.vaccineName} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Visits Tab
// ============================================================================
function VisitsTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const visits = patient.visits ?? [];

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createVisit(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("Визит создан");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const VISIT_TYPE: Record<string, string> = {
    outpatient: "Амбулаторный", inpatient: "Стационарный", emergency: "Экстренный",
    telemedicine: "Телемедицина", home: "Дом", consultation: "Консультация",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">История визитов</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Новый визит
        </Button>
      </div>
      {visits.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Визиты не зарегистрированы</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {visits.map((v) => (
            <Card key={v.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{fmtDate(v.scheduledAt)}</span>
                        <Badge variant="outline" className="text-[10px]">{VISIT_TYPE[v.visitType] || v.visitType}</Badge>
                        <Badge variant="outline" className={cn("text-[10px]", v.status === "completed" ? "bg-emerald-500/10 text-emerald-700" : v.status === "cancelled" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700")}>
                          {({ scheduled: "Запланирован", in_progress: "Идёт", completed: "Завершён", cancelled: "Отменён", no_show: "Неявка" } as Record<string, string>)[v.status] || v.status}
                        </Badge>
                      </div>
                      {v.chiefComplaint && <p className="mt-1 text-sm text-muted-foreground">Жалобы: {v.chiefComplaint}</p>}
                      {v.doctor && <p className="mt-0.5 text-xs text-muted-foreground">Врач: {v.doctor.fullName}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {v._count?.vitalSigns ? <Badge variant="outline" className="text-[10px]">{v._count.vitalSigns} витал.</Badge> : null}
                    {v._count?.medications ? <Badge variant="outline" className="text-[10px]">{v._count.medications} преп.</Badge> : null}
                    {v._count?.labResults ? <Badge variant="outline" className="text-[10px]">{v._count.labResults} анал.</Badge> : null}
                  </div>
                </div>
                {(v.soapSubjective || v.soapObjective || v.soapAssessment || v.soapPlan) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {v.soapSubjective && <SOAPBox letter="S" title="Субъективно" content={v.soapSubjective} color="border-sky-500/30 bg-sky-500/5" />}
                    {v.soapObjective && <SOAPBox letter="O" title="Объективно" content={v.soapObjective} color="border-emerald-500/30 bg-emerald-500/5" />}
                    {v.soapAssessment && <SOAPBox letter="A" title="Оценка" content={v.soapAssessment} color="border-amber-500/30 bg-amber-500/5" />}
                    {v.soapPlan && <SOAPBox letter="P" title="План" content={v.soapPlan} color="border-violet-500/30 bg-violet-500/5" />}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateVisitDialog open={addOpen} onOpenChange={setAddOpen} patient={patient} onSubmit={(d) => createMut.mutate(d)} loading={createMut.isPending} />
    </div>
  );
}

function SOAPBox({ letter, title, content, color }: { letter: string; title: string; content: string; color: string }) {
  return (
    <div className={cn("rounded-md border p-2", color)}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        <span className="flex h-4 w-4 items-center justify-center rounded bg-foreground/10 text-[10px]">{letter}</span>
        {title}
      </div>
      <p className="mt-1 text-xs">{content}</p>
    </div>
  );
}

// ============================================================================
// Care Plans Tab
// ============================================================================
function CarePlansTab({ patient }: { patient: PatientDetail }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const plans = patient.carePlans ?? [];

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createCarePlan(patient.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
      setAddOpen(false);
      toast.success("План ведения создан");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const TYPE_LABEL: Record<string, string> = {
    treatment: "Лечение", monitoring: "Наблюдение", prevention: "Профилактика",
    rehabilitation: "Реабилитация", palliative: "Паллиатив",
  };
  const STATUS: Record<string, { label: string; color: string }> = {
    draft: { label: "Черновик", color: "bg-muted text-muted-foreground" },
    active: { label: "Активен", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    completed: { label: "Завершён", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
    on_hold: { label: "Приостановлен", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    cancelled: { label: "Отменён", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Планы ведения</h3>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600">
          <Plus className="h-3.5 w-3.5" /> Новый план
        </Button>
      </div>
      {plans.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Планы не созданы</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {plans.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">{c.title}</span>
                    </div>
                    <div className="mt-1 flex gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[c.type] || c.type}</Badge>
                      <Badge variant="outline" className={cn("text-[10px]", STATUS[c.status]?.color)}>{STATUS[c.status]?.label || c.status}</Badge>
                    </div>
                  </div>
                </div>
                {c.problem && <p className="mt-2 text-xs text-muted-foreground">Проблема: {c.problem.title} ({c.problem.icd10})</p>}
                {c.goals?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Цели</div>
                    <ul className="mt-1 space-y-1 text-sm">
                      {c.goals.map((g, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-emerald-600">✓</span>
                          <span className={cn(g.achieved && "line-through opacity-60")}>{g.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.interventions?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Вмешательства</div>
                    <ul className="mt-1 space-y-1 text-sm">
                      {c.interventions.map((int, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-violet-600">→</span>
                          <span>{int.description}{int.frequency ? ` (${int.frequency})` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                  <span>{fmtDate(c.startDate)} — {fmtDate(c.endDate)}</span>
                  {c.doctor && <span>{c.doctor.fullName}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateCarePlanDialog open={addOpen} onOpenChange={setAddOpen} patient={patient} onSubmit={(d) => createMut.mutate(d)} loading={createMut.isPending} />
    </div>
  );
}

// ============================================================================
// Create AI Case from Patient dialog — bridges EMR → AI analysis
// ============================================================================
function CreateCaseFromPatientDialog({
  open, onOpenChange, patient, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: PatientDetail;
  onSubmit: (d: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [diagnosisHint, setDiagnosisHint] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Auto-fill diagnosis hint from primary problem
  React.useEffect(() => {
    if (open) {
      const primary = patient.problems?.find((p) => p.isPrimary);
      if (primary && !diagnosisHint) {
        setDiagnosisHint(primary.title + (primary.icd10 ? ` (МКБ-10: ${primary.icd10})` : ""));
      }
      if (!notes) {
        const chronicList = patient.chronicDiseases?.map((d: { name: string }) => d.name).join(", ");
        const activeMeds = patient.medications?.filter((m) => m.status === "active").map((m) => m.drugName).join(", ");
        const parts: string[] = [];
        if (chronicList) parts.push(`Хронические: ${chronicList}`);
        if (patient.allergies?.length > 0) parts.push(`Аллергии: ${patient.allergies.map((a: { allergen: string }) => a.allergen).join(", ")}`);
        if (activeMeds) parts.push(`Текущая терапия: ${activeMeds}`);
        setNotes(parts.join("\n"));
      }
    }
  }, [open, patient]);

  const submit = () => {
    onSubmit({
      patientId: patient.id,
      birthYear: patient.birthDate ? new Date(patient.birthDate).getFullYear() : undefined,
      sex: patient.sex,
      diagnosisHint,
      notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-emerald-600" /> Создать ИИ-кейс из карты пациента
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">{patient.lastName} {patient.firstName}</span>
              <span className="font-mono text-xs text-muted-foreground">{patient.patientToken}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Кейс будет связан с медкартой. Демография (год рождения, пол) заполнится автоматически.
            </p>
          </div>
          <div>
            <Label>Предварительный диагноз</Label>
            <Textarea
              value={diagnosisHint}
              onChange={(e) => setDiagnosisHint(e.target.value)}
              placeholder="Например: Сахарный диабет 2 типа (МКБ-10: E11.9)"
              rows={2}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Автозаполнено из основной проблемы пациента</p>
          </div>
          <div>
            <Label>Заметки / анамнез</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Хронические заболевания, аллергии, текущая терапия…"
              rows={4}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Автозаполнено из медкарты пациента</p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />} Создать кейс
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Edit Patient dialog — complete CRUD for demographics
// ============================================================================
function EditPatientDialog({
  open, onOpenChange, patient, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: PatientDetail;
  onSubmit: (d: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  React.useEffect(() => {
    if (open) {
      setV({
        lastName: patient.lastName || "",
        firstName: patient.firstName || "",
        middleName: patient.middleName || "",
        sex: patient.sex || "",
        birthDate: patient.birthDate ? patient.birthDate.slice(0, 10) : "",
        bloodType: patient.bloodType || "",
        phone: patient.phone || "",
        email: patient.email || "",
        snils: patient.snils || "",
        omiPolicy: patient.omiPolicy || "",
        occupation: patient.occupation || "",
        smokingStatus: patient.smokingStatus || "unknown",
        alcoholUse: patient.alcoholUse || "unknown",
        height: String(patient.height || ""),
        weight: String(patient.weight || ""),
        notes: patient.notes || "",
        status: patient.status || "active",
      });
    }
  }, [open, patient]);

  const submit = () => {
    const data: Record<string, unknown> = {};
    if (v.lastName !== patient.lastName) data.lastName = v.lastName;
    if (v.firstName !== patient.firstName) data.firstName = v.firstName;
    if (v.middleName !== patient.middleName) data.middleName = v.middleName;
    if (v.sex !== patient.sex) data.sex = v.sex;
    if (v.birthDate !== (patient.birthDate ? patient.birthDate.slice(0, 10) : "")) data.birthDate = v.birthDate || undefined;
    if (v.bloodType !== patient.bloodType) data.bloodType = v.bloodType;
    if (v.phone !== patient.phone) data.phone = v.phone;
    if (v.email !== patient.email) data.email = v.email;
    if (v.snils !== patient.snils) data.snils = v.snils;
    if (v.omiPolicy !== patient.omiPolicy) data.omiPolicy = v.omiPolicy;
    if (v.occupation !== patient.occupation) data.occupation = v.occupation;
    if (v.smokingStatus !== patient.smokingStatus) data.smokingStatus = v.smokingStatus;
    if (v.alcoholUse !== patient.alcoholUse) data.alcoholUse = v.alcoholUse;
    if (v.height !== String(patient.height || "")) data.height = Number(v.height) || 0;
    if (v.weight !== String(patient.weight || "")) data.weight = Number(v.weight) || 0;
    if (v.notes !== (patient.notes || "")) data.notes = v.notes;
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" /> Редактировать данные пациента
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Lock className="h-3 w-3" /> Поля с замком шифруются в браузере до отправки (E2EE)
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div><Label><SecureLabel>Фамилия</SecureLabel></Label><Input value={v.lastName || ""} onChange={(e) => set("lastName", e.target.value)} /></div>
          <div><Label><SecureLabel>Имя</SecureLabel></Label><Input value={v.firstName || ""} onChange={(e) => set("firstName", e.target.value)} /></div>
          <div><Label><SecureLabel>Отчество</SecureLabel></Label><Input value={v.middleName || ""} onChange={(e) => set("middleName", e.target.value)} /></div>
          <div><Label><SecureLabel>Дата рождения</SecureLabel></Label><Input type="date" value={v.birthDate || ""} onChange={(e) => set("birthDate", e.target.value)} /></div>
          <div>
            <Label>Пол</Label>
            <Select value={v.sex || ""} onValueChange={(val) => set("sex", val)}>
              <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="М">Мужской</SelectItem>
                <SelectItem value="Ж">Женский</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Группа крови</Label>
            <Select value={v.bloodType || ""} onValueChange={(val) => set("bloodType", val)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="O(I)+">O(I) Rh+</SelectItem>
                <SelectItem value="O(I)-">O(I) Rh−</SelectItem>
                <SelectItem value="A(II)+">A(II) Rh+</SelectItem>
                <SelectItem value="A(II)-">A(II) Rh−</SelectItem>
                <SelectItem value="B(III)+">B(III) Rh+</SelectItem>
                <SelectItem value="B(III)-">B(III) Rh−</SelectItem>
                <SelectItem value="AB(IV)+">AB(IV) Rh+</SelectItem>
                <SelectItem value="AB(IV)-">AB(IV) Rh−</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label><SecureLabel>Телефон</SecureLabel></Label><Input value={v.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><Label><SecureLabel>Email</SecureLabel></Label><Input value={v.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
          <div><Label><SecureLabel>СНИЛС</SecureLabel></Label><Input value={v.snils || ""} onChange={(e) => set("snils", e.target.value)} /></div>
          <div><Label><SecureLabel>Полис ОМС</SecureLabel></Label><Input value={v.omiPolicy || ""} onChange={(e) => set("omiPolicy", e.target.value)} /></div>
          <div><Label><SecureLabel>Профессия</SecureLabel></Label><Input value={v.occupation || ""} onChange={(e) => set("occupation", e.target.value)} /></div>
          <div>
            <Label>Курение</Label>
            <Select value={v.smokingStatus || "unknown"} onValueChange={(val) => set("smokingStatus", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Не курит</SelectItem>
                <SelectItem value="former">Бросил</SelectItem>
                <SelectItem value="current">Курит</SelectItem>
                <SelectItem value="unknown">Неизвестно</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Алкоголь</Label>
            <Select value={v.alcoholUse || "unknown"} onValueChange={(val) => set("alcoholUse", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не употребляет</SelectItem>
                <SelectItem value="occasional">Изредка</SelectItem>
                <SelectItem value="moderate">Умеренно</SelectItem>
                <SelectItem value="heavy">Часто</SelectItem>
                <SelectItem value="unknown">Неизвестно</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Рост (см)</Label><Input type="number" value={v.height || ""} onChange={(e) => set("height", e.target.value)} /></div>
          <div><Label>Вес (кг)</Label><Input type="number" step="0.1" value={v.weight || ""} onChange={(e) => set("weight", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label><SecureLabel>Заметки</SecureLabel></Label><Textarea value={v.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Create Visit dialog — SOAP notes with structured diagnosis
// ============================================================================
function CreateVisitDialog({
  open, onOpenChange, patient, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: PatientDetail;
  onSubmit: (d: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [v, setV] = React.useState<Record<string, string>>({});
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const submit = () => {
    onSubmit({
      visitType: v.visitType || "outpatient",
      status: v.status || "scheduled",
      chiefComplaint: v.chiefComplaint,
      visitReason: v.visitReason,
      soapSubjective: v.soapSubjective,
      soapObjective: v.soapObjective,
      soapAssessment: v.soapAssessment,
      soapPlan: v.soapPlan,
      scheduledAt: v.scheduledAt || new Date().toISOString().slice(0, 16),
    });
    setV({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-sky-600" /> Новый визит пациента
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Тип визита</Label>
              <Select value={v.visitType || "outpatient"} onValueChange={(val) => set("visitType", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outpatient">Амбулаторный</SelectItem>
                  <SelectItem value="inpatient">Стационарный</SelectItem>
                  <SelectItem value="emergency">Экстренный</SelectItem>
                  <SelectItem value="telemedicine">Телемедицина</SelectItem>
                  <SelectItem value="home">Дом</SelectItem>
                  <SelectItem value="consultation">Консультация</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Статус</Label>
              <Select value={v.status || "scheduled"} onValueChange={(val) => set("status", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Запланирован</SelectItem>
                  <SelectItem value="in_progress">Идёт</SelectItem>
                  <SelectItem value="completed">Завершён</SelectItem>
                  <SelectItem value="cancelled">Отменён</SelectItem>
                  <SelectItem value="no_show">Неявка</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Дата и время</Label>
              <Input
                type="datetime-local"
                value={v.scheduledAt || new Date().toISOString().slice(0, 16)}
                onChange={(e) => set("scheduledAt", e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Жалобы (chief complaint)</Label>
            <Textarea value={v.chiefComplaint || ""} onChange={(e) => set("chiefComplaint", e.target.value)} placeholder="Например: боли за грудиной при физ. нагрузке" rows={2} />
          </div>
          <div>
            <Label>Цель визита</Label>
            <Input value={v.visitReason || ""} onChange={(e) => set("visitReason", e.target.value)} placeholder="Плановый осмотр / консультация / контроль" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-sky-700 dark:text-sky-300">S — Субъективно (анамнез)</Label>
              <Textarea value={v.soapSubjective || ""} onChange={(e) => set("soapSubjective", e.target.value)} placeholder="Жалобы, анамнез заболевания, анамнез жизни…" rows={3} />
            </div>
            <div>
              <Label className="text-emerald-700 dark:text-emerald-300">O — Объективно (осмотр)</Label>
              <Textarea value={v.soapObjective || ""} onChange={(e) => set("soapObjective", e.target.value)} placeholder="Общее состояние, АД, ЧСС, аускультация…" rows={3} />
            </div>
            <div>
              <Label className="text-amber-700 dark:text-amber-300">A — Оценка (диагноз)</Label>
              <Textarea value={v.soapAssessment || ""} onChange={(e) => set("soapAssessment", e.target.value)} placeholder="Клинический диагноз, МКБ-10…" rows={3} />
            </div>
            <div>
              <Label className="text-violet-700 dark:text-violet-300">P — План</Label>
              <Textarea value={v.soapPlan || ""} onChange={(e) => set("soapPlan", e.target.value)} placeholder="Назначения, обследования, рекомендации…" rows={3} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Создать визит
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Create Care Plan dialog — goals + interventions
// ============================================================================
function CreateCarePlanDialog({
  open, onOpenChange, patient, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: PatientDetail;
  onSubmit: (d: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState("treatment");
  const [status, setStatus] = React.useState("active");
  const [problemId, setProblemId] = React.useState("none");
  const [notes, setNotes] = React.useState("");
  const [goalsText, setGoalsText] = React.useState("");
  const [interventionsText, setInterventionsText] = React.useState("");

  const submit = () => {
    const goals = goalsText.split("\n").map((s) => s.trim()).filter(Boolean).map((description) => ({ description }));
    const interventions = interventionsText.split("\n").map((s) => s.trim()).filter(Boolean).map((description) => {
      // Allow "description (frequency)" syntax
      const m = description.match(/^(.+?)\s*\((.+?)\)$/);
      return m ? { description: m[1].trim(), frequency: m[2].trim() } : { description };
    });
    onSubmit({
      title,
      type,
      status,
      problemId: problemId === "none" ? undefined : problemId,
      goals,
      interventions,
      notes,
      startDate: new Date().toISOString().slice(0, 10),
    });
    setTitle(""); setType("treatment"); setStatus("active"); setProblemId("none");
    setNotes(""); setGoalsText(""); setInterventionsText("");
  };

  const problems = patient.problems ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-600" /> Новый план ведения
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Название плана *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Ведение СД 2 типа" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Тип плана</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="treatment">Лечение</SelectItem>
                  <SelectItem value="monitoring">Наблюдение</SelectItem>
                  <SelectItem value="prevention">Профилактика</SelectItem>
                  <SelectItem value="rehabilitation">Реабилитация</SelectItem>
                  <SelectItem value="palliative">Паллиатив</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Статус</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Черновик</SelectItem>
                  <SelectItem value="active">Активен</SelectItem>
                  <SelectItem value="on_hold">Приостановлен</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {problems.length > 0 && (
            <div>
              <Label>Связанная проблема</Label>
              <Select value={problemId} onValueChange={setProblemId}>
                <SelectTrigger><SelectValue placeholder="Без привязки" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без привязки</SelectItem>
                  {problems.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}{p.icd10 ? ` (${p.icd10})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Цели (по одной на строку)</Label>
            <Textarea
              value={goalsText}
              onChange={(e) => setGoalsText(e.target.value)}
              placeholder={"Достижение HbA1c < 7.0%\nСнижение массы тела до 80 кг\nКонтроль АД < 130/80"}
              rows={3}
            />
          </div>
          <div>
            <Label>Вмешательства (по одной на строку, можно указать частоту в скобках)</Label>
            <Textarea
              value={interventionsText}
              onChange={(e) => setInterventionsText(e.target.value)}
              placeholder={"Метформин 1000 мг × 2/день (ежедневно)\nКонтроль HbA1c (1 раз в 3 мес.)\nДиета с ограничением углеводов (постоянно)"}
              rows={3}
            />
          </div>
          <div>
            <Label>Заметки</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Доп. информация" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
          <Button onClick={submit} disabled={loading || !title} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Создать план
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

