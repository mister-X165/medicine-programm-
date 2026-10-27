"use client";

// ============================================================================
// СППВР v2.6.2 — Экспорт/импорт карты пациента в контейнер CryptoVault (.cvlt)
// ============================================================================
// Фича использует ПОРТИРОВАННЫЙ движок CryptoVault (src/lib/crypto):
//   • Экспорт: полная расшифрованная карта → JSON → каскадное шифрование
//     AES-256-GCM-SIV + ChaCha20-Poly1305 (Argon2id-ключ из пароля) →
//     скачивание файла <токен>.cvlt. Формат самодостаточный: BLAKE3-хеш,
//     метаданные, KDF-параметры в заголовке.
//   • Импорт: .cvlt → decryptFile (проверка обоих AEAD-тегов + BLAKE3) →
//     JSON → api.createPatient (повторное E2EE-шифрование DEK'ом врача).
// ============================================================================

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download, Upload, Loader2, Lock, ShieldCheck, FileLock2,
  AlertTriangle, CheckCircle2, KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  encryptFile, decryptFile, inspectContainer,
  ARGON2_PRESETS, MIN_PASSWORD_LENGTH,
  estimatePasswordEntropyBits,
  type Argon2PresetName, type EncryptProgress,
  DecryptionError, NonceReuseError,
} from "@/lib/crypto";
import { api } from "@/lib/api";
import { useE2EESession } from "@/lib/e2ee/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import {
  Alert, AlertDescription, AlertTitle,
} from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Общие элементы
// ----------------------------------------------------------------------------

function PasswordStrengthBar({ password }: { password: string }) {
  const bits = password ? estimatePasswordEntropyBits(password) : 0;
  const pct = Math.min(100, (bits / 130) * 100);
  const level = bits >= 100 ? "strong" : bits >= 70 ? "good" : bits >= 45 ? "fair" : "weak";
  const colors = {
    weak: "bg-rose-500",
    fair: "bg-amber-500",
    good: "bg-sky-500",
    strong: "bg-emerald-500",
  };
  const labels = { weak: "Слабый", fair: "Средний", good: "Хороший", strong: "Надёжный" };
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all duration-300", colors[level])} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Энтропия: ≈{Math.round(bits)} бит · {labels[level]}
        {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
          <span className="text-amber-600"> · минимум {MIN_PASSWORD_LENGTH} символов</span>
        )}
      </p>
    </div>
  );
}

function CryptoFooter() {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-1.5">
      <p className="flex items-center gap-1.5 font-medium text-primary">
        <ShieldCheck className="h-3.5 w-3.5" />
        Контейнер CryptoVault (.cvlt)
      </p>
      <p>
        Каскад AES-256-GCM-SIV + ChaCha20-Poly1305, ключ — Argon2id из пароля,
        целостность — BLAKE3-256. Чужой пароль = данные недоступны: подбор
        стойкостью Argon2id практически исключён.
      </p>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {["NIST SP 800-38D", "RFC 8439", "RFC 9106"].map((s) => (
          <span key={s} className="rounded border px-1.5 py-0.5 font-mono text-[9px]">{s}</span>
        ))}
      </div>
    </div>
  );
}

function describeCryptoError(e: unknown): string {
  if (e instanceof DecryptionError) return `Ошибка расшифровки: ${e.message}`;
  if (e instanceof NonceReuseError) return `КРИТИЧЕСКО: повторное использование nonce — контейнер мог быть подделан`;
  return e instanceof Error ? e.message : String(e);
}

// ----------------------------------------------------------------------------
// ЭКСПОРТ: карта пациента → .cvlt
// ----------------------------------------------------------------------------

export function PatientExportDialog({
  open, onOpenChange, patient,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Минимальный контракт — совместим с PatientDetail (данные берём из api.getPatient) */
  patient: { id: string; patientToken: string };
}) {
  const e2eeStatus = useE2EESession((s) => s.status);
  const canExport = e2eeStatus === "unlocked";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [preset, setPreset] = React.useState<Argon2PresetName>("balanced");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState<EncryptProgress | null>(null);

  const onProgress = React.useCallback((p: EncryptProgress) => setProgress(p), []);

  const reset = () => {
    setPassword(""); setConfirm(""); setError(""); setProgress(null); setBusy(false);
  };

  const submit = async () => {
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Пароль экспорта: минимум ${MIN_PASSWORD_LENGTH} символов (политика CryptoVault)`);
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    try {
      // Полная расшифрованная карта (в памяти браузера, уже расшифрована DEK)
      const record = await api.getPatient(patient.id);
      const payload = {
        app: "SPPVR",
        version: "2.6.2",
        exportedAt: new Date().toISOString(),
        patient: record.patient,
      };
      const json = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(json);
      const result = await encryptFile(
        bytes,
        { filename: `${patient.patientToken}.json`, mimeType: "application/json", size: bytes.length },
        { password, argon2Preset: preset },
        onProgress,
      );

      // Скачивание контейнера
      const blob = new Blob([result.container as unknown as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${patient.patientToken}.cvlt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Контейнер ${patient.patientToken}.cvlt создан`, {
        description: `Каскадное шифрование · ${result.chunkCount} чанков · BLAKE3 ${toHexShort(result.plaintextHash)}`,
        duration: 8000,
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(describeCryptoError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const phaseLabel = (p: EncryptProgress) => {
    switch (p.phase) {
      case "kdf": return "Argon2id: вывод ключа…";
      case "encrypt": return `Шифрование: чанк ${p.chunkIndex + 1}/${p.totalChunks}`;
      case "finalise": return "Финализация (BLAKE3, сборка контейнера)…";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-medical-gradient text-white shadow-lg">
              <FileLock2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Экспорт карты в контейнер</DialogTitle>
              <DialogDescription>
                {patient.patientToken} → файл .cvlt (шифрование до записи на диск)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!canExport ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Хранилище заблокировано</AlertTitle>
            <AlertDescription>
              Разблокируйте хранилище (введите пароль) — экспортируются только
              расшифрованные данные, открытый текст не выгружается.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                Пароль контейнера
              </Label>
              <Input
                type="password" value={password} disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`Минимум ${MIN_PASSWORD_LENGTH} символов`}
                autoComplete="new-password"
              />
              <PasswordStrengthBar password={password} />
            </div>

            <div className="space-y-1.5">
              <Label>Подтвердите пароль</Label>
              <Input
                type="password" value={confirm} disabled={busy}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Повторите пароль"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Профиль Argon2id</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Argon2PresetName)} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ARGON2_PRESETS) as Argon2PresetName[]).map((k) => (
                    <SelectItem key={k} value={k}>{ARGON2_PRESETS[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{ARGON2_PRESETS[preset].description}</p>
            </div>

            {busy && progress && (
              <div className="space-y-1.5">
                <Progress value={(progress.bytesProcessed / Math.max(1, progress.totalBytes)) * 100} className="h-1.5" />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {phaseLabel(progress)}
                </p>
              </div>
            )}

            <CryptoFooter />
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={busy}>Отмена</Button></DialogClose>
          <Button
            onClick={submit} disabled={busy || !canExport || !password || password !== confirm}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Шифрование…" : "Экспортировать .cvlt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// ИМПОРТ: .cvlt → новая карта пациента
// ----------------------------------------------------------------------------

export function PatientImportDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const e2eeStatus = useE2EESession((s) => s.status);
  const canImport = e2eeStatus === "unlocked";
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [preview, setPreview] = React.useState<null | { ok: boolean; text: string }>(null);
  const [progress, setProgress] = React.useState<EncryptProgress | null>(null);

  const reset = () => {
    setFile(null); setPassword(""); setError(""); setPreview(null); setProgress(null); setBusy(false);
  };

  const onFile = async (f: File) => {
    setFile(f);
    setPreview(null);
    setError("");
    try {
      const head = new Uint8Array(await f.slice(0, 4096).arrayBuffer());
      const info = inspectContainer(head);
      setPreview({
        ok: info.isCryptoVault,
        text: info.isCryptoVault
          ? `CryptoVault v${info.version} · ${info.cipher1} + ${info.cipher2} · ${info.kdfAlgorithm} (${(info.kdfParams.memoryKiB / 1024).toFixed(0)} MiB, ${info.kdfParams.iterations} итер.) · ${info.hashAlgorithm}`
          : "Файл не является контейнером CryptoVault (нет магии CVLT)",
      });
    } catch {
      setPreview({ ok: false, text: "Не удалось прочитать заголовок файла" });
    }
  };

  const submit = async () => {
    setError("");
    if (!file || !password) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await decryptFile(bytes, password, (p) => setProgress(p));
      if (!result.integrityOk) {
        setError("Проверка целостности BLAKE3 НЕ пройдена — контейнер повреждён или подменён. Импорт отклонён.");
        return;
      }
      const text = new TextDecoder().decode(result.plaintext);
      let payload: { app?: string; patient?: Record<string, unknown> };
      try {
        payload = JSON.parse(text);
      } catch {
        setError("Расшифровано, но содержимое не является картой СППВР (не JSON)");
        return;
      }
      if (payload.app !== "SPPVR" || !payload.patient || typeof payload.patient !== "object") {
        setError("Формат не распознан: ожидалась экспортированная карта пациента СППВР");
        return;
      }

      const p = payload.patient;
      // Создаём пациента: api-слой шифрует идентификаторы DEK'ом текущего врача.
      // Fallback: если исходный patientToken занят (уникальный ключ) —
      // повторяем без токена, сервер сгенерирует новый П-ГГГГ-NNNN.
      const { id: _id, createdAt: _c, updatedAt: _u, ...patientData } = p as Record<string, unknown>;
      let res;
      let tokenNote = "";
      try {
        res = await api.createPatient(patientData);
      } catch {
        const { patientToken: _t, ...withoutToken } = patientData;
        void _t;
        res = await api.createPatient(withoutToken);
        tokenNote = ` (токен изменён: исходный занят)`;
      }
      toast.success(`Импортирован пациент ${res.patient.patientToken}${tokenNote}`, {
        description: `Контейнер проверен: оба AEAD-тега + BLAKE3 · ${result.chunkCount} чанков · данные пере-шифрованы вашим ключом`,
        duration: 8000,
      });
      // Обновляем списки пациентов (реестр, админ-панель)
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patients-admin"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(describeCryptoError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-medical-gradient text-white shadow-lg">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Импорт карты из контейнера</DialogTitle>
              <DialogDescription>Файл .cvlt → новая карта пациента (пере-шифрование вашим DEK)</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!canImport ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Хранилище заблокировано</AlertTitle>
            <AlertDescription>
              Разблокируйте хранилище — импортированные данные будут немедленно
              зашифрованы вашим личным ключом.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Drop zone */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-all",
                preview?.ok
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-muted-foreground/25 hover:border-primary/40 hover:bg-primary/5",
              )}
            >
              <FileLock2 className={cn("h-8 w-8", preview?.ok ? "text-emerald-600" : "text-muted-foreground/50")} />
              {file ? (
                <>
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} КБ</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">Выберите файл .cvlt</span>
                  <span className="text-xs text-muted-foreground">Контейнер CryptoVault, экспортированный из СППВР</span>
                </>
              )}
              <input
                ref={inputRef} type="file" accept=".cvlt,application/octet-stream" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              />
            </button>

            {preview && (
              <div className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                preview.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
              )}>
                {preview.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span className="font-mono leading-relaxed">{preview.text}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                Пароль контейнера
              </Label>
              <Input
                type="password" value={password} disabled={busy || !file}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль, заданный при экспорте"
                autoComplete="off"
              />
            </div>

            {busy && progress && (
              <div className="space-y-1.5">
                <Progress value={(progress.bytesProcessed / Math.max(1, progress.totalBytes)) * 100} className="h-1.5" />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {progress.phase === "kdf" ? "Argon2id: вывод ключа…" : `Расшифровка: чанк ${progress.chunkIndex + 1}/${progress.totalChunks}`}
                </p>
              </div>
            )}

            <CryptoFooter />
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={busy}>Отмена</Button></DialogClose>
          <Button
            onClick={submit} disabled={busy || !canImport || !file || !password || preview?.ok === false}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Расшифровка…" : "Импортировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toHexShort(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < Math.min(6, bytes.length); i++) s += bytes[i].toString(16).padStart(2, "0");
  return s + "…";
}
