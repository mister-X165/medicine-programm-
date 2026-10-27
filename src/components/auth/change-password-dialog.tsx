"use client";

import * as React from "react";
import { Lock, Loader2, AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore, type DoctorProfile } from "@/lib/store";
import { checkKeyMaterial } from "@/lib/e2ee/bootstrap";
import { rewrapKeyMaterial } from "@/lib/e2ee/key-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert";
import { toast } from "sonner";

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currentDoctor = useAppStore((s) => s.currentDoctor);

  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [stage, setStage] = React.useState("");
  const [success, setSuccess] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 10 || !/[A-Za-zА-Яа-яЁё]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("Пароль должен содержать минимум 10 символов, включая букву и цифру");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }
    if (!currentDoctor) {
      setError("Не выбран врач");
      return;
    }

    setLoading(true);
    try {
      // v2.6 (E2EE): если у врача есть ключ шифрования — пере-заворачиваем
      // DEK под новый пароль В БРАУЗЕРЕ и отправляем вместе со сменой
      // пароля (сервер применяет оба атомарно). Без этого ключ стал бы
      // недоступен после смены пароля.
      let kmPayload: {
        wrappedDek: string;
        kdfSalt: string;
        kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
        checkBlob: string;
      } | undefined;

      if (currentDoctor.hasPassword && oldPassword) {
        setStage("Проверка ключа шифрования…");
        const { enrolled, material } = await checkKeyMaterial();
        if (enrolled && material) {
          setStage("Пере-заворачивание ключа (Argon2id)…");
          try {
            kmPayload = await rewrapKeyMaterial(material, oldPassword, newPassword);
          } catch (rewrapErr) {
            setError(
              rewrapErr instanceof Error
                ? `Не удалось пере-завернуть ключ шифрования: ${rewrapErr.message}. Смена пароля отменена — данные остаются доступными со старым паролем.`
                : "Ошибка пере-заворачивания ключа",
            );
            return;
          }
        }
      }

      setStage("Сохранение…");
      const result = await api.setPassword(
        currentDoctor.id,
        newPassword,
        currentDoctor.hasPassword ? oldPassword : undefined,
        kmPayload,
      );
      setSuccess(true);
      const updatedDoctor: DoctorProfile = {
        ...currentDoctor,
        hasPassword: true,
      };
      useAppStore.getState().switchDoctor(updatedDoctor);
      toast.success(result.message || "Пароль успешно изменён", {
        description: kmPayload
          ? "🔒 Ключ шифрования пере-завёрнут под новый пароль — данные доступны"
          : undefined,
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка смены пароля");
    } finally {
      setLoading(false);
      setStage("");
    }
  };

  const handleClose = () => {
    setError("");
    setSuccess(false);
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Изменить пароль
          </DialogTitle>
          <DialogDescription>
            {currentDoctor?.hasPassword
              ? `Смена пароля для ${currentDoctor.fullName} (${currentDoctor.doctorCode})`
              : `Установка пароля для ${currentDoctor?.fullName} (${currentDoctor?.doctorCode})`}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-sm font-medium">Пароль успешно изменён</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Ключ шифрования синхронизирован с новым паролем
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {currentDoctor?.hasPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="old-password">Текущий пароль</Label>
                <Input
                  id="old-password"
                  type="password"
                  placeholder="Введите текущий пароль"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="new-password">Новый пароль</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Минимум 10 символов, буква и цифра"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-new-password">Подтвердите новый пароль</Label>
              <Input
                id="confirm-new-password"
                type="password"
                placeholder="Повторите новый пароль"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                Связка пароля и ключа шифрования
              </span>
              При смене пароля ключ шифрования данных (DEK) автоматически
              пере-заворачивается под новый пароль в вашем браузере. Сервер
              применяет оба изменения атомарно — данные не потеряют доступность.
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Отмена</Button>
              </DialogClose>
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {stage || "Сохранение…"}
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Изменить пароль
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
