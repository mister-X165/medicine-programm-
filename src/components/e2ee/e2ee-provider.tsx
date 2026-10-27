"use client";

// ============================================================================
// СППВР v2.6 — E2EE Provider: оркестрация ключей в UI
// ============================================================================
// - при восстановлении сессии: locked → UnlockDialog
// - при недоступном ключе (легаси/сброс): EnrollHint
// - авто-блокировка по неактивности (15 мин)
// - событие session-expired → блокировка хранилища
// ============================================================================

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { useE2EESession, startAutoLock } from "@/lib/e2ee/session";
import { unlockWithPassword, ensureKeyOnSessionRestore, migrateLegacyPatients, hydratePdeksAndMigrate } from "@/lib/e2ee/bootstrap";
import { runSelfTest } from "@/lib/crypto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Lock, LockOpen, ShieldCheck, Loader2, AlertTriangle, KeyRound } from "lucide-react";
import { toast } from "sonner";

export function E2EEProvider({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const status = useE2EESession((s) => s.status);

  // Авто-блокировка + событие истечения сессии
  React.useEffect(() => {
    const stopAutoLock = startAutoLock();
    const onExpired = () => {
      useE2EESession.getState().lock();
      useE2EESession.getState().setStatus("unavailable");
    };
    window.addEventListener("sppvr:session-expired", onExpired);
    return () => {
      stopAutoLock();
      window.removeEventListener("sppvr:session-expired", onExpired);
    };
  }, []);

  // Проверка ключа после входа/восстановления сессии
  React.useEffect(() => {
    if (isLoggedIn && status === "checking") {
      void ensureKeyOnSessionRestore();
    }
    if (!isLoggedIn && status !== "checking") {
      useE2EESession.getState().lock();
      useE2EESession.getState().setStatus("checking");
    }
  }, [isLoggedIn, status]);

  return (
    <>
      {children}
      {isLoggedIn && status === "locked" && <UnlockDialog />}
    </>
  );
}

// ----------------------------------------------------------------------------
// UnlockDialog — ввод пароля для разворачивания DEK (Argon2id + каскад)
// ----------------------------------------------------------------------------

function UnlockDialog() {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const doctorName = useAppStore((s) => s.currentDoctor?.fullName);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("Введите пароль");
      return;
    }
    setBusy(true);
    setProgress(15);
    const timer = setTimeout(() => setProgress(60), 200);
    try {
      const res = await unlockWithPassword(password);
      if (res.ok) {
        toast.success("Хранилище шифрования разблокировано", {
          description: "Ключ выведен из пароля через Argon2id (64 MiB, 3 итерации)",
        });
        setPassword("");
        // Ретрай легаси-миграции (если при входе что-то не зашифровалось)
        void migrateLegacyPatients().then((n) => {
          if (n > 0) {
            toast.info(`Легаси-данные зашифрованы: ${n} записей`);
          }
        });
        // v2.7: пер-пациентные ключи + переданные карты (после блокировки)
        void hydratePdeksAndMigrate().then((r) => {
          if (r.pdekMigrated > 0 || r.grantsUnlocked > 0) {
            toast.info("Пер-пациентные ключи готовы", {
              description: `Мигрировано карт: ${r.pdekMigrated} · переданных доступно: ${r.grantsUnlocked}`,
            });
          }
        });
      } else {
        setError(res.error || "Ошибка разблокировки");
      }
    } finally {
      clearTimeout(timer);
      setProgress(0);
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-medical-gradient text-white shadow-lg">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Хранилище зашифровано</DialogTitle>
              <DialogDescription>
                {doctorName ? `${doctorName}, в` : "В"}ведите пароль для расшифровки данных
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-unlock-password" className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              Пароль врача
            </Label>
            <Input
              id="e2ee-unlock-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={busy}
            />
          </div>

          {busy && (
            <div className="space-y-1.5">
              <Progress value={progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Argon2id: вывод ключа из пароля…
              </p>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Ошибка</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full gap-2" disabled={busy || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
            {busy ? "Вывод ключа…" : "Разблокировать данные"}
          </Button>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-1.5">
            <p className="flex items-center gap-1.5 font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Каскадное шифрование AES-256-GCM-SIV + ChaCha20-Poly1305
            </p>
            <p>
              Ключ выводится из вашего пароля в этом браузере (Argon2id). Сервер не имеет доступа
              к ключу — при утере пароля данные восстановить невозможно.
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// CryptoSelfTestButton — самотест криптомодуля (из CryptoVault)
// ----------------------------------------------------------------------------

export function CryptoSelfTestButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const [running, setRunning] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<null | { passed: boolean; durationMs: number }>(null);

  const run = async () => {
    setRunning(true);
    try {
      const result = await runSelfTest();
      setLastResult(result);
      if (result.passed) {
        toast.success("Самотест криптомодуля пройден", {
          description: `Каскад, отслеживание nonce, детекция подмены — ${result.durationMs} мс`,
        });
      } else {
        toast.error("Самотест криптомодуля ПРОВАЛЕН", {
          description: "Не использовать систему для ввода данных!",
        });
      }
    } catch {
      toast.error("Ошибка выполнения самотеста");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button variant={variant} size="sm" onClick={run} disabled={running} className="gap-2">
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
      Самотест криптомодуля
      {lastResult && (
        <span className={lastResult.passed ? "text-emerald-600" : "text-destructive"}>
          {lastResult.passed ? "✓" : "✗"} {lastResult.durationMs} мс
        </span>
      )}
    </Button>
  );
}
