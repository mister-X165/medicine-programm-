"use client";

import * as React from "react";
import { Stethoscope, Lock, User, Loader2, AlertTriangle, KeyRound, Shield, Sparkles, Copy, Check } from "lucide-react";
import { useAppStore, type DoctorProfile } from "@/lib/store";
import { api } from "@/lib/api";
import { afterLogin } from "@/lib/e2ee/bootstrap";
import { useE2EESession } from "@/lib/e2ee/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const DEFAULT_ADMIN_CODE = "ADMIN";
// SECURITY (v2.1): No hardcoded admin password in client bundle.
// On first init, the backend generates a one-time password and returns it in
// the POST /api/auth/init response (admin.password). We display it ONCE in a
// toast + the green alert below, then it's gone — the user must save it.

export function LoginDialog() {
  const { showLoginDialog, setShowLoginDialog, isLoggedIn } = useAppStore();
  const open = !isLoggedIn || showLoginDialog;

  const [doctorCode, setDoctorCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState("");
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [e2eeStage, setE2eeStage] = React.useState("");

  const [initChecking, setInitChecking] = React.useState(true);
  const [initRunning, setInitRunning] = React.useState(false);
  const [justInitialized, setJustInitialized] = React.useState(false);
  const [initError, setInitError] = React.useState("");
  const [oneTimePassword, setOneTimePassword] = React.useState<string | null>(null);
  const [copiedField, setCopiedField] = React.useState<"code" | "password" | null>(null);

  const [registerMode, setRegisterMode] = React.useState(false);
  const [regFullName, setRegFullName] = React.useState("");
  const [regSpecialization, setRegSpecialization] = React.useState("");
  const [regDoctorCode, setRegDoctorCode] = React.useState("");
  const [regPassword, setRegPassword] = React.useState("");
  const [regConfirmPassword, setRegConfirmPassword] = React.useState("");
  const [regError, setRegError] = React.useState("");
  const [regLoading, setRegLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getInitStatus();
        if (cancelled) return;
        if (status.needsInit) {
          await runInit(true);
        }
      } catch (err) {
        if (!cancelled) {
          setInitError(
            err instanceof Error
              ? `Не удалось проверить состояние системы: ${err.message}`
              : "Не удалось проверить состояние системы"
          );
        }
      } finally {
        if (!cancelled) setInitChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const runInit = async (auto = false) => {
    setInitRunning(true);
    setInitError("");
    try {
      const result = await api.initSystem();
      if (result.initialized && result.scenario !== "already_initialized") {
        setJustInitialized(true);
        setDoctorCode(DEFAULT_ADMIN_CODE);
        if (result.admin?.password) {
          setOneTimePassword(result.admin.password);
        }
        toast.success(result.message || "Система инициализирована", {
          description: result.admin?.password
            ? `Код: ${DEFAULT_ADMIN_CODE} · Одноразовый пароль: ${result.admin.password}`
            : undefined,
          duration: 15000,
        });
      } else if (result.scenario === "already_initialized") {
        // Already initialized — don't show credentials, just inform the user.
        if (auto) {
          // Silent: this is the normal flow on every page load.
        } else {
          toast.info("Система уже инициализирована. Используйте существующие учётные данные.");
        }
      }
    } catch (err) {
      setInitError(
        err instanceof Error
          ? `Ошибка инициализации: ${err.message}`
          : "Ошибка инициализации системы"
      );
      if (!auto) {
        toast.error("Не удалось инициализировать систему");
      }
    } finally {
      setInitRunning(false);
    }
  };

  const copyToClipboard = async (text: string, field: "code" | "password") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success("Скопировано в буфер обмена");
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    if (!doctorCode.trim() || !password.trim()) {
      setLoginError("Введите код врача и пароль");
      return;
    }
    setLoginLoading(true);
    setE2eeStage("");
    try {
      const result = await api.login(doctorCode.trim(), password);
      // v2.6: сессия — HttpOnly-cookie (сервер устанавливает её в ответе).
      const doctor: DoctorProfile = {
        id: result.doctor.id,
        fullName: result.doctor.fullName,
        specialization: result.doctor.specialization,
        doctorCode: result.doctor.doctorCode,
        role: result.doctor.role || "doctor",
        isActive: result.doctor.isActive ?? true,
        hasPassword: true,
      };
      useAppStore.getState().loginDoctor(doctor);

      // E2EE v2.6: пароль сейчас в памяти — выводим ключ шифрования
      // (Argon2id → разворачивание DEK) и запускаем легаси-миграцию.
      setE2eeStage("Вывод ключа шифрования (Argon2id)…");
      try {
        const boot = await afterLogin(password);
        if (boot.ok) {
          const parts: string[] = [];
          if (boot.migrated && boot.migrated > 0) {
            parts.push(`легаси-записей зашифровано: ${boot.migrated}`);
          }
          if (boot.pdekMigrated && boot.pdekMigrated > 0) {
            parts.push(`карт переведено на пер-пациентные ключи: ${boot.pdekMigrated}`);
          }
          if (boot.grantsUnlocked && boot.grantsUnlocked > 0) {
            parts.push(`переданных карт доступно: ${boot.grantsUnlocked}`);
          }
          toast.success(`Вход выполнен: ${doctor.fullName}`, {
            description: `🔒 E2EE на этапе ввода активен${parts.length ? " · " + parts.join(" · ") : ""}`,
          });
        } else if (boot.scenario === "error") {
          toast.warning("Хранилище шифрования недоступно", {
            description: boot.error || "Данные будут вводиться без E2EE",
          });
          useE2EESession.getState().setStatus("unavailable");
        } else {
          // bad-password — редко (пароль только что подошёл); предлаг unlock
          toast.warning("Не удалось разблокировать хранилище шифрования", {
            description: "Введите пароль в диалоге разблокировки",
          });
        }
      } catch {
        useE2EESession.getState().setStatus("unavailable");
      }

      setDoctorCode("");
      setPassword("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка входа";
      if (msg.includes("не найден") || msg.includes("not found")) {
        setLoginError(
          `${msg} Если это первый запуск системы, инициализируйте её, чтобы создать администратора.`,
        );
      } else {
        setLoginError(msg);
      }
    } finally {
      setLoginLoading(false);
      setE2eeStage("");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError("");
    if (!regFullName.trim() || !regSpecialization.trim() || !regDoctorCode.trim()) {
      setRegError("Заполните все поля");
      return;
    }
    if (regPassword.length < 10 || !/[A-Za-zА-Яа-яЁё]/.test(regPassword) || !/\d/.test(regPassword)) {
      setRegError("Пароль должен содержать минимум 10 символов, включая букву и цифру");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setRegError("Пароли не совпадают");
      return;
    }
    setRegLoading(true);
    try {
      // v2.6: публичная саморегистрация может быть закрыта администратором
      // (enterprise-режим). Ошибка REGISTRATION_CLOSED показывается явно.
      const result = await api.register({
        fullName: regFullName.trim(),
        specialization: regSpecialization.trim(),
        doctorCode: regDoctorCode.trim(),
        password: regPassword,
      });
      const doctor: DoctorProfile = {
        id: result.doctor.id,
        fullName: result.doctor.fullName,
        specialization: result.doctor.specialization,
        doctorCode: result.doctor.doctorCode,
        role: result.doctor.role || "doctor",
        isActive: result.doctor.isActive ?? true,
        hasPassword: true,
      };
      useAppStore.getState().loginDoctor(doctor);

      // E2EE: при регистрации сразу создаём ключ и разблокируем
      try {
        await afterLogin(regPassword);
        toast.success("Регистрация завершена. Добро пожаловать!", {
          description: "🔒 Создан личный ключ шифрования (Argon2id)",
        });
      } catch {
        toast.success("Регистрация завершена. Добро пожаловать!");
      }
      setRegFullName("");
      setRegSpecialization("");
      setRegDoctorCode("");
      setRegPassword("");
      setRegConfirmPassword("");
      setRegisterMode(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка регистрации";
      setRegError(
        msg.includes("REGISTRATION_CLOSED") || msg.includes("отключена")
          ? "Саморегистрация отключена администратором. Учётные записи создаёт администратор системы."
          : msg,
      );
    } finally {
      setRegLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isLoggedIn && !newOpen) return;
    setShowLoginDialog(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={isLoggedIn}>
        {/* Medical gradient hero banner */}
        <div className="relative -mx-6 -mt-6 mb-4 overflow-hidden rounded-t-lg bg-medical-gradient-soft p-5">
          <div className="absolute -right-4 -top-4 opacity-10">
            <Stethoscope className="h-24 w-24 text-primary" />
          </div>
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-medical-gradient text-white shadow-lg shadow-emerald-500/20">
              <Stethoscope className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                {registerMode ? "Регистрация врача" : "Вход в СППВР"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {registerMode
                  ? "Зарегистрируйтесь в системе поддержки принятия врачебных решений"
                  : "Система поддержки принятия врачебных решений"}
              </DialogDescription>
            </div>
          </div>
        </div>

        {!registerMode ? (
          <form onSubmit={handleLogin} className="space-y-4">
            {(initChecking || initRunning || justInitialized || initError) && (
              <Alert
                variant={justInitialized ? "default" : initError ? "destructive" : "default"}
                className={
                  justInitialized
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : initError
                      ? ""
                      : "border-primary/30 bg-primary/5"
                }
              >
                {initChecking || initRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : justInitialized ? (
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {initChecking
                    ? "Проверка состояния системы…"
                    : initRunning
                      ? "Инициализация системы…"
                      : justInitialized
                        ? "Система инициализирована"
                        : "Требуется инициализация"}
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  {initChecking || initRunning
                    ? "Создаём профиль администратора и базовые данные. Подождите…"
                    : justInitialized
                      ? "Создан профиль администратора. Используйте учётные данные ниже для входа."
                      : initError ||
                        "База данных пуста. Нажмите кнопку ниже, чтобы инициализировать систему."}
                  {(initError || (!justInitialized && !initChecking && !initRunning)) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 gap-2"
                      disabled={initRunning}
                      onClick={() => runInit(false)}
                    >
                      {initRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {initRunning ? "Инициализация…" : "Инициализировать систему"}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {loginError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ошибка входа</AlertTitle>
                <AlertDescription className="space-y-2">
                  <span>{loginError}</span>
                  {loginError.includes("не найден") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1 gap-2"
                      disabled={initRunning}
                      onClick={() => runInit(false)}
                    >
                      {initRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Инициализировать систему
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="login-code" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                Код врача
              </Label>
              <Input
                id="login-code"
                placeholder="Например: ADMIN, VR-001, DR001"
                value={doctorCode}
                onChange={(e) => setDoctorCode(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                Пароль
              </Label>
              <Input
                id="login-password"
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={loginLoading || initRunning}>
              {loginLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {e2eeStage || "Вход…"}
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Войти в систему
                </>
              )}
            </Button>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-primary">
                <Shield className="h-4 w-4" />
                Администратор системы
              </div>
              {justInitialized && oneTimePassword ? (
                <div className="mt-2 space-y-1.5">
                  <div className="rounded-md bg-amber-500/15 p-2 text-xs text-amber-700 dark:text-amber-300">
                    ⚠ Это одноразовый пароль. Сохраните его сейчас — он больше не будет показан. После входа обязательно смените его.
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-background/60 p-1.5">
                    <span className="text-xs text-muted-foreground">Код:</span>
                    <span className="font-mono text-sm font-medium">{DEFAULT_ADMIN_CODE}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-6 w-6"
                      onClick={() => copyToClipboard(DEFAULT_ADMIN_CODE, "code")}
                      title="Скопировать код"
                    >
                      {copiedField === "code" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-background/60 p-1.5">
                    <span className="text-xs text-muted-foreground">Пароль:</span>
                    <span className="font-mono text-sm font-medium break-all">{oneTimePassword}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-6 w-6 shrink-0"
                      onClick={() => copyToClipboard(oneTimePassword, "password")}
                      title="Скопировать пароль"
                    >
                      {copiedField === "password" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    После входа пароль можно сменить в настройках профиля.
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">
                  Код: <span className="font-mono font-medium">ADMIN</span> · Пароль предоставляется отдельно при первой инициализации системы
                </div>
              )}
            </div>

            <Separator />

            <div className="text-center">
              <p className="mb-2 text-sm text-muted-foreground">Нет учётной записи?</p>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setRegisterMode(true);
                  setLoginError("");
                }}
              >
                <KeyRound className="h-4 w-4" />
                Зарегистрироваться
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            {regError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{regError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reg-fullname">ФИО врача</Label>
              <Input
                id="reg-fullname"
                placeholder="Иванов Иван Иванович"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-spec">Специализация</Label>
              <Input
                id="reg-spec"
                placeholder="Онколог, Генетик, Кардиолог…"
                value={regSpecialization}
                onChange={(e) => setRegSpecialization(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-code" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                Код врача
              </Label>
              <Input
                id="reg-code"
                placeholder="DR001"
                value={regDoctorCode}
                onChange={(e) => setRegDoctorCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-password" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                Пароль
              </Label>
              <Input
                id="reg-password"
                type="password"
                placeholder="Минимум 10 символов, буква и цифра"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-confirm">Подтвердите пароль</Label>
              <Input
                id="reg-confirm"
                type="password"
                placeholder="Повторите пароль"
                value={regConfirmPassword}
                onChange={(e) => setRegConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={regLoading}>
              {regLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Регистрация…
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  Зарегистрироваться и войти
                </>
              )}
            </Button>

            <Separator />

            <div className="text-center">
              <Button
                variant="ghost"
                className="gap-2"
                onClick={() => {
                  setRegisterMode(false);
                  setRegError("");
                }}
              >
                <Lock className="h-4 w-4" />
                Уже есть учётная запись? Войти
              </Button>
            </div>
          </form>
        )}

      </DialogContent>
    </Dialog>
  );
}
