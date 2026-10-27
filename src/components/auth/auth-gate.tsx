"use client";

import * as React from "react";
import { useAppStore, type DoctorProfile } from "@/lib/store";
import { LoginDialog } from "@/components/auth/login-dialog";
import { api, purgeLegacyToken } from "@/lib/api";
import { useE2EESession } from "@/lib/e2ee/session";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const loginDoctor = useAppStore((s) => s.loginDoctor);
  const logoutDoctor = useAppStore((s) => s.logoutDoctor);
  const [hydrated, setHydrated] = React.useState(false);

  const hydrationRef = React.useRef(false);

  React.useEffect(() => {
    if (hydrationRef.current) return;
    hydrationRef.current = true;

    // v2.6: вычищаем легаси JWT из localStorage (миграция на cookie-only)
    purgeLegacyToken();

    (async () => {
      // v4.2.1 FIX (audit 6-a / #2): drop the dead "sppvr-current-doctor"
      // localStorage read — that key is NEVER written anywhere (the store
      // persists under "sppvr-store" instead). The legacy block was dead
      // code and produced no UI effect.
      //
      // We now rely exclusively on the server-side session check
      // (`GET /api/auth`) and rehydrate the full doctor profile via
      // `api.getDoctor(id)` so the header / doctor-switcher renders the
      // real `fullName` and `specialization` instead of the spoofed
      // `fullName = doctorCode` fallback that was previously used.
      try {
        const session = await api.checkSession();
        if (session.authenticated && session.doctor) {
          const doctorId = session.doctor.doctorId;
          const role = session.doctor.role;

          // Fetch the full profile (fullName, specialization) — the bare
          // session response only carries { doctorId, doctorCode, role }.
          let fullName = session.doctor.doctorCode;
          let specialization = "";
          try {
            const { doctor } = await api.getDoctor(doctorId);
            fullName = doctor.fullName;
            specialization = doctor.specialization;
          } catch {
            // Doctor lookup failed (network glitch, doctor deactivated
            // mid-session). Fall back to doctorCode so the user still
            // sees *something* — the next protected API call will
            // return 401 and trigger a clean logout.
          }

          const server: DoctorProfile = {
            id: doctorId,
            fullName,
            specialization,
            doctorCode: session.doctor.doctorCode,
            role,
            isActive: true,
          };
          loginDoctor(server);

          // Серверная роль — источник истины (роль могла измениться
          // в другой сессии). Если профиль уже был восстановлен из
          // persist-хранилища с устаревшей ролью — обновляем.
          const current = useAppStore.getState().currentDoctor;
          if (current && current.id === server.id && current.role !== server.role) {
            useAppStore.getState().switchDoctor({ ...current, role: server.role });
          }
        } else {
          // Cookie истёк/отозван — локальное состояние неверно
          logoutDoctor();
          useE2EESession.getState().lock();
        }
      } catch {
        // Сеть недоступна — оставляем локальное состояние (offline-режим UI),
        // API-запросы всё равно вернут 401 и обработаются по событию.
      }
    })();

    setHydrated(true);
  }, [loginDoctor, logoutDoctor]);

  if (!hydrated) {
    return null;
  }

  if (!isLoggedIn) {
    return <LoginDialog />;
  }

  return <>{children}</>;
}
