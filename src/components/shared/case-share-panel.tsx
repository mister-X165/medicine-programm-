"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Share2,
  User,
  Eye,
  MessageSquare,
  XCircle,
  Loader2,
  Send,
  Clock,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { CaseShareRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export function CaseSharePanel({ caseId }: { caseId: string }) {
  const currentDoctor = useAppStore((s) => s.currentDoctor);
  const qc = useQueryClient();

  const { data: sharesData, isLoading: sharesLoading } = useQuery({
    queryKey: ["shares", caseId],
    queryFn: () => api.getShares(caseId),
  });

  const { data: doctorsData } = useQuery({
    queryKey: ["doctors"],
    queryFn: api.getDoctors,
  });

  const shares = sharesData?.shares ?? [];
  const doctors = doctorsData?.doctors ?? [];
  const activeShares = shares.filter((s) => s.status === "active");

  const [targetDoctorId, setTargetDoctorId] = React.useState("");
  const [accessLevel, setAccessLevel] = React.useState<"read" | "comment">("read");
  const [message, setMessage] = React.useState("");

  const shareMut = useMutation({
    mutationFn: () => api.shareCase(caseId, targetDoctorId, accessLevel, message || undefined),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["shares", caseId] });
      const targetDoctor = doctors.find((d) => d.id === targetDoctorId);
      toast.success(`Случай передан врачу ${targetDoctor?.fullName ?? res.share.toDoctor?.fullName ?? targetDoctorId}`);
      setTargetDoctorId("");
      setAccessLevel("read");
      setMessage("");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (shareId: string) => api.revokeShare(caseId, shareId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shares", caseId] });
      toast.success("Доступ отозван");
    },
    onError: (e: Error) => toast.error("Ошибка отзыва: " + e.message),
  });

  const handleShare = () => {
    if (!targetDoctorId) { toast.error("Выберите врача для передачи случая"); return; }
    shareMut.mutate();
  };

  const availableDoctors = doctors.filter(
    (d) => d.id !== currentDoctor?.id && !activeShares.some((s) => s.toDoctor?.id === d.id),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Поделиться с врачом
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted-foreground" />Врач-получатель</Label>
            <Select value={targetDoctorId} onValueChange={setTargetDoctorId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Выберите врача…" /></SelectTrigger>
              <SelectContent>
                {availableDoctors.length === 0 ? (
                  <SelectItem value="none" disabled>Нет доступных врачей</SelectItem>
                ) : (
                  availableDoctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.fullName} — {d.specialization}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Уровень доступа</Label>
            <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v as "read" | "comment")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="read"><span className="flex items-center gap-2"><Eye className="h-4 w-4" />Только просмотр</span></SelectItem>
                <SelectItem value="comment"><span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />Просмотр + комментарии</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Сообщение (опционально)</Label>
            <Textarea placeholder="Комментарий для получателя…" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </div>

          <Button onClick={handleShare} disabled={shareMut.isPending || !targetDoctorId} className="w-full gap-2">
            {shareMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Передача…</> : <><Send className="h-4 w-4" />Поделиться случаем</>}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            Активные доступы
            {activeShares.length > 0 && <Badge variant="secondary" className="ml-1">{activeShares.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sharesLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : activeShares.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Случай ещё не был передан другим врачам</p>
          ) : (
            <div className="max-h-64 overflow-y-auto pr-1 -mr-1">
              <div className="space-y-3">
                {activeShares.map((share) => (
                  <div key={share.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{share.toDoctor?.fullName}</span>
                        <Badge
                          variant="outline"
                          className={share.accessLevel === "comment" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shrink-0"}
                        >
                          {share.accessLevel === "comment" ? <><MessageSquare className="h-3 w-3 mr-1" />Комментарии</> : <><Eye className="h-3 w-3 mr-1" />Просмотр</>}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(share.createdAt).toLocaleDateString("ru-RU")}
                        {share.message && <span className="truncate ml-2">— {share.message}</span>}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:text-destructive shrink-0" disabled={revokeMut.isPending}>
                          <XCircle className="h-3.5 w-3.5" />Отозвать
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Отозвать доступ?</AlertDialogTitle>
                          <AlertDialogDescription>Врач {share.toDoctor?.fullName} больше не сможет просматривать этот случай.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => revokeMut.mutate(share.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Отозвать доступ</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </div>
          )}

          {shares.filter((s) => s.status === "revoked").length > 0 && (
            <>
              <Separator className="my-4" />
              <p className="text-xs text-muted-foreground mb-2">Отозванные доступы</p>
              <div className="space-y-2">
                {shares.filter((s) => s.status === "revoked").map((share) => (
                  <div key={share.id} className="flex items-center gap-2 text-xs text-muted-foreground opacity-60">
                    <XCircle className="h-3.5 w-3.5" />
                    <span>{share.toDoctor?.fullName}</span>
                    <Badge variant="outline" className="text-xs">Отозван</Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
