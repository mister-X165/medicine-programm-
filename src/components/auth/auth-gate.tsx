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
      // Восстановление локального профиля (UI-состояние)…
      try {
        const stored = localStorage.getItem("sppvr-current-doctor");
        if (stored) {
          const doctor = JSON.parse(stored) as DoctorProfile;
          if (!doctor.role) doctor.role = "doctor";
          loginDoctor(doctor);
        }
      } catch {
        // ignore parse errors
      }

      // …но НЕ доверяем ему: проверяем РЕАЛЬНУЮ серверную сессию (cookie).
      // Ранее профиль (включая role) восстанавливался из localStorage без
      // проверки — UI-спуфинг. Теперь: нет валидной сессии → выходим.
      try {
        const session = await api.checkSession();
        if (session.authenticated && session.doctor) {
          const server: DoctorProfile = {
            id: session.doctor.doctorId,
            fullName: (session.doctor as { doctorCode?: string }).doctorCode ?? "",
            specialization: "",
            doctorCode: (session.doctor as { doctorCode?: string }).doctorCode ?? "",
            role: session.doctor.role,
            isActive: true,
          };
          // Серверная роль — источник истины (роль могла измениться)
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
