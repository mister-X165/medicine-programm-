"use client";

import * as React from "react";
import {
  LayoutDashboard,
  BarChart3,
  ScrollText,
  Info,
  Activity,
  Stethoscope,
  ShieldCheck,
  Shield,
  Database,
  Globe,
  Calculator,
  UserRound,
  Search,
  Command as CommandIcon,
  Lock as LockIcon,
  LockOpen,
  Menu,
  X,
  ChevronLeft,
} from "lucide-react";
import { useAppStore, type View } from "@/lib/store";
import { t } from "@/lib/i18n";
import { useE2EESession } from "@/lib/e2ee/session";
import { lockVault } from "@/lib/e2ee/bootstrap";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { SystemStatusBadge } from "@/components/shared/system-status";
import { NotificationsPanel } from "@/components/shared/notifications-panel";
import { DoctorProfileSwitcher } from "@/components/auth/doctor-switcher";
import { CommandPalette } from "@/components/shared/command-palette";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

function getNavItems(locale: "ru" | "en"): Array<{
  id: View;
  label: string;
  icon: React.ElementType;
  description: string;
  adminOnly?: boolean;
}> {
  return [
    { id: "dashboard", label: t("nav.dashboard", locale), icon: LayoutDashboard, description: t("nav.dashboard", locale) },
    { id: "medical-record", label: t("nav.medicalRecord", locale), icon: UserRound, description: t("nav.medicalRecord", locale) },
    { id: "calculators", label: locale === "ru" ? "Калькуляторы" : "Calculators", icon: Calculator, description: locale === "ru" ? "Клинические калькуляторы" : "Clinical calculators" },
    { id: "analytics", label: t("nav.analytics", locale), icon: BarChart3, description: t("nav.analytics", locale) },
    { id: "audit", label: t("nav.audit", locale), icon: ScrollText, description: t("nav.audit", locale) },
    { id: "knowledge", label: t("nav.knowledge", locale), icon: Database, description: t("nav.knowledge", locale) },
    { id: "admin", label: t("nav.admin", locale), icon: Shield, description: t("nav.admin", locale), adminOnly: true },
    { id: "about", label: t("nav.about", locale), icon: Info, description: t("nav.about", locale) },
  ];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { view, setView, sidebarCollapsed, toggleSidebar, currentDoctor, locale, setLocale } = useAppStore();
  const isAdmin = currentDoctor?.role === "admin";
  const navItems = getNavItems(locale);
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  React.useEffect(() => { setMobileNavOpen(false); }, [view]);

  // Keyboard shortcut: Cmd+K (Mac) / Ctrl+K (Windows/Linux)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:p-3 focus:text-primary-foreground">{locale === "ru" ? "Перейти к содержимому" : "Skip to content"}</a>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-md">
        <div className="flex min-h-16 flex-wrap items-center gap-2 px-3 py-2 md:gap-3 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-expanded={mobileNavOpen} aria-controls="mobile-navigation" aria-label={locale === "ru" ? "Открыть навигацию" : "Open navigation"}>{mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</Button>
          <button onClick={() => setView("dashboard")} className="flex items-center gap-2.5" aria-label={locale === "ru" ? "На главную" : "Go home"}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-medical-gradient text-white shadow-md shadow-teal-500/20 ring-1 ring-teal-500/30">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div className="hidden text-left sm:block">
              <div className="text-sm font-bold leading-tight tracking-tight">{t("app.title", locale)}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{t("app.tagline", locale)}</div>
            </div>
          </button>
          {/* Command palette search trigger */}
          <button
            onClick={() => setCommandOpen(true)}
            className="group flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:ml-4 md:w-64"
            aria-label={locale === "ru" ? "Поиск (Ctrl+K)" : "Search (Ctrl+K)"}
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden flex-1 text-left md:inline">
              {locale === "ru" ? "Поиск пациентов, случаев…" : "Search patients, cases…"}
            </span>
            <kbd className="hidden items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium md:flex">
              <CommandIcon className="h-2.5 w-2.5" />K
            </kbd>
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-1 md:gap-2">
            <E2EEStatusBadge />
            <DoctorProfileSwitcher />
            <NotificationsPanel />
            <SystemStatusBadge />
            {/* Language Switcher */}
            <Select value={locale} onValueChange={(v) => setLocale(v as "ru" | "en")}>
              <SelectTrigger className="h-9 w-auto gap-1.5 border-none bg-transparent px-2 shadow-none hover:bg-muted focus:ring-0">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium">{locale === "ru" ? "RU" : "EN"}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ru">🇷🇺 Русский</SelectItem>
                <SelectItem value="en">🇬🇧 English</SelectItem>
              </SelectContent>
            </Select>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className={cn("sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 border-r bg-sidebar md:block", sidebarCollapsed ? "w-16" : "w-64")}>
          <nav className="flex h-full flex-col p-2">
            {!sidebarCollapsed && <p className="px-3 pb-3 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{locale === "ru" ? "Рабочее пространство" : "Workspace"}</p>}
            <div className="space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={cn(
                      "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                      active
                        ? item.adminOnly
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-primary/10 text-primary font-semibold"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",

                    )}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.description}
                  >
                    {active && !item.adminOnly && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />
                    )}
                    <Icon className={cn("h-5 w-5 shrink-0 transition-transform group-hover:scale-110", active && !item.adminOnly && "text-primary")} />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-auto space-y-2 p-2">
              {!sidebarCollapsed && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
                  <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {locale === "ru" ? "ФЗ-152 · Локально" : "ФЗ-152 · Local"}
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {locale === "ru" ? "Данные обрабатываются локально. Де-идентификация выполняется перед ИИ-анализом." : "Data is processed locally. De-identification is performed before AI analysis."}
                  </p>
                </div>
              )}
              {!sidebarCollapsed && (
                <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 text-xs">
                  <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-teal-700 dark:text-teal-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {locale === "ru" ? "Источник КР: Минздрав РФ" : "CR source: MoH RF"}
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {locale === "ru" ? "Клинические рекомендации — только из официального репозитория cr.minzdrav.gov.ru." : "Clinical guidelines — official repository cr.minzdrav.gov.ru only."}
                  </p>
                </div>
              )}
              <button
                onClick={toggleSidebar}
                className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent/50"
                aria-label={t("nav.collapsePanel", locale)}
              >
                <ChevronLeft className={cn("h-4 w-4 transition-transform", sidebarCollapsed && "rotate-180")} />
              </button>
            </div>
          </nav>
        </aside>

        {mobileNavOpen && (
          <nav id="mobile-navigation" aria-label={locale === "ru" ? "Разделы приложения" : "App sections"} className="fixed inset-x-0 top-16 bottom-0 z-30 overflow-y-auto bg-card p-4 md:hidden">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} onClick={() => { setView(item.id); setMobileNavOpen(false); }} aria-current={view === item.id ? "page" : undefined} className={cn("mb-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-sm", view === item.id ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted")}><Icon className="h-5 w-5" />{item.label}</button>;
            })}
          </nav>
        )}

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
            {children}
          </div>
        </main>
      </div>

      {/* Global Command Palette (Ctrl/Cmd+K) */}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

      <footer className="mt-auto border-t bg-background py-3 px-4 md:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">{t("app.title", locale)}</span>
            <span>·</span>
            <span>{t("app.footer", locale)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span>{t("app.footerCompliance", locale)}</span>
            <span>·</span>
            <span>{t("app.version", locale)}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ----------------------------------------------------------------------------
// E2EE v2.6 — индикатор состояния хранилища ключей в шапке
// ----------------------------------------------------------------------------

function E2EEStatusBadge() {
  const status = useE2EESession((s) => s.status);
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const logoutDoctor = useAppStore((s) => s.logoutDoctor);

  if (!isLoggedIn || status === "checking") return null;

  const handleLock = () => {
    lockVault();
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // cookie будет отозван при следующем входе
    }
    lockVault();
    useE2EESession.getState().setStatus("checking");
    logoutDoctor();
  };

  if (status === "unlocked") {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleLock}
          title="Заблокировать хранилище шифрования (ключ будет стёрт из памяти)"
          aria-label="Заблокировать хранилище шифрования"
          className="group flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
        >
          <LockOpen className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">E2EE активно</span>
        </button>
        <button
          onClick={handleLogout}
          title="Выйти из системы"
          aria-label="Выйти из системы"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LockIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (status === "locked") {
    return (
      <button
        disabled
        title="Хранилище заблокировано — введите пароль в диалоге разблокировки"
        className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
      >
        <LockIcon className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">Заблокировано</span>
      </button>
    );
  }

  // unavailable — ключ не создан (легаси-аккаунт)
  return (
    <button
      disabled
      title="Ключ шифрования не создан — данные пациентов не шифруются"
      className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive"
    >
      <LockIcon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">Без шифрования</span>
    </button>
  );
}

