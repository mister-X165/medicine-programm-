"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  User,
  Trash2,
  Eye,
  UserX,
  UserCheck,
  Loader2,
  AlertTriangle,
  Users,
  FolderOpen,
  Search,
  RefreshCw,
  KeyRound,
  BadgeCheck,
  FileText,
  AlertCircle,
  Info,
  Bug,
  Database,
  Download,
  Upload,
  HardDrive,
  ShieldCheck,
  Lock,
  ScrollText,
  Globe,
  Plus,
  Check,
  X,
  ChevronDown,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useE2EESession } from "@/lib/e2ee/session";
import { CryptoSelfTestButton } from "@/components/e2ee/e2ee-provider";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AdminPanel() {
  const { currentDoctor, locale, setLocale } = useAppStore();
  const qc = useQueryClient();
  const [searchDoctors, setSearchDoctors] = React.useState("");
  const [searchCases, setSearchCases] = React.useState("");
  const [logFilter, setLogFilter] = React.useState<{ level?: string; category?: string; search?: string }>({});

  const { data: doctorsData, isLoading: doctorsLoading } = useQuery({ queryKey: ["doctors"], queryFn: api.getDoctors });
  const { data: casesData, isLoading: casesLoading } = useQuery({ queryKey: ["cases"], queryFn: api.getCases });

  const doctors = (doctorsData?.doctors ?? []).filter((d) =>
    !searchDoctors.trim() || d.fullName.toLowerCase().includes(searchDoctors.toLowerCase().trim()) || (d.doctorCode ?? "").toLowerCase().includes(searchDoctors.toLowerCase().trim()) || d.specialization.toLowerCase().includes(searchDoctors.toLowerCase().trim())
  );

  const cases = (casesData?.cases ?? []).filter((c) =>
    !searchCases.trim() || c.caseCode.toLowerCase().includes(searchCases.toLowerCase().trim()) || (c.diagnosisHint ?? "").toLowerCase().includes(searchCases.toLowerCase().trim())
  );

  const deleteDoctorMut = useMutation({
    mutationFn: (id: string) => api.deleteDoctor(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["doctors"] }); toast.success(locale === "ru" ? "Профиль врача удалён" : "Doctor profile deleted"); },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка удаления профиля" : "Error deleting profile" + ": " + e.message),
  });

  const updateDoctorMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { isActive?: boolean; role?: string } }) => api.updateDoctor(id, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["doctors"] });
      if (vars.data.isActive === false) toast.success(locale === "ru" ? "Профиль деактивирован" : "Profile deactivated");
      else if (vars.data.isActive === true) toast.success(locale === "ru" ? "Профиль активирован" : "Profile activated");
      else if (vars.data.role) toast.success(locale === "ru" ? "Роль обновлена" : "Role updated");
    },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка обновления" : "Update error" + ": " + e.message),
  });

  const deleteCaseMut = useMutation({
    mutationFn: (id: string) => api.deleteCase(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cases"] }); toast.success(locale === "ru" ? "Кейс пациента удалён" : "Patient case deleted"); },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка удаления кейса" : "Error deleting case" + ": " + e.message),
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({ queryKey: ["logs", logFilter], queryFn: () => api.getLogs({ ...logFilter, limit: 100 }) });
  const { data: logStatsData } = useQuery({ queryKey: ["logStats"], queryFn: api.getLogStats });

  const deleteLogsMut = useMutation({
    mutationFn: () => api.deleteAllLogs(),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["logs"] }); qc.invalidateQueries({ queryKey: ["logStats"] }); toast.success(locale === "ru" ? `Удалено записей: ${res.deleted}` : `Deleted records: ${res.deleted}`); },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка удаления логов" : "Error deleting logs" + ": " + e.message),
  });

  const seedMut = useMutation({
    mutationFn: () => api.seed(),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["doctors"] }); qc.invalidateQueries({ queryKey: ["cases"] }); qc.invalidateQueries({ queryKey: ["health"] }); toast.success(locale === "ru" ? `Система инициализирована. Рекомендаций: ${res.count}` : `System initialized. Recommendations: ${res.count}`); },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка инициализации" : "Initialization error" + ": " + e.message),
  });

  // v2.6: "Add doctor" — админ создаёт аккаунт через POST /api/doctors
  // (admin-only, с паролем). Публичная саморегистрация закрыта
  // (REGISTRATION_OPEN=false — enterprise policy). Врач при первом входе
  // сам создаст ключ E2EE (enroll) — данные будут зашифрованы его ключом.
  const [addDoctorOpen, setAddDoctorOpen] = React.useState(false);
  const [newDocFullName, setNewDocFullName] = React.useState("");
  const [newDocSpec, setNewDocSpec] = React.useState("");
  const [newDocCode, setNewDocCode] = React.useState("");
  const [newDocPassword, setNewDocPassword] = React.useState("");
  const [createdDoctor, setCreatedDoctor] = React.useState<{ code: string; password: string } | null>(null);

  // Patient management state
  const [addPatientOpen, setAddPatientOpen] = React.useState(false);
  const [newPatientLastName, setNewPatientLastName] = React.useState("");
  const [newPatientFirstName, setNewPatientFirstName] = React.useState("");
  const [newPatientMiddleName, setNewPatientMiddleName] = React.useState("");
  const [newPatientBirthDate, setNewPatientBirthDate] = React.useState("");
  const [newPatientSex, setNewPatientSex] = React.useState("");
  const [newPatientBloodType, setNewPatientBloodType] = React.useState("");
  const [newPatientSnils, setNewPatientSnils] = React.useState("");
  const [newPatientOmi, setNewPatientOmi] = React.useState("");

  const resetPatientForm = () => {
    setNewPatientLastName("");
    setNewPatientFirstName("");
    setNewPatientMiddleName("");
    setNewPatientBirthDate("");
    setNewPatientSex("");
    setNewPatientBloodType("");
    setNewPatientSnils("");
    setNewPatientOmi("");
  };

  const { data: patientsData, isLoading: patientsLoading } = useQuery({
    queryKey: ["patients-admin"],
    queryFn: () => api.getPatients(),
  });

  const patients = patientsData?.patients ?? [];

  const addPatientMut = useMutation({
    mutationFn: () =>
      api.createPatient({
        lastName: newPatientLastName.trim(),
        firstName: newPatientFirstName.trim(),
        middleName: newPatientMiddleName.trim(),
        birthDate: newPatientBirthDate || undefined,
        sex: newPatientSex || undefined,
        bloodType: newPatientBloodType.trim(),
        snils: newPatientSnils.trim(),
        omiPolicy: newPatientOmi.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients-admin"] });
      setAddPatientOpen(false);
      resetPatientForm();
      toast.success(locale === "ru" ? "Пациент добавлен" : "Patient added");
    },
    onError: (e: Error) => toast.error((locale === "ru" ? "Ошибка добавления пациента" : "Error adding patient") + ": " + e.message),
  });

  const deletePatientMut = useMutation({
    mutationFn: (id: string) => api.archivePatient(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["patients-admin"] }); toast.success(locale === "ru" ? "Пациент архивирован" : "Patient archived"); },
    onError: (e: Error) => toast.error((locale === "ru" ? "Ошибка архивации" : "Archive error") + ": " + e.message),
  });

  const addDoctorMut = useMutation({
    mutationFn: () =>
      api.createDoctor({
        fullName: newDocFullName.trim(),
        specialization: newDocSpec.trim(),
        doctorCode: newDocCode.trim(),
        password: newDocPassword,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["doctors"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      const creds = {
        code: res.doctor.doctorCode,
        password: newDocPassword,
      };
      setCreatedDoctor(creds);
      toast.success(
        locale === "ru"
          ? `Врач ${res.doctor.fullName} (${res.doctor.doctorCode}) добавлен`
          : `Doctor ${res.doctor.fullName} (${res.doctor.doctorCode}) added`,
        {
          description: locale === "ru"
            ? "При первом входе врач создаст личный ключ шифрования E2EE"
            : "On first login the doctor will create a personal E2EE key",
          duration: 10000,
        },
      );
      setNewDocFullName("");
      setNewDocSpec("");
      setNewDocCode("");
      setNewDocPassword("");
    },
    onError: (e: Error) => toast.error((locale === "ru" ? "Ошибка создания врача" : "Error creating doctor") + ": " + e.message),
  });

  // ────────────────────────────────────────────────────────────────────────
  // v2.3.2 (Task 4): Admin "Create Case" dialog.
  //
  // Admins can manually file a patient case for ANY doctor in the system
  // (not just themselves). The form also allows pre-assigning ICD-10 codes
  // via a cmdk-based multi-select that searches /api/icd10?q=… in real time.
  // On submit we call api.createCase with the admin `doctorId` field — the
  // server enforces role === "admin" before honoring reassignment.
  // ────────────────────────────────────────────────────────────────────────
  const [createCaseOpen, setCreateCaseOpen] = React.useState(false);
  const [newCaseDoctorId, setNewCaseDoctorId] = React.useState("");
  const [newCaseBirthYear, setNewCaseBirthYear] = React.useState("");
  const [newCaseSex, setNewCaseSex] = React.useState("");
  const [newCaseDiagnosis, setNewCaseDiagnosis] = React.useState("");
  const [newCaseNotes, setNewCaseNotes] = React.useState("");
  const [icd10Query, setIcd10Query] = React.useState("");
  const [icd10PopoverOpen, setIcd10PopoverOpen] = React.useState(false);
  const [icd10Selected, setIcd10Selected] = React.useState<Array<{ code: string; description: string }>>([]);

  // Lazy ICD-10 lookup — only fires when the admin types ≥2 chars.
  const { data: icd10Results, isFetching: icd10Fetching } = useQuery({
    queryKey: ["icd10-search", icd10Query],
    queryFn: () => api.getICD10Codes({ q: icd10Query, limit: 30 }),
    enabled: icd10Query.trim().length >= 2,
    staleTime: 30_000,
  });

  const resetCreateCaseForm = () => {
    setNewCaseDoctorId("");
    setNewCaseBirthYear("");
    setNewCaseSex("");
    setNewCaseDiagnosis("");
    setNewCaseNotes("");
    setIcd10Query("");
    setIcd10Selected([]);
    setIcd10PopoverOpen(false);
  };

  const openCreateCase = () => {
    // Default the doctor dropdown to the current admin.
    setNewCaseDoctorId(currentDoctor?.id ?? "");
    setCreateCaseOpen(true);
  };

  const createCaseMut = useMutation({
    mutationFn: () =>
      api.createCase({
        doctorId: newCaseDoctorId || currentDoctor?.id,
        birthYear: newCaseBirthYear ? Number(newCaseBirthYear) : undefined,
        sex: newCaseSex || undefined,
        diagnosisHint: newCaseDiagnosis.trim() || undefined,
        notes: newCaseNotes.trim() || undefined,
        icd10Codes:
          icd10Selected.length > 0
            ? icd10Selected.map((c) => ({ ...c, confidence: 1, source: "manual" as const }))
            : undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      toast.success(
        locale === "ru"
          ? `Кейс ${res.case.caseCode} создан`
          : `Case ${res.case.caseCode} created`,
        {
          description:
            locale === "ru"
              ? `Назначен врачу: ${res.case.doctor?.fullName ?? "—"}`
              : `Assigned to: ${res.case.doctor?.fullName ?? "—"}`,
          duration: 8000,
        },
      );
      resetCreateCaseForm();
      setCreateCaseOpen(false);
    },
    onError: (e: Error) =>
      toast.error((locale === "ru" ? "Ошибка создания кейса" : "Error creating case") + ": " + e.message),
  });

  // createBackup() returns the raw BackupData object directly (no wrapper).
  // We serialize it to JSON and trigger a browser download with a dated
  // filename `sppvr-backup-YYYYMMDD.json`.
  const backupMut = useMutation({
    mutationFn: () => api.createBackup(),
    onSuccess: (backup) => {
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = `sppvr-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(locale === "ru" ? `Резервная копия создана (${(blob.size / 1024).toFixed(1)} КБ)` : `Backup created (${(blob.size / 1024).toFixed(1)} KB)`);
    },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка создания резервной копии" : "Error creating backup" + ": " + e.message),
  });

  // Audit log — immutable (WORM) since v2.1.
  // The `clearAuditLog` API call has been removed from the backend; the
  // admin-panel UI now shows a read-only compliance notice instead of a
  // destructive "clear" button. This complies with ФЗ-152 ст. 18 ч. 3
  // (no deletion of access logs) and HIPAA §164.312(c) (integrity).

  // File encryption
  const { data: encryptionStatus } = useQuery({ queryKey: ["encryption-status"], queryFn: api.getEncryptionStatus });
  // v2.6: Центр безопасности — состояние E2EE и верификация цепочки аудита
  const e2eeStatus = useE2EESession((s) => s.status);
  // v2.6.2: Инвентарь шифрования — СЕРВЕРНЫЙ подсчёт enc:v1: в БД
  // (клиентский список расшифрован API-слоем — там шифротекст не виден)
  const e2eeCoverage = encryptionStatus?.e2eeCoverage ?? { total: 0, encrypted: 0, legacy: 0, pct: 100 };
  const { data: auditVerify, isLoading: auditVerifyLoading, refetch: refetchAuditVerify } = useQuery({
    queryKey: ["audit-verify"],
    queryFn: api.verifyAuditChain,
    staleTime: 60000,
  });
  const encryptMut = useMutation({
    mutationFn: () => api.encryptAllFiles(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["encryption-status"] });
      toast.success(locale === "ru" ? `Зашифровано файлов: ${res.encrypted}. Пропущено: ${res.skipped}. Ошибок: ${res.failed}` : `Files encrypted: ${res.encrypted}. Skipped: ${res.skipped}. Failed: ${res.failed}`);
    },
    onError: (e: Error) => toast.error(locale === "ru" ? "Ошибка шифрования" : "Encryption error" + ": " + e.message),
  });

  if (!currentDoctor || currentDoctor.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Shield className="mb-4 h-16 w-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">{t("admin.accessDenied", locale)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("admin.accessDeniedHint", locale)}</p>
      </div>
    );
  }

  const stats = {
    totalDoctors: doctorsData?.doctors?.length ?? 0,
    activeDoctors: doctorsData?.doctors?.filter((d) => d.isActive !== false).length ?? 0,
    admins: doctorsData?.doctors?.filter((d) => d.role === "admin").length ?? 0,
    totalCases: casesData?.cases?.length ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* Hero header with gradient accent */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 opacity-10">
          <Shield className="h-32 w-32 text-amber-600" />
        </div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Shield className="h-3.5 w-3.5" />
              {locale === "ru" ? "Панель администратора" : "Admin Panel"}
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
              {t("admin.title", locale)}
            </h1>
            <p className="text-sm text-muted-foreground">{t("admin.subtitle", locale)}</p>
          </div>
          <Button className="gap-2 bg-medical-gradient text-white shadow-lg shadow-emerald-500/20 hover:opacity-90" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            {seedMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("admin.initSystem", locale)}
          </Button>
        </div>
      </div>

      {/* Stat cards with colored rings */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="ring-1 ring-amber-500/20 transition-all hover:shadow-md"><CardContent className="flex items-center gap-3 p-3 sm:p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600"><Users className="h-4 w-4" /></div><div><div className="truncate text-xs text-muted-foreground">{t("admin.doctors", locale)}</div><div className="text-xl font-bold tabular-nums">{stats.totalDoctors}</div></div></CardContent></Card>
        <Card className="ring-1 ring-emerald-500/20 transition-all hover:shadow-md"><CardContent className="flex items-center gap-3 p-3 sm:p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600"><UserCheck className="h-4 w-4" /></div><div><div className="truncate text-xs text-muted-foreground">{t("admin.active", locale)}</div><div className="text-xl font-bold tabular-nums">{stats.activeDoctors}</div></div></CardContent></Card>
        <Card className="ring-1 ring-sky-500/20 transition-all hover:shadow-md"><CardContent className="flex items-center gap-3 p-3 sm:p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600"><FolderOpen className="h-4 w-4" /></div><div><div className="truncate text-xs text-muted-foreground">{t("admin.cases", locale)}</div><div className="text-xl font-bold tabular-nums">{stats.totalCases}</div></div></CardContent></Card>
        <Card className="ring-1 ring-violet-500/20 transition-all hover:shadow-md"><CardContent className="flex items-center gap-3 p-3 sm:p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600"><Shield className="h-4 w-4" /></div><div><div className="truncate text-xs text-muted-foreground">{t("admin.admins", locale)}</div><div className="text-xl font-bold tabular-nums">{stats.admins}</div></div></CardContent></Card>
      </div>

      {/* Language Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Globe className="h-5 w-5" />{t("common.language", locale)}</CardTitle>
          <CardDescription className="text-sm mt-1">{locale === "ru" ? "Выберите язык интерфейса" : "Select interface language"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button
              variant={locale === "ru" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setLocale("ru")}
            >
              🇷🇺 {t("common.russian", locale)}
            </Button>
            <Button
              variant={locale === "en" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setLocale("en")}
            >
              🇬🇧 {t("common.english", locale)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Doctors Management */}
      <Card>
        <CardHeader>
          <div className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5" />{t("admin.doctorProfiles", locale)}</CardTitle>
              <CardDescription className="text-sm mt-1">{t("admin.doctorProfilesHint", locale)}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{doctors.length}</Badge>
              <Button size="sm" className="gap-1.5" onClick={() => { setCreatedDoctor(null); setAddDoctorOpen(true); }}>
                <Plus className="h-3.5 w-3.5" />
                {locale === "ru" ? "Добавить врача" : "Add doctor"}
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder={t("admin.searchDoctors", locale)} value={searchDoctors} onChange={(e) => setSearchDoctors(e.target.value)} className="pl-9" /></div>
          </div>
        </CardHeader>
        <CardContent>
          {doctorsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />))}</div>
          ) : doctors.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t("admin.noDoctors", locale)}</div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto pr-1 -mr-1">
              <div className="space-y-2">
                {doctors.map((doc) => {
                  const isCurrentUser = doc.id === currentDoctor.id;
                  const isAdminRole = doc.role === "admin";
                  const isActive = doc.isActive !== false;
                  return (
                    <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{doc.fullName}</span>
                          {isAdminRole && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">ADMIN</Badge>}
                          {!isActive && <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-400">{locale === "ru" ? "Неактивен" : "Inactive"}</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{doc.doctorCode} · {doc.specialization}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isCurrentUser && (
                          <>
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => updateDoctorMut.mutate({ id: doc.id, data: { isActive: !isActive } })}>
                              {isActive ? <><UserX className="h-3.5 w-3.5" />{t("admin.deactivate", locale)}</> : <><UserCheck className="h-3.5 w-3.5" />{t("admin.activate", locale)}</>}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>{locale === "ru" ? `Удалить врача ${doc.fullName}?` : `Delete doctor ${doc.fullName}?`}</AlertDialogTitle><AlertDialogDescription>{t("admin.deleteDoctorConfirm", locale)}</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>{t("common.cancel", locale)}</AlertDialogCancel><AlertDialogAction onClick={() => deleteDoctorMut.mutate(doc.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("common.delete", locale)}</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Doctor Dialog — v2.1.3 */}
      <Dialog open={addDoctorOpen} onOpenChange={setAddDoctorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              {locale === "ru" ? "Добавить врача" : "Add doctor"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {createdDoctor && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                <div className="font-medium text-emerald-700 dark:text-emerald-400">
                  {locale === "ru" ? "Врач добавлен. Сохраните учётные данные:" : "Doctor added. Save the credentials:"}
                </div>
                <div className="mt-1 font-mono">
                  {locale === "ru" ? "Код" : "Code"}: <span className="font-semibold">{createdDoctor.code}</span>
                </div>
                <div className="font-mono">
                  {locale === "ru" ? "Пароль" : "Password"}: <span className="font-semibold">{createdDoctor.password}</span>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ad-fullname">{locale === "ru" ? "ФИО" : "Full name"}</Label>
              <Input id="ad-fullname" placeholder={locale === "ru" ? "Иванов Иван Иванович" : "Dr. John Smith"} value={newDocFullName} onChange={(e) => setNewDocFullName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ad-spec">{locale === "ru" ? "Специализация" : "Specialization"}</Label>
                <Input id="ad-spec" placeholder={locale === "ru" ? "Онколог-генетик" : "Oncologist"} value={newDocSpec} onChange={(e) => setNewDocSpec(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-code">{locale === "ru" ? "Код врача" : "Doctor code"}</Label>
                <Input id="ad-code" placeholder="VR-003" value={newDocCode} onChange={(e) => setNewDocCode(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-password">{locale === "ru" ? "Пароль (мин. 4 символа)" : "Password (min 4 chars)"}</Label>
              <Input id="ad-password" type="text" placeholder={locale === "ru" ? `По умолчанию: ${newDocCode.trim() ? newDocCode.trim() + "-init" : "VR-003-init"}` : `Default: ${newDocCode.trim() ? newDocCode.trim() + "-init" : "VR-003-init"}`} value={newDocPassword} onChange={(e) => setNewDocPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                {locale === "ru" ? "Если оставить пустым — будет сгенерирован пароль по умолчанию." : "Leave empty to use the default password."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("common.cancel", locale)}</Button></DialogClose>
            <Button
              className="gap-2"
              onClick={() => addDoctorMut.mutate()}
              disabled={addDoctorMut.isPending || !newDocFullName.trim() || !newDocSpec.trim() || !newDocCode.trim()}
            >
              {addDoctorMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" />{locale === "ru" ? "Регистрация…" : "Registering…"}</>
              ) : (
                <><Plus className="h-4 w-4" />{locale === "ru" ? "Зарегистрировать" : "Register"}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cases Management */}
      <Card>
        <CardHeader>
          <div className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg flex items-center gap-2"><FolderOpen className="h-5 w-5" />{t("admin.patientCases", locale)}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{cases.length}</Badge>
              <Button size="sm" className="gap-1.5" onClick={openCreateCase}>
                <Plus className="h-3.5 w-3.5" />
                {locale === "ru" ? "Создать кейс" : "Create case"}
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder={t("admin.searchCases", locale)} value={searchCases} onChange={(e) => setSearchCases(e.target.value)} className="pl-9" /></div>
          </div>
        </CardHeader>
        <CardContent>
          {casesLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />))}</div>
          ) : cases.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t("admin.noCases", locale)}</div>
          ) : (
            <div className="max-h-[40vh] overflow-y-auto pr-1 -mr-1">
              <div className="space-y-2">
                {cases.map((c) => {
                  const icd10 = Array.isArray(c.icd10Codes) ? c.icd10Codes : [];
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="text-sm font-medium">{c.caseCode}</span><Badge variant="outline" className="text-xs">{c.status}</Badge></div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{c.diagnosisHint ?? (locale === "ru" ? "Без диагноза" : "No diagnosis")} · {c.doctor?.fullName}</div>
                        {icd10.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {icd10.slice(0, 4).map((code) => (
                              <Badge key={code.code} variant="secondary" className="font-mono text-[10px] gap-1">
                                <FileText className="h-2.5 w-2.5" />
                                {code.code}
                              </Badge>
                            ))}
                            {icd10.length > 4 && (
                              <Badge variant="outline" className="text-[10px]">+{icd10.length - 4}</Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>{locale === "ru" ? `Удалить кейс ${c.caseCode}?` : `Delete case ${c.caseCode}?`}</AlertDialogTitle><AlertDialogDescription>{t("admin.deleteDoctorConfirm", locale)}</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel", locale)}</AlertDialogCancel><AlertDialogAction onClick={() => deleteCaseMut.mutate(c.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("common.delete", locale)}</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Case Dialog (admin) — v2.3.2 (Task 4) */}
      <Dialog
        open={createCaseOpen}
        onOpenChange={(open) => {
          setCreateCaseOpen(open);
          if (!open) resetCreateCaseForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              {locale === "ru" ? "Новый кейс пациента" : "New patient case"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {locale === "ru"
                ? "Кейс будет назначен выбранному врачу."
                : "The case will be assigned to the selected doctor."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Privacy notice — amber banner */}
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                {locale === "ru"
                  ? "Не вводите ФИО и персональные данные пациента. Используйте псевдоним."
                  : "Do not enter patient name or personal data. Use an alias."}
              </div>
            </div>

            {/* Doctor (admin-only — default = current admin) */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {locale === "ru" ? "Лечащий врач" : "Attending doctor"}
              </Label>
              <Select value={newCaseDoctorId} onValueChange={setNewCaseDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder={locale === "ru" ? "Выберите врача" : "Select doctor"} />
                </SelectTrigger>
                <SelectContent>
                  <div className="max-h-72 overflow-y-auto">
                    {(doctorsData?.doctors ?? [])
                      .filter((d) => d.isActive !== false)
                      .map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">{doc.fullName}</span>
                            <span className="text-xs text-muted-foreground">{doc.specialization}</span>
                          </div>
                        </SelectItem>
                      ))}
                  </div>
                </SelectContent>
              </Select>
            </div>

            {/* Birth year + Sex */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ac-birthYear">{locale === "ru" ? "Год рождения" : "Birth year"}</Label>
                <Input
                  id="ac-birthYear"
                  type="number"
                  placeholder="1980"
                  value={newCaseBirthYear}
                  onChange={(e) => setNewCaseBirthYear(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{locale === "ru" ? "Пол" : "Sex"}</Label>
                <Select value={newCaseSex} onValueChange={setNewCaseSex}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="М">{locale === "ru" ? "Мужской" : "Male"}</SelectItem>
                    <SelectItem value="Ж">{locale === "ru" ? "Женский" : "Female"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Preliminary diagnosis */}
            <div className="space-y-1.5">
              <Label htmlFor="ac-diag">{locale === "ru" ? "Предварительный диагноз" : "Preliminary diagnosis"}</Label>
              <Input
                id="ac-diag"
                placeholder={locale === "ru" ? "Сахарный диабет 2 типа" : "Type 2 diabetes mellitus"}
                value={newCaseDiagnosis}
                onChange={(e) => setNewCaseDiagnosis(e.target.value)}
              />
            </div>

            {/* ICD-10 multi-select (cmdk) */}
            <div className="space-y-1.5">
              <Label htmlFor="ac-icd10">{locale === "ru" ? "Код МКБ-10" : "ICD-10 code"}</Label>
              <Popover open={icd10PopoverOpen} onOpenChange={setIcd10PopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="ac-icd10"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    type="button"
                  >
                    <span className="truncate">
                      {icd10Query ||
                        (locale === "ru" ? "Поиск кода МКБ-10…" : "Search ICD-10 code…")}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={locale === "ru" ? "Введите код или описание…" : "Type code or description…"}
                      value={icd10Query}
                      onValueChange={setIcd10Query}
                    />
                    <CommandList className="max-h-72">
                      {icd10Fetching ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {locale === "ru" ? "Поиск…" : "Searching…"}
                        </div>
                      ) : (icd10Results?.codes ?? []).length === 0 ? (
                        <CommandEmpty>
                          {icd10Query.trim().length < 2
                            ? (locale === "ru" ? "Введите минимум 2 символа" : "Type at least 2 chars")
                            : (locale === "ru" ? "Ничего не найдено" : "No results")}
                        </CommandEmpty>
                      ) : null}
                      <CommandGroup>
                        {(icd10Results?.codes ?? []).map((c) => {
                          const selected = icd10Selected.some((s) => s.code === c.code);
                          return (
                            <CommandItem
                              key={c.id}
                              value={c.code}
                              onSelect={() => {
                                if (!selected) {
                                  setIcd10Selected((prev) => [...prev, { code: c.code, description: c.description }]);
                                }
                                setIcd10Query("");
                                setIcd10PopoverOpen(false);
                              }}
                              disabled={selected}
                            >
                              <Check className={cn("h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-xs font-medium">{c.code}</div>
                                <div className="truncate text-xs text-muted-foreground">{c.description}</div>
                              </div>
                              {selected && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {locale === "ru" ? "добавлен" : "added"}
                                </Badge>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {icd10Selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {icd10Selected.map((c) => (
                    <Badge key={c.code} variant="secondary" className="gap-1 font-mono">
                      {c.code}
                      <button
                        type="button"
                        onClick={() => setIcd10Selected((prev) => prev.filter((s) => s.code !== c.code))}
                        className="ml-1 rounded p-0.5 hover:bg-muted-foreground/20"
                        aria-label={locale === "ru" ? `Удалить ${c.code}` : `Remove ${c.code}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {locale === "ru"
                  ? "Опционально. Можно выбрать несколько кодов из справочника МКБ-10."
                  : "Optional. Multiple codes can be selected from the ICD-10 reference."}
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="ac-notes">{locale === "ru" ? "Заметки" : "Notes"}</Label>
              <Textarea
                id="ac-notes"
                placeholder={locale === "ru" ? "Дополнительная информация (без персональных данных)" : "Additional info (no personal data)"}
                value={newCaseNotes}
                onChange={(e) => setNewCaseNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">{t("common.cancel", locale)}</Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => createCaseMut.mutate()}
              disabled={createCaseMut.isPending || !newCaseDoctorId}
              className="gap-2"
            >
              {createCaseMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" />{locale === "ru" ? "Создание…" : "Creating…"}</>
              ) : (
                <><Plus className="h-4 w-4" />{locale === "ru" ? "Создать кейс" : "Create case"}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patients Management */}
      <Card>
        <CardHeader>
          <div className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg flex items-center gap-2"><UserRound className="h-5 w-5" />{locale === "ru" ? "Пациенты" : "Patients"}</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => setAddPatientOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                {locale === "ru" ? "Добавить пациента" : "Add patient"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {patientsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />))}</div>
          ) : patients.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{locale === "ru" ? "Нет пациентов" : "No patients"}</div>
          ) : (
            <div className="max-h-[40vh] overflow-y-auto pr-1 -mr-1">
              <div className="space-y-2">
                {patients.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {(p as { foreignEncrypted?: boolean }).foreignEncrypted
                            ? "🔒 Зашифровано (нет ключа)"
                            : [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ") || p.patientToken}
                        </span>
                        <Badge variant="outline" className="font-mono text-[10px]">{p.patientToken}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.age != null ? `${p.age} лет` : ""}{p.sex ? ` · ${p.sex === "М" ? "Муж" : "Жен"}` : ""}{p.primaryDoctor ? ` · ${locale === "ru" ? "Врач" : "Dr"}: ${p.primaryDoctor.fullName}` : ""}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>{locale === "ru" ? `Удалить пациента ${p.patientToken}?` : `Delete patient ${p.patientToken}?`}</AlertDialogTitle><AlertDialogDescription>{locale === "ru" ? "Все связанные данные (визиты, показатели, назначения) будут удалены." : "All related data will be deleted."}</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>{t("common.cancel", locale)}</AlertDialogCancel><AlertDialogAction onClick={() => deletePatientMut.mutate(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("common.delete", locale)}</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Patient Dialog */}
      <Dialog open={addPatientOpen} onOpenChange={(open) => { setAddPatientOpen(open); if (!open) resetPatientForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" />{locale === "ru" ? "Новый пациент" : "New patient"}</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Lock className="h-3 w-3" />
              {locale === "ru"
                ? "Идентификаторы шифруются ВАШИМ ключом до отправки. Расшифровать сможет только создатель записи."
                : "Identifiers are encrypted with YOUR key before submission. Only the record creator can decrypt."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{locale === "ru" ? "Фамилия" : "Last name"}</Label><Input placeholder="Иванов" value={newPatientLastName} onChange={(e) => setNewPatientLastName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{locale === "ru" ? "Имя" : "First name"}</Label><Input placeholder="Иван" value={newPatientFirstName} onChange={(e) => setNewPatientFirstName(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{locale === "ru" ? "Отчество" : "Middle name"}</Label><Input placeholder="Иванович" value={newPatientMiddleName} onChange={(e) => setNewPatientMiddleName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{locale === "ru" ? "Дата рождения" : "Birth date"}</Label><Input type="date" value={newPatientBirthDate} onChange={(e) => setNewPatientBirthDate(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{locale === "ru" ? "Пол" : "Sex"}</Label>
                <Select value={newPatientSex} onValueChange={setNewPatientSex}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="М">{locale === "ru" ? "Мужской" : "Male"}</SelectItem><SelectItem value="Ж">{locale === "ru" ? "Женский" : "Female"}</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{locale === "ru" ? "Группа крови" : "Blood type"}</Label><Input placeholder="O(I)+" value={newPatientBloodType} onChange={(e) => setNewPatientBloodType(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>{locale === "ru" ? "СНИЛС" : "SNILS"}</Label><Input placeholder="000-000-000 00" value={newPatientSnils} onChange={(e) => setNewPatientSnils(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>{locale === "ru" ? "Полис ОМС" : "Insurance"}</Label><Input placeholder="Номер полиса ОМС" value={newPatientOmi} onChange={(e) => setNewPatientOmi(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("common.cancel", locale)}</Button></DialogClose>
            <Button className="gap-2" onClick={() => addPatientMut.mutate()} disabled={addPatientMut.isPending || !newPatientLastName.trim()}>
              {addPatientMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{locale === "ru" ? "Создание…" : "Creating…"}</> : <><Plus className="h-4 w-4" />{locale === "ru" ? "Создать" : "Create"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* System Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Bug className="h-5 w-5" />{t("admin.systemLogs", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input placeholder={t("admin.searchLogs", locale)} value={logFilter.search ?? ""} onChange={(e) => setLogFilter((f) => ({ ...f, search: e.target.value }))} className="flex-1" />
            <Select value={logFilter.level ?? "all"} onValueChange={(v) => setLogFilter((f) => ({ ...f, level: v === "all" ? undefined : v }))}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder={locale === "ru" ? "Уровень" : "Level"} /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("admin.allLevels", locale)}</SelectItem><SelectItem value="error">{t("admin.error", locale)}</SelectItem><SelectItem value="warn">{t("admin.warning", locale)}</SelectItem><SelectItem value="info">{t("admin.info", locale)}</SelectItem></SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => deleteLogsMut.mutate()} disabled={deleteLogsMut.isPending}><Trash2 className="h-3.5 w-3.5" />{t("admin.clearLogs", locale)}</Button>
          </div>
          {logsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />))}</div>
          ) : (logsData?.logs ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t("admin.noLogs", locale)}</div>
          ) : (
            <div className="max-h-[40vh] overflow-y-auto pr-1 -mr-1">
              <div className="space-y-1">
                {(logsData?.logs ?? []).slice(0, 50).map((log) => (
                  <div key={log.id} className="flex items-start gap-2 rounded-lg border p-2 text-xs">
                    <Badge variant="outline" className={cn("shrink-0", log.level === "error" ? "bg-red-500/15 text-red-700 dark:text-red-400" : log.level === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>{log.level}</Badge>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{log.message}</span>
                      {log.details && <span className="ml-1 text-muted-foreground">— {log.details.slice(0, 100)}</span>}
                    </div>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(log.createdAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Log — Immutable (WORM) Compliance Notice */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            {locale === "ru" ? "Журнал аудита — неизменяемый" : "Audit Log — Immutable"}
          </CardTitle>
          <CardDescription className="text-sm mt-1">
            {locale === "ru"
              ? "В соответствии с ФЗ-152 ст. 18 ч. 3 журнал аудита является неизменяемым (WORM). Удаление записей запрещено."
              : "Per ФЗ-152 art. 18(3), the audit log is immutable (WORM). Deletion of records is prohibited."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <BadgeCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium text-emerald-700 dark:text-emerald-300">
                {locale === "ru" ? "Защита от удаления активна" : "Tamper protection active"}
              </div>
              <div className="text-xs text-muted-foreground">
                {locale === "ru"
                  ? "Все действия (вход, создание/изменение кейсов, AI-анализ, подпись отчётов) записываются в журнал аудита и не могут быть удалены через UI или API. Для архивации устаревших записей используйте выгрузку через «Экспорт журнала» и обратитесь к администратору БД."
                  : "All actions (login, case CRUD, AI analysis, report signing) are recorded in the audit log and cannot be deleted through the UI or API. To archive stale records, use the Audit Export and contact the DBA."}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── v2.6: Центр безопасности (Enterprise) ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" />Центр безопасности</CardTitle>
          <CardDescription className="text-sm mt-1">
            Многоуровневая защита PHI: E2EE на этапе ввода · шифрование файлов при записи · аудит с хеш-цепочкой
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Уровни защиты */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SecurityLayerCard
              icon={<Lock className="h-4 w-4" />}
              title="Уровень 1 — E2EE (этап ввода)"
              active={e2eeStatus === "unlocked"}
              details={[
                "Каскад AES-256-GCM-SIV + ChaCha20-Poly1305",
                "Argon2id 64 MiB / 3 итер. — вывод ключа из пароля",
                "Zero-knowledge: сервер видит только шифротекст",
                "ФИО, СНИЛС, ОМС, ДМС, контакты, дата рождения",
              ]}
            />
            <SecurityLayerCard
              icon={<HardDrive className="h-4 w-4" />}
              title="Уровень 2 — Шифрование при записи"
              active={!!encryptionStatus?.isFullyEncrypted}
              details={[
                "AES-256-GCM + scrypt, файлы не бывают открытыми на диске",
                "Отчёты PDF и загрузки — сразу зашифрованы",
                "Смена ключа: scripts/rotate-encryption-key.ts",
              ]}
            />
            <SecurityLayerCard
              icon={<ScrollText className="h-4 w-4" />}
              title="Уровень 3 — Аудит и контроль"
              active={auditVerify?.ok ?? true}
              details={[
                "WORM-журнал с SHA-256 хеш-цепочкой",
                "IDOR закрыт: доступ только лечащему врачу",
                "Мгновенный отзыв сессий (tokenVersion)",
                "Брутфорс-защита: 5 попыток → блок 15 мин",
              ]}
            />
          </div>

          {/* v2.6.2: Инвентарь шифрования записей */}
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Database className="h-4 w-4 text-emerald-600" />
                Инвентарь шифрования записей (E2EE Coverage)
              </div>
              <Badge
                variant={e2eeCoverage.pct === 100 ? "default" : e2eeCoverage.pct >= 80 ? "secondary" : "destructive"}
                className={cn("text-[10px]", e2eeCoverage.pct === 100 && "bg-emerald-600")}
              >
                {e2eeCoverage.pct}%
              </Badge>
            </div>
            <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  e2eeCoverage.pct === 100
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                    : "bg-gradient-to-r from-amber-500 to-orange-500",
                )}
                style={{ width: `${e2eeCoverage.pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Зашифровано (enc:v1:): <span className="font-semibold text-foreground">{e2eeCoverage.encrypted}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", e2eeCoverage.legacy > 0 ? "bg-amber-500" : "bg-muted-foreground/40")} />
                Легаси (миграция при входе врача): <span className="font-semibold text-foreground">{e2eeCoverage.legacy}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                Всего карт: <span className="font-semibold text-foreground">{e2eeCoverage.total}</span>
              </span>
            </div>
            {e2eeCoverage.legacy > 0 && (
              <p className="mt-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                Незашифрованные записи пере-шифруются автоматически при следующем входе
                их лечащего врача (легаси-миграция в браузере). Администратор может
                ускорить процесс, попросив врачей перелогиниться.
              </p>
            )}
          </div>

          {/* Статус E2EE сессии + самотест */}
          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                e2eeStatus === "unlocked" ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600",
              )}>
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {e2eeStatus === "unlocked"
                    ? "Личное хранилище ключей разблокировано"
                    : e2eeStatus === "locked"
                      ? "Личное хранилище ключей заблокировано"
                      : "Ключ E2EE не создан"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {e2eeStatus === "unlocked"
                    ? "Данные пациентов шифруются и расшифровываются в вашей сессии"
                    : "Разблокируйте хранилище для доступа к расшифрованным данным"}
                </div>
              </div>
            </div>
            <CryptoSelfTestButton />
          </div>

          {/* Верификация цепочки аудита */}
          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                auditVerifyLoading ? "bg-muted text-muted-foreground" : auditVerify?.ok ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600",
              )}>
                {auditVerifyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" />}
              </div>
              <div>
                <div className="text-sm font-medium">
                  {auditVerifyLoading
                    ? "Проверка хеш-цепочки аудита…"
                    : auditVerify?.ok
                      ? `Целостность журнала аудита подтверждена (${auditVerify.verified} записей)`
                      : "НАРУШЕНИЕ ЦЕЛОСТНОСТИ ЖУРНАЛА АУДИТА"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {auditVerify?.brokenAt
                    ? `Первая повреждённая запись: ${auditVerify.brokenAt.id}`
                    : "Каждая запись хешируется SHA-256 вместе с предыдущей — подмена детектируется"}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => refetchAuditVerify()}
              disabled={auditVerifyLoading}
            >
              {auditVerifyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Проверить цепочку
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* File Encryption */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5" />{t("admin.fileEncryption", locale)}</CardTitle>
          <CardDescription className="text-sm mt-1">{t("admin.fileEncryptionHint", locale)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <Lock className="h-4 w-4 text-emerald-600" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("encryption.algorithm", locale)}</div>
                  <div className="text-sm font-medium">AES-256-GCM</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("encryption.fileCount", locale)}</div>
                  <div className="text-sm font-medium">{encryptionStatus?.totalFiles ?? 0} ({encryptionStatus?.encryptedFiles ?? 0} {t("admin.encrypted", locale).toLowerCase()})</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <Badge variant={encryptionStatus?.isFullyEncrypted ? "default" : "secondary"} className="text-xs">
                  {encryptionStatus?.isFullyEncrypted ? t("admin.encrypted", locale) : t("admin.notEncrypted", locale)}
                </Badge>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={encryptMut.isPending}>
                  {encryptMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {t("admin.encryptAll", locale)}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{locale === "ru" ? "Зашифровать все файлы?" : "Encrypt all files?"}</AlertDialogTitle>
                  <AlertDialogDescription>{locale === "ru" ? "Все загруженные файлы будут зашифрованы по стандарту AES-256-GCM. Оригинальные файлы будут удалены." : "All uploaded files will be encrypted using AES-256-GCM standard. Original files will be removed."}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel", locale)}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => encryptMut.mutate()}>
                    <Lock className="mr-2 h-4 w-4" />
                    {t("admin.encryptAll", locale)}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Backup/Restore */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><HardDrive className="h-5 w-5" />{t("admin.backup", locale)}</CardTitle>
          <CardDescription className="text-sm mt-1">{t("admin.backupHint", locale)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="gap-2" onClick={() => backupMut.mutate()} disabled={backupMut.isPending}>
              {backupMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t("admin.createBackup", locale)}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json";
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  const result = await api.restoreBackup(parsed);
                  toast.success(locale === "ru" ? `Данные восстановлены: ${result.message}` : `Data restored: ${result.message}`);
                  qc.invalidateQueries({ queryKey: ["cases"] });
                  qc.invalidateQueries({ queryKey: ["doctors"] });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : (locale === "ru" ? "Ошибка восстановления" : "Restore error"));
                }
              };
              input.click();
            }}>
              <Upload className="h-4 w-4" />
              {t("admin.restoreBackup", locale)}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


// ----------------------------------------------------------------------------
// v2.6: Карточка уровня защиты для Центра безопасности
// ----------------------------------------------------------------------------

function SecurityLayerCard({ icon, title, active, details }: {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  details: string[];
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3 transition-colors",
      active ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5",
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md",
          active ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600",
        )}>
          {icon}
        </span>
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant={active ? "default" : "secondary"} className={cn("ml-auto text-[9px]", active && "bg-emerald-600")}>
          {active ? "АКТИВЕН" : "ВНИМАНИЕ"}
        </Badge>
      </div>
      <ul className="mt-2 space-y-1">
        {details.map((d) => (
          <li key={d} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
            {d}
          </li>
        ))}
      </ul>
    </div>
  );
}
