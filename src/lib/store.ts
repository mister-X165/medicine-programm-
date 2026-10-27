"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "./i18n";

export type View = "dashboard" | "analytics" | "audit" | "knowledge" | "admin" | "about" | "calculators" | "medical-record" | "case-workspace";

export interface DoctorProfile {
  id: string;
  fullName: string;
  specialization: string;
  doctorCode: string;
  role: string;
  isActive: boolean;
  hasPassword?: boolean;
}

interface AppState {
  // Navigation
  view: View;
  selectedCaseId: string | null;
  selectedPatientId: string | null;
  sidebarCollapsed: boolean;

  // Auth
  currentDoctor: DoctorProfile | null;
  isLoggedIn: boolean;
  showLoginDialog: boolean;

  // Locale
  locale: Locale;

  // Actions
  setView: (view: View) => void;
  selectCase: (id: string | null) => void;
  selectPatient: (id: string | null) => void;
  toggleSidebar: () => void;
  loginDoctor: (doctor: DoctorProfile) => void;
  logoutDoctor: () => void;
  switchDoctor: (doctor: DoctorProfile) => void;
  setShowLoginDialog: (show: boolean) => void;
  setLocale: (locale: Locale) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "dashboard",
      selectedCaseId: null,
      selectedPatientId: null,
      sidebarCollapsed: false,
      currentDoctor: null,
      isLoggedIn: false,
      showLoginDialog: false,
      locale: "ru" as Locale,

      setView: (view) => set({ view }),
      // v2.7.2 (audit fix): открытие кейса теперь переводит приложение в
      // представление «case-workspace» — раньше selectCase только записывал id,
      // и клик по кейсу на рабочем столе/в палитре команд ничего не открывал.
      selectCase: (id) =>
        set(id ? { selectedCaseId: id, view: "case-workspace" } : { selectedCaseId: null }),
      selectPatient: (id) => set({ selectedPatientId: id, view: "medical-record" }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      loginDoctor: (doctor) => set({ currentDoctor: doctor, isLoggedIn: true, showLoginDialog: false }),
      logoutDoctor: () => set({ currentDoctor: null, isLoggedIn: false, view: "dashboard", selectedCaseId: null, selectedPatientId: null }),
      switchDoctor: (doctor) => set({ currentDoctor: doctor }),
      setShowLoginDialog: (show) => set({ showLoginDialog: show }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "sppvr-store",
      partialize: (state) => ({
        currentDoctor: state.currentDoctor,
        isLoggedIn: state.isLoggedIn,
        sidebarCollapsed: state.sidebarCollapsed,
        locale: state.locale,
      }),
    },
  ),
);
