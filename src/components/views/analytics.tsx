"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  LineChart,
  Line,
} from "recharts";
import {
  ClipboardList,
  FileText,
  Dna,
  ShieldCheck,
  Users,
  PieChart as PieChartIcon,
  Activity,
  Sparkles,
  TrendingUp,
  Cpu,
  Hand,
  FlaskConical,
  ShieldAlert,
  ClipboardCheck,
  UserRound,
  Calendar,
  Pill,
  HeartPulse,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

interface Totals {
  cases: number;
  documents: number;
  analyses: number;
  reports: number;
  recommendations: number;
  doctors: number;
}

interface EmrAnalytics {
  totals: {
    patients: number;
    activePatients: number;
    vitalSigns: number;
    labResults: number;
    medications: number;
    activeMedications: number;
    visits: number;
    problems: number;
    activeProblems: number;
    allergyPatientCount: number;
  };
  patientsBySex: Array<{ sex: string; count: number }>;
  patientsByAgeGroup: Array<{ group: string; count: number }>;
  patientsByBloodType: Array<{ type: string; count: number }>;
  chronicDiseasesDist: Array<{ name: string; count: number }>;
  allergyRate: number;
  labResultsByFlag: Array<{ flag: string; count: number }>;
  labResultsByCategory: Array<{ category: string; count: number }>;
  labAbnormalityRate: number;
  topMedications: Array<{ name: string; count: number }>;
  visitsByType: Array<{ type: string; count: number }>;
  topProblemsIcd10: Array<{ code: string; count: number }>;
  hypertensionRate: number;
  avgVitals: { systolicBP: number; diastolicBP: number; heartRate: number; oxygenSaturation: number };
}

interface AnalyticsData {
  totals: Totals;
  casesByStatus: Array<{ status: string; count: number }>;
  casesByMonth: Array<{ month: string; count: number }>;
  documentsByType: Array<{ type: string; count: number }>;
  topGenes: Array<{ gene: string; count: number }>;
  reportsByStatus: Array<{ status: string; count: number }>;
  avgConfidence: { diagnosis: number; therapy: number; prognosis: number } | null;
  aiAvailability?: { aiAvailable: number; manual: number };
  recentActivity: Array<{ date: string; count: number }>;
  ddiAlertsBySeverity?: Array<{ severity: string; count: number }>;
  consentComplianceRate?: number;
  emrAnalytics?: EmrAnalytics;
}

type Accent = "emerald" | "blue" | "purple" | "amber" | "slate" | "red";

function getStatusMeta(locale: Locale): Record<string, { label: string; color: string }> {
  return {
    new: { label: t("dashboard.status.new", locale), color: "#64748b" },
    uploaded: { label: t("dashboard.status.uploaded", locale), color: "#3b82f6" },
    analyzing: { label: t("dashboard.status.analyzing", locale), color: "#f59e0b" },
    analyzed: { label: t("dashboard.status.analyzed", locale), color: "#10b981" },
    reported: { label: t("dashboard.status.reported", locale), color: "#a855f7" },
  };
}

function getDocTypeMeta(locale: Locale): Record<string, { label: string; color: string }> {
  return {
    discharge: { label: locale === "ru" ? "Выписки" : "Discharge", color: "#3b82f6" },
    genetic: { label: locale === "ru" ? "Генетические" : "Genetic", color: "#10b981" },
    image: { label: locale === "ru" ? "Изображения" : "Images", color: "#a855f7" },
  };
}

function getReportStatusMeta(locale: Locale): Record<string, { label: string; color: string }> {
  return {
    draft: { label: locale === "ru" ? "Черновик" : "Draft", color: "#f59e0b" },
    approved: { label: locale === "ru" ? "Утверждён" : "Approved", color: "#10b981" },
    signed: { label: locale === "ru" ? "Подписан" : "Signed", color: "#8b5cf6" },
  };
}

const ACCENT_BG: Record<Accent, string> = {
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  slate: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function confidenceColor(v: number): "emerald" | "blue" | "amber" | "red" {
  if (v >= 0.8) return "emerald";
  if (v >= 0.5) return "blue";
  if (v >= 0.3) return "amber";
  return "red";
}

export function Analytics() {
  const locale = useAppStore((s) => s.locale);
  const STATUS_META = getStatusMeta(locale);
  const DOC_TYPE_META = getDocTypeMeta(locale);
  const REPORT_STATUS_META = getReportStatusMeta(locale);

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ["analytics"],
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000),
    queryFn: async () => {
      // v2.6.2: cookie-only аутентификация — HttpOnly-cookie отправляется
      // автоматически (same-origin). Bearer-инъекция из localStorage удалена
      // (регрессия: getAuthToken() всегда null → запрос не отправлялся).
      const res = await fetch("/api/analytics", { credentials: "include" });
      if (!res.ok) throw new Error(t("common.error", locale));
      return res.json() as Promise<AnalyticsData>;
    },
  });

  if (isLoading) return <AnalyticsSkeleton locale={locale} />;
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          {locale === "ru" ? "Не удалось загрузить аналитику. Попробуйте обновить страницу." : "Failed to load analytics. Try refreshing the page."}
        </CardContent>
      </Card>
    );
  }

  const statusData = data.casesByStatus.map((b) => ({ name: STATUS_META[b.status]?.label ?? b.status, count: b.count, color: STATUS_META[b.status]?.color ?? "#94a3b8" }));
  const docTypeData = data.documentsByType.map((b) => ({ name: DOC_TYPE_META[b.type]?.label ?? b.type, count: b.count, color: DOC_TYPE_META[b.type]?.color ?? "#94a3b8" }));
  const reportsData = data.reportsByStatus.map((b) => ({ name: REPORT_STATUS_META[b.status]?.label ?? b.status, count: b.count, color: REPORT_STATUS_META[b.status]?.color ?? "#94a3b8" }));
  const recentData = data.recentActivity.map((b) => ({ ...b, label: b.date.slice(5).replace("-", ".") }));

  return (
    <div className="space-y-6">
      {/* Hero header with gradient accent */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 opacity-10">
          <Activity className="h-32 w-32 text-primary" />
        </div>
        <div className="relative space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <TrendingUp className="h-3.5 w-3.5" />
            {locale === "ru" ? "Клиническая аналитика" : "Clinical Analytics"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("analytics.title", locale)}</h1>
          <p className="text-sm text-muted-foreground">{t("analytics.subtitle", locale)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={ClipboardList} label={locale === "ru" ? "Случаи" : "Cases"} value={data.totals.cases} accent="emerald" />
        <StatCard icon={FileText} label={locale === "ru" ? "Документы" : "Documents"} value={data.totals.documents} accent="blue" />
        <StatCard icon={FlaskConical} label={locale === "ru" ? "Анализы" : "Analyses"} value={data.totals.analyses} accent="purple" />
        <StatCard icon={ShieldCheck} label={locale === "ru" ? "Отчёты" : "Reports"} value={data.totals.reports} accent="amber" />
        <StatCard icon={Dna} label={locale === "ru" ? "Рекомендации" : "Recommendations"} value={data.totals.recommendations} accent="emerald" />
        <StatCard icon={Users} label={locale === "ru" ? "Врачи" : "Doctors"} value={data.totals.doctors} accent="slate" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title={locale === "ru" ? "Случаи по статусам" : "Cases by Status"} icon={PieChartIcon}>
          {statusData.length === 0 ? <EmptyChart locale={locale} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Случаи за 6 месяцев" : "Cases (6 months)"} icon={TrendingUp}>
          {data.casesByMonth.length === 0 ? <EmptyChart locale={locale} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.casesByMonth}>
                <defs><linearGradient id="casesGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.5} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" name={locale === "ru" ? "Случаи" : "Cases"} stroke="#10b981" strokeWidth={2} fill="url(#casesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Документы по типам" : "Documents by Type"} icon={FileText}>
          {docTypeData.length === 0 ? <EmptyChart locale={locale} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={docTypeData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" name={locale === "ru" ? "Документы" : "Documents"} radius={[6, 6, 0, 0]}>{docTypeData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Топ генов" : "Top Genes"} icon={Dna}>
          {data.topGenes.length === 0 ? <EmptyChart locale={locale} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.topGenes} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="gene" tick={{ fontSize: 12 }} width={70} />
                <Tooltip />
                <Bar dataKey="count" name={locale === "ru" ? "Упоминания" : "Mentions"} fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Отчёты по статусам" : "Reports by Status"} icon={ShieldCheck}>
          {reportsData.length === 0 ? <EmptyChart locale={locale} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={reportsData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {reportsData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Средняя уверенность модели" : "Average Model Confidence"} icon={Sparkles}>
          {data.avgConfidence ? (
            <div className="space-y-4 py-2">
              <ConfidenceRow label={locale === "ru" ? "Диагноз" : "Diagnosis"} value={data.avgConfidence.diagnosis} />
              <ConfidenceRow label={locale === "ru" ? "Терапия" : "Therapy"} value={data.avgConfidence.therapy} />
              <ConfidenceRow label={locale === "ru" ? "Прогноз" : "Prognosis"} value={data.avgConfidence.prognosis} />
            </div>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Активность за 7 дней" : "Activity (7 days)"} icon={Activity}>
          {recentData.length === 0 ? <EmptyChart locale={locale} /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={recentData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name={locale === "ru" ? "События" : "Events"} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Режим анализа" : "Analysis Mode"} icon={Cpu}>
          <div className="grid grid-cols-2 gap-3 py-2">
            <BigNumberCard icon={Cpu} label={locale === "ru" ? "ИИ-анализ" : "AI Analysis"} value={data.aiAvailability?.aiAvailable ?? 0} accent="emerald" />
            <BigNumberCard icon={Hand} label={locale === "ru" ? "Ручной режим" : "Manual Mode"} value={data.aiAvailability?.manual ?? 0} accent="amber" />
          </div>
        </ChartCard>

        <ChartCard title={locale === "ru" ? "DDI-алерты по серьёзности" : "DDI Alerts by Severity"} icon={ShieldAlert}>
          {(data.ddiAlertsBySeverity?.length ?? 0) > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.ddiAlertsBySeverity ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="severity" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" name={locale === "ru" ? "Алерты" : "Alerts"} fill="#ef4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        <ChartCard title={locale === "ru" ? "Соответствие согласий" : "Consent Compliance"} icon={ClipboardCheck}>
          {data.consentComplianceRate !== undefined && data.consentComplianceRate !== null ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="text-4xl font-bold tabular-nums text-emerald-600">{Math.round(data.consentComplianceRate * 100)}%</div>
              <p className="mt-2 text-sm text-muted-foreground">{locale === "ru" ? "Согласий получено" : "Consents obtained"}</p>
            </div>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>
      </div>

      {/* EMR / Patient Population Health Analytics (v2.5.3) */}
      {data.emrAnalytics && data.emrAnalytics.totals.patients > 0 && (
        <EmrAnalyticsSection data={data.emrAnalytics} locale={locale} />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: number; accent: Accent }) {
  const RING: Record<Accent, string> = {
    emerald: "ring-emerald-500/20",
    blue: "ring-sky-500/20",
    purple: "ring-violet-500/20",
    amber: "ring-amber-500/20",
    slate: "ring-slate-500/20",
    red: "ring-red-500/20",
  };
  return (
    <Card className={cn("ring-1 transition-all hover:shadow-md", RING[accent])}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", ACCENT_BG[accent])}><Icon className="h-5 w-5" /></div>
          <div className="min-w-0">
            <div className="truncate text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyChart({ locale }: { locale: Locale }) {
  return <div className="flex h-[260px] flex-col items-center justify-center text-sm text-muted-foreground"><Activity className="mb-2 h-8 w-8 opacity-30" />{t("common.noData", locale)}</div>;
}

function ConfidenceRow({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = confidenceColor(value);
  const CONF_BAR: Record<string, string> = { emerald: "bg-emerald-500", blue: "bg-blue-500", amber: "bg-amber-500", red: "bg-red-500" };
  const CONF_TEXT: Record<string, string> = { emerald: "text-emerald-600 dark:text-emerald-400", blue: "text-blue-600 dark:text-blue-400", amber: "text-amber-600 dark:text-amber-400", red: "text-red-600 dark:text-red-400" };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={cn("font-semibold tabular-nums", CONF_TEXT[color])}>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", CONF_BAR[color])} style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
      </div>
    </div>
  );
}

function BigNumberCard({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: number; accent: "emerald" | "amber" }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className={cn("mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full", ACCENT_BG[accent])}><Icon className="h-6 w-6" /></div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function AnalyticsSkeleton({ locale }: { locale: Locale }) {
  return (
    <div className="space-y-6">
      <div><Skeleton className="h-8 w-40" /><Skeleton className="mt-2 h-4 w-80" /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => (<Skeleton key={i} className="h-20" />))}</div>
      <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 10 }).map((_, i) => (<Skeleton key={i} className="h-72" />))}</div>
    </div>
  );
}

// ============================================================================
// EMR Analytics Section (v2.5.3) — patient population health metrics
// ============================================================================
function EmrAnalyticsSection({ data, locale }: { data: EmrAnalytics; locale: Locale }) {
  const ru = locale === "ru";

  const SEX_LABELS: Record<string, string> = { "М": ru ? "Муж" : "Male", "Ж": ru ? "Жен" : "Female", "Не указан": ru ? "Не указан" : "Unknown" };
  const SEX_COLORS: Record<string, string> = { "М": "#0ea5e9", "Ж": "#f43f5e", "Не указан": "#94a3b8" };

  const LAB_FLAG_LABELS: Record<string, string> = {
    normal: ru ? "Норма" : "Normal",
    low: ru ? "↓ Снижен" : "Low",
    high: ru ? "↑ Повышен" : "High",
    critical: ru ? "⚠ Критич." : "Critical",
    abnormal: ru ? "Отклонение" : "Abnormal",
  };
  const LAB_FLAG_COLORS: Record<string, string> = {
    normal: "#10b981", low: "#0ea5e9", high: "#f59e0b", critical: "#ef4444", abnormal: "#a855f7",
  };

  const VISIT_TYPE_LABELS: Record<string, string> = {
    outpatient: ru ? "Амбулаторный" : "Outpatient",
    inpatient: ru ? "Стационарный" : "Inpatient",
    emergency: ru ? "Экстренный" : "Emergency",
    telemedicine: ru ? "Телемедицина" : "Telemedicine",
    home: ru ? "Дом" : "Home",
    consultation: ru ? "Консультация" : "Consultation",
  };

  const LAB_CATEGORY_LABELS: Record<string, string> = {
    hematology: ru ? "Гематология" : "Hematology",
    biochemistry: ru ? "Биохимия" : "Biochemistry",
    electrolytes: ru ? "Электролиты" : "Electrolytes",
    lipids: ru ? "Липиды" : "Lipids",
    endocrinology: ru ? "Эндокринология" : "Endocrinology",
    coagulation: ru ? "Коагулология" : "Coagulation",
    immunology: ru ? "Иммунология" : "Immunology",
    urinalysis: ru ? "Моча" : "Urinalysis",
    general: ru ? "Общая" : "General",
  };

  const ageData = data.patientsByAgeGroup.map(a => ({ name: a.group, count: a.count }));
  const sexData = data.patientsBySex.map(s => ({ name: SEX_LABELS[s.sex] || s.sex, value: s.count, color: SEX_COLORS[s.sex] || "#94a3b8" }));
  const labFlagData = data.labResultsByFlag.map(f => ({ name: LAB_FLAG_LABELS[f.flag] || f.flag, count: f.count, color: LAB_FLAG_COLORS[f.flag] || "#94a3b8" }));
  const visitTypeData = data.visitsByType.map(v => ({ name: VISIT_TYPE_LABELS[v.type] || v.type, count: v.count }));
  const labCatData = data.labResultsByCategory.map(c => ({ name: LAB_CATEGORY_LABELS[c.category] || c.category, count: c.count }));

  return (
    <>
      {/* EMR section header */}
      <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 p-5">
        <div className="absolute right-0 top-0 h-32 w-32 -translate-y-8 translate-x-8 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">{ru ? "Аналитика пациентов (ЭМК)" : "Patient Analytics (EMR)"}</h2>
            <p className="text-xs text-muted-foreground">{ru ? "Здоровье популяции: демография, хронические заболевания, лабораторные отклонения" : "Population health: demographics, chronic diseases, lab abnormalities"}</p>
          </div>
        </div>
      </div>

      {/* EMR KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <EmrStatCard icon={UserRound} label={ru ? "Пациентов" : "Patients"} value={data.totals.patients} sub={ru ? `${data.totals.activePatients} активных` : `${data.totals.activePatients} active`} accent="emerald" />
        <EmrStatCard icon={Calendar} label={ru ? "Визитов" : "Visits"} value={data.totals.visits} accent="sky" />
        <EmrStatCard icon={Pill} label={ru ? "Препаратов" : "Medications"} value={data.totals.medications} sub={ru ? `${data.totals.activeMedications} активных` : `${data.totals.activeMedications} active`} accent="violet" />
        <EmrStatCard icon={FlaskConical} label={ru ? "Анализов" : "Lab Results"} value={data.totals.labResults} sub={`${data.labAbnormalityRate}% ${ru ? "отклон." : "abnormal"}`} accent="amber" />
        <EmrStatCard icon={ShieldAlert} label={ru ? "Аллергии" : "Allergies"} value={data.totals.allergyPatientCount} sub={`${data.allergyRate}% ${ru ? "пациентов" : "of patients"}`} accent="rose" />
      </div>

      {/* Demographics + clinical risk */}
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title={ru ? "Пациенты по полу" : "Patients by Sex"} icon={UserRound}>
          {sexData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={sexData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {sexData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        <ChartCard title={ru ? "Возрастные группы" : "Age Groups"} icon={Activity}>
          {ageData.some(a => a.count > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={ageData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name={ru ? "Пациенты" : "Patients"} fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        {/* Lab abnormalities pie */}
        <ChartCard title={ru ? "Результаты анализов по флагам" : "Lab Results by Flag"} icon={FlaskConical}>
          {labFlagData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={labFlagData} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {labFlagData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        {/* Top chronic diseases */}
        <ChartCard title={ru ? "Топ хронических заболеваний" : "Top Chronic Diseases"} icon={ClipboardList}>
          {data.chronicDiseasesDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.chronicDiseasesDist} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Bar dataKey="count" name={ru ? "Пациенты" : "Patients"} fill="#f59e0b" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        {/* Top medications */}
        <ChartCard title={ru ? "Топ назначаемых препаратов" : "Top Prescribed Medications"} icon={Pill}>
          {data.topMedications.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.topMedications} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Bar dataKey="count" name={ru ? "Назначения" : "Prescriptions"} fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>

        {/* Visits by type */}
        <ChartCard title={ru ? "Визиты по типам" : "Visits by Type"} icon={Calendar}>
          {visitTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={visitTypeData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name={ru ? "Визиты" : "Visits"} fill="#0ea5e9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart locale={locale} />}
        </ChartCard>
      </div>

      {/* Clinical risk indicators */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="ring-1 ring-rose-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <HeartPulse className="h-4 w-4 text-rose-500" /> {ru ? "Частота гипертонии" : "Hypertension Rate"}
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums text-rose-600">{data.hypertensionRate}%</div>
            <p className="mt-1 text-xs text-muted-foreground">{ru ? "Измерений АД ≥ 140/90" : "BP readings ≥ 140/90"}</p>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{ru ? "Среднее АД" : "Avg BP"}</span>
              <span className="font-mono font-medium">{data.avgVitals.systolicBP}/{data.avgVitals.diastolicBP}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-amber-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> {ru ? "Лабораторные отклонения" : "Lab Abnormalities"}
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums text-amber-600">{data.labAbnormalityRate}%</div>
            <p className="mt-1 text-xs text-muted-foreground">{ru ? "Результатов вне нормы" : "Results out of range"}</p>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{ru ? "Всего анализов" : "Total labs"}</span>
              <span className="font-mono font-medium">{data.totals.labResults}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-violet-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-violet-500" /> {ru ? "Активные проблемы" : "Active Problems"}
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums text-violet-600">{data.totals.activeProblems}</div>
            <p className="mt-1 text-xs text-muted-foreground">{ru ? "Из" : "Of"} {data.totals.problems} {ru ? "всего" : "total"}</p>
            {data.topProblemsIcd10.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="text-xs text-muted-foreground">{ru ? "Топ МКБ-10:" : "Top ICD-10:"}</div>
                <div className="flex flex-wrap gap-1">
                  {data.topProblemsIcd10.slice(0, 4).map((c, i) => (
                    <span key={i} className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-300">{c.code} ({c.count})</span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lab categories distribution */}
      {labCatData.length > 0 && (
        <ChartCard title={ru ? "Анализы по категориям" : "Lab Results by Category"} icon={FlaskConical}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={labCatData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name={ru ? "Анализы" : "Labs"} fill="#8b5cf6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </>
  );
}

function EmrStatCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
  accent: "emerald" | "sky" | "violet" | "amber" | "rose";
}) {
  const GRADIENT: Record<string, string> = {
    emerald: "from-emerald-500 to-teal-600",
    sky: "from-sky-500 to-cyan-600",
    violet: "from-violet-500 to-purple-600",
    amber: "from-amber-500 to-orange-600",
    rose: "from-rose-500 to-pink-600",
  };
  return (
    <Card className="overflow-hidden border-none shadow-sm transition-all hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow", GRADIENT[accent])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-tight tabular-nums">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          {sub && <div className="truncate text-[10px] text-muted-foreground/70">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
