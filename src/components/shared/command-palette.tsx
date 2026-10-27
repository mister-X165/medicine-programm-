"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  Search,
  UserRound,
  FolderOpen,
  Calculator,
  BarChart3,
  Database,
  ScrollText,
  Shield,
  Info,
  Stethoscope,
  Plus,
  FileText,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppStore, type View } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  id: string;
  type: "patient" | "case" | "action" | "navigation";
  label: string;
  subtitle?: string;
  icon: LucideIcon;
  action: () => void;
  group: string;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { setView, selectPatient, selectCase, currentDoctor } = useAppStore();
  const [search, setSearch] = React.useState("");

  // Fetch patients and cases for search
  const { data: patientsData } = useQuerySafe(() => api.getPatients(), ["cp-patients"]);
  const { data: casesData } = useQuerySafe(() => api.getCases(), ["cp-cases"]);

  const patients = patientsData?.patients ?? [];
  const cases = casesData?.cases ?? [];

  const results = React.useMemo<SearchResult[]>(() => {
    const res: SearchResult[] = [];

    // Navigation actions
    const navItems: Array<{ view: View; label: string; icon: LucideIcon; desc: string }> = [
      { view: "dashboard", label: "Рабочий стол", icon: Stethoscope, desc: "Дашборд и список случаев" },
      { view: "medical-record", label: "Медкарта", icon: UserRound, desc: "Электронная медкарта пациента" },
      { view: "calculators", label: "Калькуляторы", icon: Calculator, desc: "Клинические калькуляторы" },
      { view: "analytics", label: "Аналитика", icon: BarChart3, desc: "Метрики и графики" },
      { view: "knowledge", label: "База знаний", icon: Database, desc: "Рекомендации, МКБ-10, DDI" },
      { view: "audit", label: "Журнал аудита", icon: ScrollText, desc: "WORM-журнал действий" },
      { view: "admin", label: "Админ-панель", icon: Shield, desc: "Управление системой" },
      { view: "about", label: "О системе", icon: Info, desc: "Информация о системе" },
    ];

    for (const n of navItems) {
      if (n.view === "admin" && currentDoctor?.role !== "admin") continue;
      const q = search.toLowerCase();
      if (!q || n.label.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q)) {
        res.push({
          id: `nav-${n.view}`,
          type: "navigation",
          label: n.label,
          subtitle: n.desc,
          icon: n.icon,
          group: "Навигация",
          action: () => { setView(n.view); onOpenChange(false); },
        });
      }
    }

    // Quick action: new patient
    if (!search || "новый пациент".includes(search.toLowerCase())) {
      res.push({
        id: "action-new-patient",
        type: "action",
        label: "Создать пациента",
        subtitle: "Новая медицинская карта",
        icon: Plus,
        group: "Действия",
        action: () => { setView("medical-record"); onOpenChange(false); },
      });
    }

    // Patients
    if (search) {
      const q = search.toLowerCase();
      for (const p of patients) {
        const fullName = `${p.lastName} ${p.firstName} ${p.middleName || ""}`.trim().toLowerCase();
        if (fullName.includes(q) || p.patientToken.toLowerCase().includes(q) || (p.snils || "").includes(q)) {
          res.push({
            id: `patient-${p.id}`,
            type: "patient",
            label: `${p.lastName} ${p.firstName} ${p.middleName || ""}`.trim() || p.patientToken,
            subtitle: `${p.patientToken} · ${p.age != null ? p.age + " лет" : ""} ${p.sex === "М" ? "♂" : p.sex === "Ж" ? "♀" : ""} ${p.bloodType || ""}`.trim(),
            icon: UserRound,
            group: "Пациенты",
            action: () => { selectPatient(p.id); onOpenChange(false); },
          });
        }
      }

      // Cases
      for (const c of cases) {
        const text = `${c.caseCode} ${c.diagnosisHint || ""} ${c.notes || ""}`.toLowerCase();
        if (text.includes(q)) {
          res.push({
            id: `case-${c.id}`,
            type: "case",
            label: c.caseCode,
            subtitle: `${c.diagnosisHint || "Без диагноза"} · ${c.status}`,
            icon: FolderOpen,
            group: "Случаи",
            action: () => { selectCase(c.id); onOpenChange(false); },
          });
        }
      }
    }

    // If no search, show top 5 patients and cases
    if (!search) {
      for (const p of patients.slice(0, 5)) {
        res.push({
          id: `patient-${p.id}`,
          type: "patient",
          label: `${p.lastName} ${p.firstName} ${p.middleName || ""}`.trim() || p.patientToken,
          subtitle: `${p.patientToken} · ${p.age != null ? p.age + " лет" : ""}`,
          icon: UserRound,
          group: "Недавние пациенты",
          action: () => { selectPatient(p.id); onOpenChange(false); },
        });
      }
      for (const c of cases.slice(0, 5)) {
        res.push({
          id: `case-${c.id}`,
          type: "case",
          label: c.caseCode,
          subtitle: `${c.diagnosisHint || "Без диагноза"} · ${c.status}`,
          icon: FolderOpen,
          group: "Недавние случаи",
          action: () => { selectCase(c.id); onOpenChange(false); },
        });
      }
    }

    return res;
  }, [search, patients, cases, setView, selectPatient, selectCase, onOpenChange, currentDoctor]);

  // Group results
  const grouped = React.useMemo(() => {
    const map: Record<string, SearchResult[]> = {};
    for (const r of results) {
      if (!map[r.group]) map[r.group] = [];
      map[r.group].push(r);
    }
    return map;
  }, [results]);

  const handleSelect = (id: string) => {
    const r = results.find((x) => x.id === id);
    if (r) r.action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-2xl sm:max-w-[600px]" showCloseButton={false}>
        <DialogTitle className="sr-only">Глобальный поиск</DialogTitle>
        <Command className="rounded-lg" shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandInput
              placeholder="Поиск пациентов, случаев, разделов… (или нажмите Esc для закрытия)"
              value={search}
              onValueChange={setSearch}
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <kbd className="pointer-events-none select-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              ESC
            </kbd>
          </div>
          <CommandList className="max-h-[400px] overflow-y-auto">
            <CommandEmpty>
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Search className="mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Ничего не найдено</p>
              </div>
            </CommandEmpty>
            {Object.entries(grouped).map(([group, items]) => (
              <React.Fragment key={group}>
                <CommandGroup heading={group}>
                  {items.map((r) => {
                    const Icon = r.icon;
                    return (
                      <CommandItem
                        key={r.id}
                        value={r.id}
                        onSelect={() => handleSelect(r.id)}
                        className="group flex cursor-pointer items-center gap-3 px-3 py-2.5"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-emerald-500/15 group-hover:text-emerald-600">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{r.label}</span>
                          {r.subtitle && <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span>}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
              </React.Fragment>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// Safe useQuery wrapper that doesn't crash if token is missing
import { useQuery } from "@tanstack/react-query";
function useQuerySafe<T>(fn: () => Promise<T>, key: unknown[]) {
  return useQuery<T>({
    queryKey: key,
    queryFn: fn,
    enabled: true,
    retry: false,
    staleTime: 30000,
  });
}
