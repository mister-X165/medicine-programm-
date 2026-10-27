"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  User,
  LogOut,
  Lock,
  ChevronDown,
  Stethoscope,
  Shield,
} from "lucide-react";
import { useAppStore, type DoctorProfile } from "@/lib/store";
import { api, setAuthToken } from "@/lib/api";
import { lockVault } from "@/lib/e2ee/bootstrap";
import { useE2EESession } from "@/lib/e2ee/session";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { toast } from "sonner";

export function DoctorProfileSwitcher() {
  const { currentDoctor, logoutDoctor } = useAppStore();
  const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false);

  const { data: doctorsData } = useQuery({
    queryKey: ["doctors"],
    queryFn: api.getDoctors,
  });

  const doctors = doctorsData?.doctors ?? [];

  const handleSwitch = (doctorId: string) => {
    const found = doctors.find((d) => d.id === doctorId);
    if (found) {
      // SECURITY (v2.1): switching profiles must NOT silently reuse the
      // current session token — that would let a doctor impersonate an
      // admin by simply clicking their name. Instead we clear the token
      // and force re-login as the selected doctor.
      setAuthToken(null);
      logoutDoctor();
      useAppStore.getState().setShowLoginDialog(true);
      toast.info(`Войдите как ${found.fullName}`);
    }
  };

  const handleLogout = async () => {
    // v2.6: серверный logout инвалидирует HttpOnly-cookie (локально её
    // удалить нельзя), затем затираем DEK и выходим.
    try {
      await api.logout();
    } catch {
      // даже при ошибке сети — локальный выход (cookie истечёт по TTL)
    }
    setAuthToken(null);
    lockVault();
    useE2EESession.getState().setStatus("checking");
    logoutDoctor();
    toast.info("Вы вышли из системы");
  };

  if (!currentDoctor) return null;

  const isAdmin = currentDoctor.role === "admin";

  const initials = currentDoctor.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 px-2 h-auto py-1.5"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className={isAdmin ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" : "bg-primary/15 text-primary text-xs font-semibold"}>
                {isAdmin ? <Shield className="h-3.5 w-3.5" /> : initials || <Stethoscope className="h-3.5 w-3.5" />}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium leading-tight truncate max-w-[120px]">
                  {currentDoctor.fullName}
                </span>
                {isAdmin && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
                    ADMIN
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {currentDoctor.doctorCode} · {currentDoctor.specialization}
              </div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium leading-none">
                  {currentDoctor.fullName}
                </p>
                {isAdmin && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
                    ADMIN
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentDoctor.doctorCode} — {currentDoctor.specialization}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {doctors.length > 1 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Переключить профиль
              </DropdownMenuLabel>
              {doctors
                .filter((d) => d.id !== currentDoctor.id)
                .map((doctor) => (
                  <DropdownMenuItem
                    key={doctor.id}
                    onClick={() => handleSwitch(doctor.id)}
                    className="gap-2"
                  >
                    {doctor.role === "admin" ? <Shield className="h-4 w-4 text-amber-600" /> : <User className="h-4 w-4" />}
                    <span className="truncate">{doctor.fullName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {doctor.doctorCode ?? doctor.id.slice(0, 6)}
                    </span>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
          )}

          <DropdownMenuItem
            onClick={() => setPasswordDialogOpen(true)}
            className="gap-2"
          >
            <Lock className="h-4 w-4" />
            Изменить пароль
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleLogout}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />
    </>
  );
}
