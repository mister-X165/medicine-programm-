"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  FileCheck,
  Share2,
  AlertTriangle,
  Info,
  Trash2,
  CheckCheck,
  ExternalLink,
  ShieldAlert,
  ClipboardCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  analysis_complete: { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/15" },
  report_approved: { icon: FileCheck, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/15" },
  case_shared: { icon: Share2, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/15" },
  warning: { icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/15" },
  ddi_alert: { icon: ShieldAlert, color: "text-red-600 dark:text-red-400", bg: "bg-red-500/15" },
  consent_required: { icon: ClipboardCheck, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/15" },
  system: { icon: Info, color: "text-muted-foreground", bg: "bg-muted" },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] ?? TYPE_CONFIG.system;
}

function relativeTime(dateStr: string, locale: "ru" | "en"): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("notifications.justNow", locale);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${t("notifications.minutesAgo", locale)}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("notifications.hoursAgo", locale)}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${t("notifications.daysAgo", locale)}`;
  return new Date(dateStr).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short" });
}

function NotificationRow({
  item,
  onRead,
  onDelete,
  onNavigate,
  locale,
}: {
  item: NotificationItem;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (caseId: string) => void;
  locale: "ru" | "en";
}) {
  const config = getTypeConfig(item.type);
  const Icon = config.icon;

  const handleClick = () => {
    if (!item.isRead) onRead(item.id);
    if (item.caseId) onNavigate(item.caseId);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(item.id);
  };

  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer",
        item.isRead ? "bg-background hover:bg-muted/50" : "bg-muted/60 hover:bg-muted",
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      aria-label={item.title}
    >
      {!item.isRead && (
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}
      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", config.bg)}>
        <Icon className={cn("h-4 w-4", config.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-sm leading-snug", item.isRead ? "text-muted-foreground" : "text-foreground font-medium")}>
            {item.title}
          </p>
          <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
            {relativeTime(item.createdAt, locale)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {item.message}
        </p>
        {item.caseId && (
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary">
            <ExternalLink className="h-3 w-3" />
            {t("notifications.goToCase", locale)}
          </span>
        )}
      </div>
      <button
        onClick={handleDelete}
        className="absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        aria-label={t("notifications.deleteNotification", locale)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function NotificationsPanel() {
  const qc = useQueryClient();
  const currentDoctor = useAppStore((s) => s.currentDoctor);
  const selectCase = useAppStore((s) => s.selectCase);
  const locale = useAppStore((s) => s.locale);
  const [open, setOpen] = React.useState(false);

  const doctorId = currentDoctor?.id ?? "";

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", doctorId],
    queryFn: () => api.getNotifications(doctorId),
    enabled: !!doctorId,
    refetchInterval: 30000,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const markReadMut = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications", doctorId] }); },
    onError: (e: Error) => toast.error(t("common.error", locale) + ": " + e.message),
  });

  const markAllReadMut = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter((n) => !n.isRead);
      await Promise.all(unread.map((n) => api.markNotificationRead(n.id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", doctorId] });
      toast.success(locale === "ru" ? "Все уведомления отмечены как прочитанные" : "All notifications marked as read");
    },
    onError: (e: Error) => toast.error(t("common.error", locale) + ": " + e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteNotification(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications", doctorId] }); },
    onError: (e: Error) => toast.error(t("common.error", locale) + ": " + e.message),
  });

  const clearReadMut = useMutation({
    mutationFn: () => api.clearReadNotifications(doctorId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["notifications", doctorId] });
      toast.success(locale === "ru" ? `Удалено ${res.deleted} прочитанных уведомлений` : `Deleted ${res.deleted} read notifications`);
    },
    onError: (e: Error) => toast.error(t("common.error", locale) + ": " + e.message),
  });

  const handleNavigate = (caseId: string) => {
    selectCase(caseId);
    setOpen(false);
  };

  if (!doctorId) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={`${t("notifications.title", locale)}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
              variant="destructive"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[360px] p-0 sm:w-[400px]" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t("notifications.title", locale)}</h3>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{unreadCount}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => markAllReadMut.mutate()} disabled={markAllReadMut.isPending} aria-label={t("notifications.markAllRead", locale)}>
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("notifications.markAllRead", locale)}</span>
              </Button>
            )}
            {notifications.some((n) => n.isRead) && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => clearReadMut.mutate()} disabled={clearReadMut.isPending} aria-label={t("notifications.clear", locale)}>
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("notifications.clear", locale)}</span>
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-[400px] [&>[data-radix-scroll-area-viewport]]:scrollbar-thin [&>[data-radix-scroll-area-viewport]]:scrollbar-thumb-muted-foreground/20 [&>[data-radix-scroll-area-viewport]]:scrollbar-track-transparent">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Bell className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("notifications.noNotifications", locale)}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {notifications.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onRead={(id) => markReadMut.mutate(id)}
                  onDelete={(id) => deleteMut.mutate(id)}
                  onNavigate={handleNavigate}
                  locale={locale}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="px-4 py-2 text-center">
              <span className="text-[11px] text-muted-foreground">{data?.count ?? 0} {t("notifications.count", locale)}</span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
