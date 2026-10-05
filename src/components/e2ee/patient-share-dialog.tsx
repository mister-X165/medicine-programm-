"use client";

// ============================================================================
// СППВР v2.7 — Передача доступа к карте пациента (диалог, браузер владельца)
// ============================================================================
// Флоу (весь крипто — ТОЛЬКО в браузере, zero-knowledge):
//   1. Владелец открывает диалог → список активных grant'ов (GET grants)
//   2. Выбирает врача-получателя (нужен его публичный X25519 из /api/doctors)
//   3. PDEK карты разворачивается master-DEK'ом владельца (если ещё нет)
//   4. PDEK пере-заворачивается под получателя:
//        KEK = HKDF-SHA256( X25519(myWrapPriv, ихWrapPub) )
//   5. POST /grants { wrappedPdek: enc:v1:…, grantorWrapPub }
//   6. Получатель заходит → видит карту расшифрованной. Master-DEK владельца
//      и PDEK в открытом виде никогда не покидают браузер владельца.
// ============================================================================

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useE2EESession } from "@/lib/e2ee/session";
import {
  generatePdek,
  wrapPdekForOwner,
  wrapPdekForGrantee,
  unwrapOwnerPdek,
} from "@/lib/e2ee/pdek";
import { PATIENT_E2EE_FIELDS } from "@/lib/e2ee/transform";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Share2,
  ShieldCheck,
  KeyRound,
  Loader2,
  UserRound,
  Lock,
  Ban,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

interface ShareablePatient {
  id: string;
  patientToken: string;
  lastName?: string | null;
  firstName?: string | null;
  accessRole?: "owner" | "granted" | "observer";
  wrappedPdek?: string | null;
  [key: string]: unknown;
}

interface GrantRow {
  granteeDoctorId: string;
  granteeName: string;
  granteeCode: string;
  granteeSpecialization?: string;
  grantedBy: string;
  grantedByName?: string;
  grantedAt: string;
  status: string;
}

export function PatientShareDialog({
  patient,
  open,
  onOpenChange,
}: {
  patient: ShareablePatient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const currentDoctor = useAppStore((s) => s.currentDoctor);
  const e2eeStatus = useE2EESession((s) => s.status);
  const [selectedDoctorId, setSelectedDoctorId] = React.useState("");
  const [migrationBusy, setMigrationBusy] = React.useState(false);

  const isOwner = patient.accessRole === "owner";

  // Список врачей с публичными X25519-ключами
  const { data: doctorsData, isLoading: doctorsLoading } = useQuery({
    queryKey: ["doctors-for-share"],
    queryFn: () => api.getDoctors(),
    enabled: open,
  });

  // Активные grant'ы этой карты
  const { data: grantsData, isLoading: grantsLoading, refetch: refetchGrants } = useQuery({
    queryKey: ["patient-grants", patient.id],
    queryFn: () => api.getPatientGrants(patient.id),
    enabled: open,
  });

  const existingGrants = grantsData?.grants ?? [];

  // Кандидаты: активные, не владелец карты, не текущий врач, с X25519-ключом
  const candidates = React.useMemo(() => {
    const doctors = (doctorsData?.doctors ?? []).filter(
      (d: { id: string; isActive?: boolean; wrapPubKey?: string | null; role?: string }) =>
        !!d.isActive &&
        d.id !== currentDoctor?.id &&
        d.role !== "admin" &&
        !!d.wrapPubKey &&
        !existingGrants.some((g) => g.granteeDoctorId === d.id),
    );
    return doctors as Array<{
      id: string;
      fullName: string;
      specialization: string;
      doctorCode: string;
      wrapPubKey: string;
    }>;
  }, [doctorsData, currentDoctor?.id, existingGrants]);

  const noKeyDoctors = React.useMemo(() => {
    return (doctorsData?.doctors ?? []).filter(
      (d: { id: string; isActive?: boolean; wrapPubKey?: string | null; role?: string }) =>
        !!d.isActive && d.id !== currentDoctor?.id && d.role !== "admin" && !d.wrapPubKey,
    );
  }, [doctorsData, currentDoctor?.id]);

  // --------------------------------------------------------------------------
  // Подготовка PDEK: если нет в реестре — разворачиваем/мигрируем
  // --------------------------------------------------------------------------
  const ensurePdek = React.useCallback(async (): Promise<Uint8Array | null> => {
    const session = useE2EESession.getState();
    if (session.status !== "unlocked" || !session.dek) return null;

    const known = session.getRawPdek(patient.id);
    if (known) return known;

    if (patient.wrappedPdek && patient.accessRole === "owner") {
      try {
        const pdek = unwrapOwnerPdek(patient.wrappedPdek, session.dek);
        session.registerPdek(patient.id, pdek);
        return pdek;
      } catch {
        return null;
      }
    }

    // Легаси-карта без PDEK: быстрая миграция (расшифровано → PDEK → PATCH)
    if (patient.accessRole === "owner" && !patient.wrappedPdek) {
      setMigrationBusy(true);
      try {
        const pdek = generatePdek();
        const wrappedPdek = wrapPdekForOwner(pdek, session.dek);
        session.registerPdek(patient.id, pdek);
        const patch: Record<string, unknown> = {};
        for (const field of PATIENT_E2EE_FIELDS) {
          const value = patient[field];
          if (typeof value === "string" && value.length > 0) {
            patch[field] = value;
          }
        }
        patch.wrappedPdek = wrappedPdek;
        await api.updatePatient(patient.id, patch);
        toast.info("Карта переведена на пер-пациентный ключ (PDEK)");
        return pdek;
      } catch {
        toast.error("Не удалось перевести карту на пер-пациентный ключ");
        return null;
      } finally {
        setMigrationBusy(false);
      }
    }

    return null;
  }, [patient]);

  // --------------------------------------------------------------------------
  // Мутации: выдача и отзыв
  // --------------------------------------------------------------------------
  const grantMut = useMutation({
    mutationFn: async (granteeDoctorId: string) => {
      const grantee = candidates.find((d) => d.id === granteeDoctorId);
      if (!grantee || !grantee.wrapPubKey) {
        throw new Error("Врач-получатель недоступен");
      }
      const session = useE2EESession.getState();
      if (session.status !== "unlocked") {
        throw new Error("Хранилище шифрования заблокировано");
      }
      if (!session.wrapPriv || !session.wrapPubB64) {
        throw new Error("X25519-ключ ещё не готов — обновите страницу");
      }
      const pdek = await ensurePdek();
      if (!pdek) {
        throw new Error("PDEK карты недоступен (карта чужая или миграция не завершена)");
      }
      const wrap = wrapPdekForGrantee(pdek, session.wrapPriv, session.wrapPubB64, grantee.wrapPubKey);
      return api.grantPatientAccess(patient.id, {
        granteeDoctorId: grantee.id,
        wrappedPdek: wrap.wrappedPdek,
        grantorWrapPub: wrap.grantorWrapPub,
      });
    },
    onSuccess: () => {
      toast.success("Доступ передан", {
        description: "Врач-получатель увидит карту расшифрованной после входа",
      });
      setSelectedDoctorId("");
      refetchGrants();
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patient", patient.id] });
    },
    onError: (e: Error) => toast.error("Ошибка передачи: " + e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (granteeDoctorId: string) =>
      api.revokePatientAccess(patient.id, granteeDoctorId),
    onSuccess: () => {
      toast.success("Доступ отозван", {
        description: "Отзыв действует немедленно — сервер больше не пускает врача к карте",
      });
      refetchGrants();
      qc.invalidateQueries({ queryKey: ["patients"] });
    },
    onError: (e: Error) => toast.error("Ошибка отзыва: " + e.message),
  });

  const pdekReady = useE2EESession((s) => !!s.getRawPdek(patient.id));

  // --------------------------------------------------------------------------
  // Рендер
  // --------------------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-lg">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Передача доступа к карте</DialogTitle>
              <DialogDescription>
                Карта <span className="font-medium font-mono text-xs">{patient.patientToken}</span>{" "}
                · PDEK передаётся через X25519 + HKDF, master-ключ не раскрывается
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Крипто-статус */}
          <Alert
            className={
              e2eeStatus === "unlocked"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-amber-500/30 bg-amber-500/5"
            }
          >
            <ShieldCheck className={e2eeStatus === "unlocked" ? "h-4 w-4 text-emerald-600" : "h-4 w-4 text-amber-600"} />
            <AlertTitle className={e2eeStatus === "unlocked" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
              {e2eeStatus === "unlocked"
                ? pdekReady || patient.wrappedPdek || isOwner
                  ? "Пер-пациентный ключ готов к передаче"
                  : "Карта будет автоматически переведена на PDEK при передаче"
                : "Хранилище заблокировано"}
            </AlertTitle>
            <AlertDescription>
              {e2eeStatus === "unlocked" ? (
                <>
                  Ключ карты шифруется под публичный X25519 получателя:
                  <span className="ml-1 font-mono text-[10px]">ECDH → HKDF-SHA256 → AES-256-GCM-SIV + ChaCha20-Poly1305</span>.
                  Сервер хранит только шифротекст.
                </>
              ) : (
                "Разблокируйте хранилище шифрования (пароль) и повторите передачу."
              )}
            </AlertDescription>
          </Alert>

          {/* Активные доступы */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                Текущие доступы
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {existingGrants.length}
                </Badge>
              </Label>
            </div>
            {grantsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
              </div>
            ) : existingGrants.length === 0 ? (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Доступ ещё никому не передан — карта доступна только вам
              </div>
            ) : (
              <ScrollArea className="max-h-36 rounded-lg border">
                <div className="divide-y">
                  {existingGrants.map((g) => (
                    <div key={g.granteeDoctorId} className="flex items-center gap-3 p-2.5 pr-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-gradient-to-br from-teal-500 to-emerald-600 text-[10px] font-semibold text-white">
                          {g.granteeName
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{g.granteeName}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {g.granteeCode} · {g.granteeSpecialization} · с{" "}
                          {new Date(g.grantedAt).toLocaleDateString("ru-RU")}
                        </p>
                      </div>
                      <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> активен
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeMut.mutate(g.granteeDoctorId)}
                        disabled={revokeMut.isPending}
                        className="h-7 gap-1 text-[11px] text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                      >
                        {revokeMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Ban className="h-3 w-3" />
                        )}
                        Отозвать
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <Separator />

          {/* Выдача нового доступа */}
          {isOwner ? (
            <div className="space-y-2.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                Передать доступ врачу
              </Label>
              {candidates.length === 0 && !doctorsLoading ? (
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground space-y-1.5">
                  {noKeyDoctors.length > 0 ? (
                    <>
                      <p className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        Все доступные врачи ещё без X25519-ключа
                      </p>
                      <p className="pl-5">
                        Врачу нужно войти в систему (v2.7) — ключ сгенерируется автоматически при
                        первом входе.
                      </p>
                    </>
                  ) : (
                    "Нет доступных врачей для передачи (создайте аккаунт в админ-панели)"
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={doctorsLoading ? "Загрузка врачей…" : "Выберите врача"} />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          <span className="flex items-center gap-2">
                            <Lock className="h-3 w-3 text-emerald-600" />
                            <span className="font-medium">{d.fullName}</span>
                            <span className="text-muted-foreground">{d.specialization}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => grantMut.mutate(selectedDoctorId)}
                    disabled={!selectedDoctorId || grantMut.isPending || e2eeStatus !== "unlocked" || migrationBusy}
                    className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                  >
                    {grantMut.isPending || migrationBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    Передать
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertTitle>Карта передана вам</AlertTitle>
              <AlertDescription>
                Передавать доступ дальше может только владелец карты (врач, создавший её).
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            ФЗ-152 ст. 18 ч. 3 · HIPAA §164.312(a)(2)(iv) · отрегистрировано в журнале аудита
            (patient.grant.create / revoke)
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
