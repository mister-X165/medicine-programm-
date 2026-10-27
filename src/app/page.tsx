"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth/auth-gate";
import { E2EEProvider } from "@/components/e2ee/e2ee-provider";
import { useAppStore } from "@/lib/store";

// Вьюхи подгружаются лениво (code-splitting), чтобы не тянуть весь UI в
// начальный бандл — каждая грузится только при первом открытии.
const ViewLoading = () => (
  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
    Загрузка…
  </div>
);

const Dashboard = dynamic(() => import("@/components/views/dashboard").then((m) => m.Dashboard), { loading: ViewLoading });
const Analytics = dynamic(() => import("@/components/views/analytics").then((m) => m.Analytics), { loading: ViewLoading });
const AuditLog = dynamic(() => import("@/components/views/audit-log").then((m) => m.AuditLog), { loading: ViewLoading });
const KnowledgeBase = dynamic(() => import("@/components/views/knowledge-base").then((m) => m.KnowledgeBase), { loading: ViewLoading });
const AdminPanel = dynamic(() => import("@/components/views/admin-panel").then((m) => m.AdminPanel), { loading: ViewLoading });
const About = dynamic(() => import("@/components/views/about").then((m) => m.About), { loading: ViewLoading });
const Calculators = dynamic(() => import("@/components/views/calculators").then((m) => m.Calculators), { loading: ViewLoading });
const MedicalRecord = dynamic(() => import("@/components/views/medical-record").then((m) => m.MedicalRecord), { loading: ViewLoading });
const CaseWorkspace = dynamic(() => import("@/components/views/case-workspace").then((m) => m.CaseWorkspace), { loading: ViewLoading });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10000,
    },
  },
});

function MainContent() {
  const view = useAppStore((s) => s.view);
  const currentDoctor = useAppStore((s) => s.currentDoctor);
  const isAdmin = currentDoctor?.role === "admin";

  switch (view) {
    case "dashboard":
      return <Dashboard />;
    case "medical-record":
      return <MedicalRecord />;
    case "case-workspace":
      return <CaseWorkspace />;
    case "calculators":
      return <Calculators />;
    case "analytics":
      return <Analytics />;
    case "audit":
      return <AuditLog />;
    case "knowledge":
      return <KnowledgeBase />;
    case "admin":
      return isAdmin ? <AdminPanel /> : <Dashboard />;
    case "about":
      return <About />;
    default:
      return <Dashboard />;
  }
}

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <E2EEProvider>
        <AuthGate>
          <AppShell>
            <MainContent />
          </AppShell>
        </AuthGate>
      </E2EEProvider>
    </QueryClientProvider>
  );
}
