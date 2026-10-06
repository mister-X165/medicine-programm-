"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  Plus,
  FileText,
  Dna,
  Clock,
  ChevronRight,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Database,
  Cpu,
  BookCheck,
  Search,
  Filter,
  ArrowUpDown,
  Download,
  Stethoscope,
  HeartPulse,
  Users,
  Activity,
  Wifi,
  Droplet,
  Sparkles,
  UserRound,
  Calculator,
  BarChart3,
  FlaskConical,
  Bell,
  AlertCircle,
  CalendarClock,
  Pill,
  Syringe,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { AdvancedSearch } from "@/components/shared/advanced-search";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { CaseSummary, SystemStatus, PatientSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  new: { label: "Новый", color: "bg-muted text-muted-foreground border-muted-foreground/20", dot: "bg-muted-foreground" },
  uploaded: { label: "Данные загружены", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30", dot: "bg-sky-500" },
  analyzing: { label: "Анализ…", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", dot: "bg-amber-500" },
  analyzed: { label: "Проанализирован", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", dot: "bg-emerald-500" },
  reported: { label: "Отчёт готов", color: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30", dot: "bg-violet-500" },
};

type SortKey = "updated" | "created" | "code" | "status";

// ─── framer-motion variants ────────────────────────────────────────────────
// Subtle fade + slide-up entrance, staggered across children for a polished,
// investor-ready feel. framer-motion automatically respects the user's
// prefers-reduced-motion setting via its internal `useReducedMotion` hook.
const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export function Dashboard() {
  // NOTE: selectPatient was added in Рабочее пространство to navigate into the EMR medical-record view.
  const { selectCase, selectPatient, currentDoctor } = useAppStore();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [sortBy, setSortBy] = React.useState<SortKey>("updated");

  const { data: casesData, isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: api.getCases,
  });

  const { data: health } = useQuery<SystemStatus>({
    queryKey: ["health"],
    queryFn: api.getHealth,
    refetchInterval: 30000,
  });

  // EMR Рабочее пространство — active patients for the "Активные пациенты" KPI.
  const { data: activePatientsData, isLoading: patientsLoading } = useQuery({
    queryKey: ["patients", { status: "active" }],
    queryFn: () => api.getPatients({ status: "active" }),
  });

  // EMR Рабочее пространство — recent patients (any status) for the "Недавние пациенты" panel.
  const { data: recentPatientsData, isLoading: recentLoading } = useQuery({
    queryKey: ["patients", "recent"],
    queryFn: () => api.getPatients(),
  });

  const createMut = useMutation({
    mutationFn: (data: { birthYear?: number; sex?: string; diagnosisHint?: string; notes?: string }) => api.createCase(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      setCreateOpen(false);
      toast.success(`Случай ${res.case.caseCode} создан`);
      selectCase(res.case.id);
    },
    onError: (e: Error) => toast.error("Ошибка создания: " + e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteCase(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cases"] }); toast.success("Случай удалён"); },
    onError: (e: Error) => toast.error("Ошибка удаления: " + e.message),
  });

  const allCases = casesData?.cases ?? [];

  const stats = React.useMemo(() => {
    const total = allCases.length;
    const analyzed = allCases.filter((c) => c.status === "analyzed" || c.status === "reported").length;
    const reported = allCases.filter((c) => c.status === "reported").length;
    const pending = allCases.filter((c) => c.status === "new" || c.status === "uploaded").length;
    return { total, analyzed, reported, pending };
  }, [allCases]);

  const activePatientCount = activePatientsData?.count ?? activePatientsData?.patients?.length ?? 0;

  const recentPatients = React.useMemo(() => {
    const list = recentPatientsData?.patients ?? [];
    return [...list]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [recentPatientsData]);

  // Compose the System Health mini-summary used in the 4th KPI card.
  const healthSummary = React.useMemo(() => {
    if (!health) return { ok: 0, total: 4, label: "Загрузка…" };
    const ok = [!!health.db, !!health.rag, !!health.ai?.ok, !!health.network?.online].filter(Boolean).length;
    return {
      ok,
      total: 4,
      label: ok === 4 ? "Все системы в норме" : ok >= 2 ? "Частичный сбой" : "Требует внимания",
    };
  }, [health]);

  const cases = React.useMemo(() => {
    let result = allCases;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter((c) => c.caseCode.toLowerCase().includes(q) || (c.diagnosisHint ?? "").toLowerCase().includes(q) || (c.notes ?? "").toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter((c) => c.status === statusFilter);
    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "created": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "code": return a.caseCode.localeCompare(b.caseCode, "ru");
        case "status": return a.status.localeCompare(b.status);
        case "updated": default: return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [allCases, search, statusFilter, sortBy]);

  const handleExportCSV = React.useCallback(() => {
    const headers = ["Код", "Статус", "Диагноз", "Год рожд.", "Пол", "Документов", "Отчётов", "Создан", "Обновлён"];
    const rows = cases.map((c) => [c.caseCode, STATUS_LABELS[c.status]?.label ?? c.status, c.diagnosisHint ?? "", c.birthYear?.toString() ?? "", c.sex ?? "", c._count?.documents?.toString() ?? "0", c._count?.reports?.toString() ?? "0", new Date(c.createdAt).toLocaleString("ru-RU"), new Date(c.updatedAt).toLocaleString("ru-RU")]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cases-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Экспортировано ${cases.length} случаев в CSV`);
  }, [cases]);

  return (
    <motion.div
      className="space-y-6"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* ─── Hero / investor-ready header ─────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <HeroHeader currentDoctor={currentDoctor} onCreate={() => setCreateOpen(true)} />
      </motion.div>

      {/* ─── KPI metric cards (4-column grid) ─────────────────────────────── */}
      <motion.div variants={staggerContainer} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <motion.div variants={itemVariants}>
          <KPICard
            icon={Users}
            label="Активные пациенты"
            value={patientsLoading ? undefined : activePatientCount}
            gradient="emerald"
            trend={activePatientCount > 0 ? "EMR Рабочее пространство" : "EMR активна"}
            accent={<TrendUpPill text="+2 за неделю" tone="emerald" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <KPICard
            icon={Activity}
            label="Активные случаи"
            value={isLoading ? undefined : stats.analyzed}
            gradient="cyan"
            trend={`${Math.round((stats.analyzed / Math.max(stats.total, 1)) * 100)}% от ${stats.total} случаев`}
            accent={<TrendUpPill text={`из ${stats.total} активных`} tone="cyan" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <KPICard
            icon={Clock}
            label="Ожидают анализа"
            value={isLoading ? undefined : stats.pending}
            gradient="amber"
            trend={stats.pending > 0 ? "Требуют внимания" : "Все обработаны"}
            accent={<TrendUpPill text={stats.pending > 0 ? "В очереди" : "Готово"} tone={stats.pending > 0 ? "amber" : "emerald"} />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <KPICard
            icon={HeartPulse}
            label="Здоровье системы"
            value={health ? `${healthSummary.ok}/${healthSummary.total}` : undefined}
            gradient="violet"
            trend={healthSummary.label}
            accent={
              <span className="flex items-center gap-1.5">
                <StatusDot ok={!!health?.db} label="БД" />
                <StatusDot ok={!!health?.ai?.ok} label="ИИ" />
                <StatusDot ok={!!health?.rag} label="RAG" />
                <StatusDot ok={!!health?.network?.online} label="Сеть" />
              </span>
            }
          />
        </motion.div>
      </motion.div>

      {/* ─── Clinical Reminders (overdue labs, visits, med reviews) ──────────── */}
      <motion.div variants={itemVariants}>
        <ClinicalRemindersWidget />
      </motion.div>

      {/* ─── Main 2-column layout: cases+patients | sidebar ───────────────── */}
      <motion.div variants={itemVariants} className="grid gap-6 lg:grid-cols-3">
        {/* Left column — cases + recent patients */}
        <div className="space-y-6 lg:col-span-2">
          {/* Cases list card */}
          <Card className="overflow-hidden rounded-2xl shadow-sm transition-all hover:shadow-md">
            <CardHeader className="space-y-3">
              <div className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Случаи пациентов</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="tabular-nums">{cases.length}</Badge>
                  {cases.length > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportCSV} title="Экспортировать в CSV">
                      <Download className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">CSV</span>
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Поиск по коду, диагнозу, заметкам…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-44"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="new">Новые</SelectItem>
                    <SelectItem value="uploaded">Загруженные</SelectItem>
                    <SelectItem value="analyzing">Анализ</SelectItem>
                    <SelectItem value="analyzed">Проанализированы</SelectItem>
                    <SelectItem value="reported">Отчёты готовы</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                  <SelectTrigger className="w-full sm:w-44"><ArrowUpDown className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated">По обновлению</SelectItem>
                    <SelectItem value="created">По созданию</SelectItem>
                    <SelectItem value="code">По коду</SelectItem>
                    <SelectItem value="status">По статусу</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-20 w-full rounded-lg" />))}</div>
              ) : allCases.length === 0 ? (
                <EmptyState onCreate={() => setCreateOpen(true)} />
              ) : cases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Search className="mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium">Ничего не найдено</p>
                  <p className="mt-1 text-xs text-muted-foreground">Попробуйте изменить поиск или фильтр</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Сбросить фильтры</Button>
                </div>
              ) : (
                <div className="max-h-[70vh] overflow-y-auto pr-1 -mr-1">
                  <div className="space-y-2">
                    {cases.map((c, idx) => (
                      <CaseRow key={c.id} case={c} onClick={() => selectCase(c.id)} onDelete={() => deleteMut.mutate(c.id)} index={idx} />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Patients card */}
          <Card className="overflow-hidden rounded-2xl shadow-sm transition-all hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <CardTitle className="text-lg">Недавние пациенты</CardTitle>
                </div>
                <Badge variant="secondary" className="tabular-nums">{recentPatients.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Последние обновлённые медицинские карты (EMR Рабочее пространство)</p>
            </CardHeader>
            <CardContent>
              {recentLoading ? (
                <div className="space-y-3">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-16 w-full rounded-lg" />))}</div>
              ) : recentPatients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-medical-gradient-soft">
                    <Users className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium">Пациентов пока нет</p>
                  <p className="mt-1 text-xs text-muted-foreground">Создайте пациента в EMR-модуле, чтобы он появился здесь</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPatients.map((p, idx) => (
                    <PatientRow key={p.id} patient={p} onClick={() => selectPatient(p.id)} index={idx} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column — quick actions + system health sidebar + advanced search */}
        <div className="space-y-6">
          <QuickActionsWidget />

          <SystemHealthWidget health={health} />

          <Card className="rounded-2xl shadow-sm transition-all hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Dna className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <CardTitle className="text-lg">Расширенный поиск</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Поиск по генам, мутациям, статусу и другим параметрам</p>
            </CardHeader>
            <CardContent><AdvancedSearch /></CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Create case dialog (controlled) — opened from HeroHeader via setCreateOpen */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <CreateCaseDialog onSubmit={(d) => createMut.mutate(d)} loading={createMut.isPending} />
      </Dialog>
    </motion.div>
  );
}

// ─── Hero / investor-ready header ──────────────────────────────────────────
function HeroHeader({ currentDoctor, onCreate }: { currentDoctor: { fullName: string } | null; onCreate: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          {/* Logo + version + compliance badges */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-medical-gradient text-white shadow-sm">
                <HeartPulse className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold tracking-tight">СППВР</span>
            </div>
            <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" />
              Рабочее пространство
            </Badge>
            <Badge variant="outline" className="gap-1 border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300">
              <ShieldCheck className="h-3 w-3" />
              Локальное развёртывание · ФЗ-152
            </Badge>
          </div>

          {/* Greeting */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {currentDoctor ? `Здравствуйте, ${currentDoctor.fullName.split(" ")[1] ?? currentDoctor.fullName}` : "Рабочий стол врача"}
            </h1>
            <p className="text-sm text-muted-foreground">Пациенты, клинические случаи и ближайшие действия в одном рабочем пространстве</p>
          </div>
        </div>

        {/* Create case CTA */}
        <Button size="lg" onClick={onCreate} className="gap-2 bg-medical-gradient text-white shadow-lg shadow-emerald-500/20 hover:opacity-90">
          <Plus className="h-5 w-5" />Новый случай
        </Button>
      </div>
    </div>
  );
}

// ─── KPI metric card with gradient icon background ─────────────────────────
function KPICard({ icon: Icon, label, value, gradient, trend, accent }: {
  icon: LucideIcon;
  label: string;
  value?: number | string;
  gradient: "emerald" | "cyan" | "amber" | "violet";
  trend?: string;
  accent?: React.ReactNode;
}) {
  const gradientMap: Record<typeof gradient, string> = {
    emerald: "from-emerald-500 to-teal-600 shadow-emerald-500/30",
    cyan: "from-cyan-500 to-teal-600 shadow-cyan-500/30",
    amber: "from-amber-500 to-orange-600 shadow-amber-500/30",
    violet: "from-violet-500 to-fuchsia-600 shadow-violet-500/30",
  };
  return (
    <Card className="group relative overflow-hidden rounded-2xl shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            {value === undefined ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <div className="text-3xl font-bold tabular-nums leading-none">{value}</div>
            )}
            {trend && <p className="truncate text-xs text-muted-foreground">{trend}</p>}
          </div>
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform group-hover:scale-105", gradientMap[gradient])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {accent && <div className="mt-3 flex items-center text-xs text-muted-foreground/80">{accent}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Small trend pill used inside KPI cards ────────────────────────────────
function TrendUpPill({ text, tone }: { text: string; tone: "emerald" | "cyan" | "amber" | "violet" }) {
  const toneMap = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", toneMap[tone])}>
      {text}
    </span>
  );
}

// ─── Status dot for the System Health KPI accent ──────────────────────────
function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${ok ? "OK" : "Сбой"}`}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </span>
  );
}

// ─── Quick Actions widget — one-click access to common tasks ───────────────
function QuickActionsWidget() {
  const { setView, selectPatient } = useAppStore();

  const { data: patientsData } = useQuery({
    queryKey: ["patients", "recent-actions"],
    queryFn: () => api.getPatients(),
    staleTime: 60000,
  });

  const recentPatients = (patientsData?.patients ?? []).slice(0, 3);

  const actions = [
    { icon: Plus, label: "Новый случай", desc: "Создать кейс для ИИ-анализа", color: "from-emerald-500 to-teal-600", onClick: () => setView("dashboard") },
    { icon: UserRound, label: "Медкарта", desc: "Карта пациента", color: "from-sky-500 to-cyan-600", onClick: () => setView("medical-record") },
    { icon: Calculator, label: "Калькуляторы", desc: "Клинические инструменты", color: "from-violet-500 to-purple-600", onClick: () => setView("calculators") },
    { icon: BarChart3, label: "Аналитика", desc: "Метрики и графики", color: "from-amber-500 to-orange-600", onClick: () => setView("analytics") },
    { icon: FlaskConical, label: "База знаний", desc: "Рекомендации, МКБ-10, DDI", color: "from-rose-500 to-pink-600", onClick: () => setView("knowledge") },
    { icon: ShieldCheck, label: "Журнал аудита", desc: "WORM-журнал действий", color: "from-slate-500 to-gray-600", onClick: () => setView("audit") },
  ];

  return (
    <Card className="rounded-2xl shadow-sm transition-all hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">Быстрые действия</CardTitle>
            <p className="text-xs text-muted-foreground">Один клик до нужного раздела</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Action grid */}
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a, i) => {
            const Icon = a.icon;
            return (
              <button
                key={i}
                onClick={a.onClick}
                className="group flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:shadow-sm"
              >
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-110", a.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{a.label}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{a.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Recent patients quick-access */}
        {recentPatients.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Недавние пациенты</span>
              <button onClick={() => setView("medical-record")} className="text-[10px] text-emerald-600 hover:underline">Все →</button>
            </div>
            {recentPatients.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPatient(p.id)}
                className="flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[10px] font-bold text-white">
                  {(p.lastName?.[0] || p.patientToken[0] || "?").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{p.lastName} {p.firstName}</div>
                  <div className="truncate font-mono text-[9px] text-muted-foreground">{p.patientToken}</div>
                </div>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Clinical Reminders widget — overdue labs, visits, med reviews ─────────
function ClinicalRemindersWidget() {
  const { selectPatient } = useAppStore();
  const { data, isLoading } = useQuery({
    queryKey: ["clinical-reminders"],
    queryFn: () => api.getClinicalReminders(),
    staleTime: 60000,
  });

  const reminders = data?.reminders ?? [];
  const summary = data?.summary;

  const TYPE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
    lab_followup: { icon: FlaskConical, label: "Лаборатория", color: "text-violet-600 bg-violet-500/10" },
    visit_scheduled: { icon: CalendarClock, label: "Визит", color: "text-sky-600 bg-sky-500/10" },
    med_review: { icon: Pill, label: "Препарат", color: "text-emerald-600 bg-emerald-500/10" },
    problem_uncontrolled: { icon: ClipboardList, label: "Проблема", color: "text-rose-600 bg-rose-500/10" },
    immunization_due: { icon: Syringe, label: "Прививка", color: "text-amber-600 bg-amber-500/10" },
  };

  const PRIORITY_CONFIG: Record<string, { label: string; color: string; border: string }> = {
    urgent: { label: "Срочно", color: "bg-rose-500/15 text-rose-700 dark:text-rose-300", border: "border-l-rose-500" },
    high: { label: "Важно", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300", border: "border-l-amber-500" },
    medium: { label: "Средне", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300", border: "border-l-sky-500" },
    low: { label: "Низко", color: "bg-muted text-muted-foreground", border: "border-l-muted-foreground" },
  };

  if (isLoading) {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!summary || summary.total === 0) {
    return null; // Don't show the widget if there are no reminders
  }

  return (
    <Card className="rounded-2xl border-l-4 border-l-emerald-500 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow">
              <Bell className="h-4 w-4" />
              {summary.urgent > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {summary.urgent}
                </span>
              )}
            </div>
            <div>
              <CardTitle className="text-base">Клинические напоминания</CardTitle>
              <p className="text-xs text-muted-foreground">Требуют внимания: просроченные анализы, визиты, обзоры терапии</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {summary.urgent > 0 && (
              <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">{summary.urgent} срочных</Badge>
            )}
            {summary.high > 0 && (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">{summary.high} важных</Badge>
            )}
            <Badge variant="outline" className="tabular-nums">{summary.total} всего</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-80 overflow-y-auto">
          {reminders.slice(0, 8).map((r) => {
            const typeCfg = TYPE_CONFIG[r.type] ?? TYPE_CONFIG.lab_followup;
            const priCfg = PRIORITY_CONFIG[r.priority] ?? PRIORITY_CONFIG.medium;
            const Icon = typeCfg.icon;
            return (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => selectPatient(r.patientId)}
                className={cn(
                  "group flex w-full items-start gap-3 border-b border-l-4 p-3 text-left transition-all last:border-b-0 hover:bg-muted/50",
                  priCfg.border,
                )}
              >
                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", typeCfg.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <Badge variant="outline" className={cn("shrink-0 text-[9px]", priCfg.color)}>
                      {priCfg.label}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{r.patientName}</span>
                    <span className="font-mono text-[10px]">{r.patientToken}</span>
                  </div>
                  {r.detail && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{r.detail}</p>}
                  <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                    {r.daysAgo != null && r.daysAgo > 0 && `${r.daysAgo} дн назад`}
                    {r.daysUntil != null && r.daysUntil === 0 && "сегодня"}
                    {r.daysUntil != null && r.daysUntil > 0 && `через ${r.daysUntil} дн`}
                    {r.daysUntil != null && r.daysUntil < 0 && `${Math.abs(r.daysUntil)} дн просрочено`}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
          {reminders.length > 8 && (
            <div className="border-t p-2 text-center text-xs text-muted-foreground">
              +{reminders.length - 8} ещё…
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── System Health sidebar widget ──────────────────────────────────────────
function SystemHealthWidget({ health }: { health?: SystemStatus }) {
  const rows = [
    { icon: Database, label: "База данных", ok: !!health?.db, hint: "SQLite · локально" },
    { icon: BookCheck, label: "RAG-индекс", ok: !!health?.rag, hint: "Клинические рекомендации" },
    {
      icon: Cpu,
      label: "ИИ-сервер",
      ok: !!health?.ai?.ok,
      hint:
        health?.ai?.provider === "llama-server"
          ? `llama-server${health.ai.model ? ` · ${health.ai.model}` : ""}`
          : health?.ai?.provider === "lm-studio"
            ? `LM Studio${health.ai.model ? ` · ${health.ai.model}` : ""}`
            : "Ручной режим",
    },
    {
      icon: Wifi,
      label: "Сеть",
      ok: !!health?.network?.online,
      hint: health?.network?.circuitOpen ? "Circuit breaker открыт" : "Online",
    },
    { icon: ShieldCheck, label: "Журнал аудита", ok: true, hint: "WORM-журнал активен" },
  ];
  return (
    <Card className="overflow-hidden rounded-2xl shadow-sm transition-all hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-lg">Здоровье системы</CardTitle>
          </div>
          <Badge variant="outline" className={cn("gap-1", health?.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-muted-foreground/20")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", health?.ok ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground")} />
            {health ? (health.ok ? "Работает" : "Проверка") : "Загрузка…"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">Статус подсистем СППВР</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {!health ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (<Skeleton key={i} className="h-12 w-full rounded-lg" />))}
          </div>
        ) : (
          rows.map((row, idx) => <SystemHealthRow key={idx} {...row} />)
        )}
      </CardContent>
    </Card>
  );
}

function SystemHealthRow({ icon: Icon, label, ok, hint }: { icon: LucideIcon; label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2 transition-colors hover:bg-accent/30">
      <div className="flex items-center gap-2.5">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-xs font-medium leading-none">{label}</p>
          {hint && <p className="mt-1 text-[10px] text-muted-foreground leading-none">{hint}</p>}
        </div>
      </div>
      <Badge variant="outline" className={cn("gap-1", ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300")}>
        <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-red-500")} />
        {ok ? "OK" : "Сбой"}
      </Badge>
    </div>
  );
}

// ─── Case row (polished, existing functionality preserved) ─────────────────
function CaseRow({ case: c, onClick, onDelete, index }: { case: CaseSummary; onClick: () => void; onDelete: () => void; index: number }) {
  const status = STATUS_LABELS[c.status] ?? STATUS_LABELS.new;
  const icd10Codes = (c.icd10Codes ?? []) as Array<{ code: string; description?: string }>;
  const updatedDate = new Date(c.updatedAt);
  const now = new Date();
  const daysSinceUpdate = Math.floor((now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
  const isUrgent = (c.status === "new" || c.status === "uploaded") && daysSinceUpdate > 7;
  const isStale = daysSinceUpdate > 30;

  return (
    <div
      className={cn(
        "group animate-slide-in relative flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all hover:shadow-md hover:border-emerald-500/40",
        isUrgent && "border-amber-500/40 bg-amber-500/5",
      )}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {/* Status indicator strip */}
      <div className={cn("absolute left-0 top-0 h-full w-1 rounded-l-xl", status.dot)} />

      {/* Icon */}
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors", status.color)}>
        <FileText className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold tracking-tight">{c.caseCode}</span>
          <Badge variant="outline" className={cn("shrink-0 border", status.color)}>
            <span className={cn("mr-1 h-1.5 w-1.5 rounded-full", status.dot)} />
            {status.label}
          </Badge>
          {isUrgent && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Срочно
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Не обновлялся {daysSinceUpdate} дн.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {icd10Codes.slice(0, 2).map((code, i) => (
            <Badge key={i} variant="outline" className="shrink-0 border-sky-500/30 bg-sky-500/10 font-mono text-[10px] text-sky-700 dark:text-sky-300">
              {code.code}
            </Badge>
          ))}
          {icd10Codes.length > 2 && (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              +{icd10Codes.length - 2}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {c.diagnosisHint && <span className="truncate max-w-xs">{c.diagnosisHint}</span>}
          {c.birthYear && <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />{c.birthYear} г.р.</span>}
          {c.sex && <span>{c.sex === "М" ? "♂ Муж" : "♀ Жен"}</span>}
          <span className={cn("flex items-center gap-1", isStale && "text-amber-600")}>
            <Clock className="h-3 w-3" />
            {formatTimeAgo(updatedDate)}
          </span>
          {c._count && (
            <span className="flex items-center gap-2">
              {c._count.documents > 0 && (
                <span className="flex items-center gap-0.5">
                  <FileText className="h-3 w-3" />
                  {c._count.documents}
                </span>
              )}
              {c._count.reports > 0 && (
                <span className="flex items-center gap-0.5 text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-3 w-3" />
                  {c._count.reports}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить случай?</AlertDialogTitle>
            <AlertDialogDescription>Случай {c.caseCode} и все связанные данные будут безвозвратно удалены.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </div>
  );
}

// ─── Recent patient row ─────────────────────────────────────────────────────
function PatientRow({ patient, onClick, index }: { patient: PatientSummary; onClick: () => void; index: number }) {
  const initials = `${patient.lastName?.[0] ?? ""}${patient.firstName?.[0] ?? ""}`;
  const fullName = [patient.lastName, patient.firstName, patient.middleName].filter(Boolean).join(" ") || "Без имени";
  const sexLabel = patient.sex === "М" ? "♂ Муж" : patient.sex === "Ж" ? "♀ Жен" : patient.sex;
  const visitCount = patient._count?.visits ?? 0;
  const medCount = patient._count?.medications ?? 0;
  const updated = new Date(patient.updatedAt);

  return (
    <div
      className="group animate-slide-in flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all hover:shadow-md hover:border-emerald-500/40 hover:bg-emerald-500/5"
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <Avatar className="h-10 w-10 ring-2 ring-emerald-500/20 ring-offset-2 ring-offset-background">
        <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-semibold text-white">
          {initials.toUpperCase() || "??"}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold tracking-tight">{fullName}</span>
          <Badge variant="outline" className="shrink-0 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
            {patient.patientToken.slice(0, 8)}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {patient.age != null && <span>{patient.age} лет</span>}
          {patient.sex && <span>{sexLabel}</span>}
          {patient.bloodType && (
            <span className="flex items-center gap-1 font-mono">
              <Droplet className="h-3 w-3 text-red-500" />
              {patient.bloodType}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {visitCount} визитов
          </span>
          {medCount > 0 && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {medCount} преп.
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeAgo(updated)}
          </span>
        </div>
      </div>

      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffHrs < 24) return `${diffHrs} ч назад`;
  if (diffDays < 7) return `${diffDays} дн назад`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-medical-gradient-soft">
        <Plus className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h3 className="text-lg font-semibold">Случаев пока нет</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Создайте первый случай пациента, чтобы начать мультимодальный анализ с де-идентификацией и RAG-сопоставлением.</p>
      <Button onClick={onCreate} className="mt-4 gap-2 bg-medical-gradient text-white hover:opacity-90"><Plus className="h-4 w-4" />Создать случай</Button>
    </div>
  );
}

function CreateCaseDialog({ onSubmit, loading }: { onSubmit: (data: { birthYear?: number; sex?: string; diagnosisHint?: string; notes?: string }) => void; loading: boolean }) {
  const [birthYear, setBirthYear] = React.useState("");
  const [sex, setSex] = React.useState("");
  const [diagnosisHint, setDiagnosisHint] = React.useState("");
  const [notes, setNotes] = React.useState("");

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Новый случай пациента</DialogTitle></DialogHeader>
      <div className="space-y-4 py-2">
        <div className="text-sm rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-amber-800 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>Не вводите ФИО и персональные данные. Случай идентифицируется по коду. Год рождения и пол — опциональны.</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="birthYear">Год рождения</Label>
            <Input id="birthYear" type="number" placeholder="1980" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Пол</Label>
            <Select value={sex} onValueChange={setSex}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="М">Мужской</SelectItem>
                <SelectItem value="Ж">Женский</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="diag">Предварительный диагноз</Label>
          <Input id="diag" placeholder="Напр. рак молочной железы" value={diagnosisHint} onChange={(e) => setDiagnosisHint(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Заметки</Label>
          <Textarea id="notes" placeholder="Дополнительная информация (без персональных данных)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
        <Button onClick={() => onSubmit({ birthYear: birthYear ? Number(birthYear) : undefined, sex: sex || undefined, diagnosisHint: diagnosisHint || undefined, notes: notes || undefined })} disabled={loading} className="bg-medical-gradient text-white hover:opacity-90">{loading ? "Создание…" : "Создать"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

