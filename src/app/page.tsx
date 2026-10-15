"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth/auth-gate";
import { E2EEProvider } from "@/components/e2ee/e2ee-provider";
import { useAppStore } from "@/lib/store";
import { Dashboard } from "@/components/views/dashboard";
import { Analytics } from "@/components/views/analytics";
import { AuditLog } from "@/components/views/audit-log";
import { KnowledgeBase } from "@/components/views/knowledge-base";
import { AdminPanel } from "@/components/views/admin-panel";
import { About } from "@/components/views/about";
import { Calculators } from "@/components/views/calculators";
import { MedicalRecord } from "@/components/views/medical-record";
import { CaseWorkspace } from "@/components/views/case-workspace";

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
