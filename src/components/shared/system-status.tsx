"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Database,
  Sparkles,
  Cpu,
  Server,
  Clock,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "@/lib/api";
import type { SystemStatus } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function SystemStatusBadge() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery<SystemStatus>({
    queryKey: ["health"],
    queryFn: api.getHealth,
    refetchInterval: 30000,
  });

  const { data: doctorsData } = useQuery({
    queryKey: ["doctors"],
    queryFn: api.getDoctors,
  });

  const [initOpen, setInitOpen] = React.useState(false);

  // v2.1.3 fix: use the PUBLIC init endpoint (POST /api/auth/init) instead
  // of api.seed() (POST /api/seed, admin-only). The "Initialize" button is
  // shown in the system-status badge, which is rendered in the header BEFORE
  // login — so api.seed() 403s for unauthenticated users, making the button
  // useless on first run. api.initSystem() does the same work (creates admin
  // + default doctor + seeds the clinical KB) but is public and returns the
  // one-time admin password.
  const seedMut = useMutation({
    mutationFn: () => api.initSystem(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["health"] });
      qc.invalidateQueries({ queryKey: ["doctors"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      if (res.initialized && res.scenario !== "already_initialized") {
        toast.success(
          res.message || "Система инициализирована",
          {
            description: res.admin?.password
              ? `Код: ADMIN · Одноразовый пароль: ${res.admin.password}`
              : undefined,
            duration: 15000,
          },
        );
      } else {
        toast.info("Система уже инициализирована");
      }
      setInitOpen(false);
    },
    onError: (e: Error) => toast.error("Ошибка инициализации: " + e.message),
  });

  const config = React.useMemo(() => {
    if (isLoading || !data) {
      return {
        label: "Проверка…",
        icon: RefreshCw,
        className: "bg-muted text-muted-foreground",
        spin: true,
      };
    }
    const ok = data.ok;
    const aiOk = data.ai?.ok;
    if (ok && aiOk) {
      return {
        label: "Готов",
        icon: CheckCircle2,
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
        spin: isFetching,
      };
    }
    if (ok && !aiOk) {
      return {
        label: "Ограниченный режим",
        icon: AlertTriangle,
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
        spin: isFetching,
      };
    }
    return {
      label: "Неготов",
      icon: XCircle,
      className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
      spin: isFetching,
    };
  }, [data, isLoading, isFetching]);

  const doctorsCount = doctorsData?.total ?? doctorsData?.doctors?.length ?? 0;

  const needsInit = React.useMemo(() => {
    if (!data) return false;
    return doctorsCount === 0;
  }, [data, doctorsCount]);

  const Icon = config?.icon ?? RefreshCw;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5">
        {needsInit && (
          <Button
            size="sm"
            variant="outline"
            className="hidden h-8 gap-1.5 border-amber-500/40 bg-amber-500/10 px-2.5 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 sm:inline-flex"
            onClick={() => setInitOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Инициализировать
          </Button>
        )}
        {/* v2.3: Network status indicator. Shows a wifi-off icon when the
            network is down so the user immediately knows web RAG is
            unavailable. Clicking it forces a network probe. */}
        {data?.network && !data.network.online && (
          <NetworkOfflineBadge />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
              aria-label="Обновить статус системы"
            >
              <Icon className={`h-3.5 w-3.5 ${config?.spin ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{config?.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-1 text-xs">
              <div className="font-semibold">Статус системы СППВР</div>
              {data && (
                <>
                  <Row label="База данных" value={data.db ? "ok" : "error"} />
                  <Row label="ИИ-ядро" value={data.ai?.ok ? "ok" : "error"} />
                  <Row
                    label="Провайдер ИИ"
                    value="ok"
                    customText={
                      data.ai?.provider === "llama-server"
                        ? "llama-server (llama.cpp)"
                        : data.ai?.provider === "lm-studio"
                          ? "LM Studio"
                          : "Неактивен"
                    }
                  />
                  <Row label="Хранилище" value={data.storage ? "ok" : "error"} />
                  <Row label="RAG-индекс" value={data.rag ? "ok" : "error"} />
                  <Row label="DDI" value={data.ddi ? "ok" : "error"} />
                  <Row label="МКБ-10" value={data.icd10 ? "ok" : "error"} />
                  {data.network && (
                    <Row
                      label="Минздрав РФ (прямой разбор КР)"
                      value={data.network.online ? "ok" : "degraded"}
                      customText={
                        data.network.online
                          ? "Доступен"
                          : data.network.circuitOpen
                            ? "Недоступен (circuit open)"
                            : "Проверка…"
                      }
                    />
                  )}
                  <Row
                    label="Врачей в БД"
                    value={doctorsCount > 0 ? "ok" : "error"}
                    customText={`${doctorsCount} в системе`}
                  />
                  {data.ai?.latency !== undefined && (
                    <Row
                      label="Задержка ИИ"
                      value="ok"
                      customText={`${data.ai.latency} мс`}
                    />
                  )}
                  {needsInit && (
                    <div className="mt-2 border-t pt-1.5">
                      <Button
                        size="sm"
                        className="h-7 w-full gap-1.5 text-xs"
                        onClick={() => setInitOpen(true)}
                      >
                        <Sparkles className="h-3 w-3" />
                        Инициализировать систему
                      </Button>
                    </div>
                  )}
                  <div className="mt-1 text-muted-foreground">
                    Нажмите для обновления
                  </div>
                </>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      <InitSystemDialog
        open={initOpen}
        onOpenChange={setInitOpen}
        onSeed={() => seedMut.mutate()}
        loading={seedMut.isPending}
        health={data}
        doctorsCount={doctorsCount}
      />
    </TooltipProvider>
  );
}

function InitSystemDialog({
  open,
  onOpenChange,
  onSeed,
  loading,
  health,
  doctorsCount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSeed: () => void;
  loading: boolean;
  health: SystemStatus | null | undefined;
  doctorsCount: number;
}) {
  const qc = useQueryClient();
  const [fullName, setFullName] = React.useState("");
  const [specialization, setSpecialization] = React.useState("");
  const [doctorCode, setDoctorCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [created, setCreated] = React.useState<{ code: string; password: string } | null>(null);

  // v2.1.3 fix: this dialog opens from the system-status badge, which is
  // rendered in the header BEFORE login (and even after login as a regular
  // doctor). POST /api/doctors is admin-only, so calling api.createDoctor()
  // from here fails with 403 for everyone except logged-in admins — making
  // the "Add doctor manually" form unusable on first run.
  //
  // We now use the PUBLIC self-registration endpoint (api.register →
  // POST /api/auth?action=register). It creates a doctor with a password,
  // returns a JWT, and works without any existing auth. If the operator is
  // already logged in as admin, they can ignore the returned JWT and use
  // the admin-panel doctor management for role/isActive changes later.
  const createDoctorMut = useMutation({
    mutationFn: () =>
      api.register({
        fullName: fullName.trim(),
        specialization: specialization.trim(),
        doctorCode: doctorCode.trim(),
        password: password || `${doctorCode.trim()}-init`,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["doctors"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      const creds = {
        code: res.doctor.doctorCode,
        password: password || `${doctorCode.trim()}-init`,
      };
      setCreated(creds);
      toast.success(`Врач ${res.doctor.fullName} (${res.doctor.doctorCode}) добавлен`, {
        description: `Код: ${creds.code} · Пароль: ${creds.password}`,
        duration: 10000,
      });
      setFullName("");
      setSpecialization("");
      setDoctorCode("");
      setPassword("");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Инициализация системы
          </DialogTitle>
          <DialogDescription>
            Создайте врача и заполните базу клинических рекомендаций для
            полноценной работы СППВР. Все данные хранятся локально (ФЗ-152).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">Быстрый старт</h4>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Создаст администратора, тестового врача и загрузит 20 клинических рекомендаций, 98 кодов МКБ-10, 29 DDI-записей и 8 клинических путей для RAG.
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <StatusChip ok={doctorsCount > 0} label={`Врачей: ${doctorsCount}`} />
              <StatusChip ok={health?.rag ?? false} label={health?.rag ? "RAG: готов" : "RAG: пусто"} />
            </div>
            <Button className="w-full gap-2" onClick={onSeed} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Инициализация…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Инициализировать (admin + врач + KB)
                </>
              )}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              После инициализации на экране входа появится одноразовый пароль администратора. Сохраните его — он показывается только один раз.
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">Зарегистрировать врача</h4>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Публичная регистрация — доступна без авторизации. Создаёт профиль врача с паролем. Используйте, если нужно добавить коллегу без прав администратора.
            </p>

            {created && (
              <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                <div className="font-medium text-emerald-700 dark:text-emerald-400">Врач добавлен. Сохраните учётные данные:</div>
                <div className="mt-1 font-mono">
                  Код: <span className="font-semibold">{created.code}</span>
                </div>
                <div className="font-mono">
                  Пароль: <span className="font-semibold">{created.password}</span>
                </div>
                <div className="mt-1 text-muted-foreground">Врач сможет войти и сменить пароль в настройках профиля.</div>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-fullname">ФИО</Label>
                <Input
                  id="doc-fullname"
                  placeholder="Иванов Иван Иванович"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="doc-spec">Специализация</Label>
                  <Input
                    id="doc-spec"
                    placeholder="Онколог-генетик"
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-code">Код врача</Label>
                  <Input
                    id="doc-code"
                    placeholder="VR-002"
                    value={doctorCode}
                    onChange={(e) => setDoctorCode(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-password">Пароль (мин. 4 символа)</Label>
                <Input
                  id="doc-password"
                  type="text"
                  placeholder={`По умолчанию: ${doctorCode.trim() ? doctorCode.trim() + "-init" : "VR-002-init"}`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Если оставить пустым — будет сгенерирован пароль по умолчанию.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => createDoctorMut.mutate()}
                disabled={
                  createDoctorMut.isPending ||
                  !fullName.trim() ||
                  !specialization.trim() ||
                  !doctorCode.trim()
                }
              >
                {createDoctorMut.isPending ? "Регистрация…" : "Зарегистрировать врача"}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Закрыть</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }
    >
      {label}
    </Badge>
  );
}

function Row({
  label,
  value,
  customText,
}: {
  label: string;
  value: string;
  customText?: string;
}) {
  const map: Record<string, { color: string; text: string }> = {
    ok: { color: "text-emerald-600", text: "OK" },
    degraded: { color: "text-amber-600", text: "Деградация" },
    error: { color: "text-red-600", text: "Ошибка" },
    disabled: { color: "text-muted-foreground", text: "Отключено" },
  };
  const v = map[value] ?? { color: "text-muted-foreground", text: value };
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}:</span>
      <span className={v.color}>{customText ?? v.text}</span>
    </div>
  );
}

/**
 * v2.3: A small badge shown in the header when the network is offline.
 * Clicking it forces a network probe (POST /api/network/status) to check
 * if connectivity has returned.
 */
function NetworkOfflineBadge() {
  const qc = useQueryClient();
  const [probing, setProbing] = React.useState(false);

  const handleProbe = async () => {
    setProbing(true);
    try {
      const res = await fetch("/api/network/status", { method: "POST" });
      const data = await res.json();
      if (data.online) {
        toast.success("Интернет-соединение восстановлено. Поиск КР Минздрава РФ снова доступен.");
      } else {
        toast.warning("Интернет-соединение всё ещё недоступно.", {
          description: data.lastError || "Проверьте подключение к сети.",
        });
      }
      // Invalidate health so the badge re-renders
      qc.invalidateQueries({ queryKey: ["health"] });
    } catch {
      toast.error("Не удалось проверить статус сети.");
    } finally {
      setProbing(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleProbe}
          disabled={probing}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
          aria-label="Нет интернета — проверить соединение"
        >
          <WifiOff className={`h-3.5 w-3.5 ${probing ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">Нет сети</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <div className="font-semibold flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            Нет интернет-соединения
          </div>
          <div className="text-muted-foreground">
            Поиск КР Минздрава РФ (cr.minzdrav.gov.ru) временно недоступен — работает локальный кэш.
          </div>
          <div className="text-muted-foreground">
            Система продолжает работу с локальной базой знаний — все основные функции доступны.
          </div>
          <div className="mt-1.5 border-t pt-1.5">
            Нажмите, чтобы перепроверить соединение.
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
