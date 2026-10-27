"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  Dna,
  FileText,
  Clock,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SearchResultItem, CaseStatus } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "new", label: "Новый" },
  { value: "uploaded", label: "Данные загружены" },
  { value: "analyzing", label: "Анализ…" },
  { value: "analyzed", label: "Проанализирован" },
  { value: "reported", label: "Отчёт готов" },
];

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "bg-muted text-muted-foreground" },
  uploaded: { label: "Данные загружены", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  analyzing: { label: "Анализ…", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  analyzed: { label: "Проанализирован", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  reported: { label: "Отчёт готов", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400" },
};

interface SearchFilters {
  q: string;
  gene: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  doctorId: string;
}

const DEFAULT_FILTERS: SearchFilters = { q: "", gene: "", status: "", dateFrom: "", dateTo: "", doctorId: "" };

function hasActiveFilters(filters: SearchFilters): boolean {
  return filters.q !== "" || filters.gene !== "" || filters.status !== "" || filters.dateFrom !== "" || filters.dateTo !== "" || filters.doctorId !== "";
}

export function AdvancedSearch() {
  const selectCase = useAppStore((s) => s.selectCase);
  const [filters, setFilters] = React.useState<SearchFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const limit = 10;

  React.useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(filters.q); }, 300);
    return () => clearTimeout(timer);
  }, [filters.q]);

  React.useEffect(() => { setPage(1); }, [debouncedQ, filters.gene, filters.status, filters.dateFrom, filters.dateTo, filters.doctorId]);

  const { data: doctorsData } = useQuery({
    queryKey: ["doctors"],
    queryFn: api.getDoctors,
  });

  const searchParams = React.useMemo(() => {
    const params: Record<string, string | number> = { page, limit };
    if (debouncedQ) params.q = debouncedQ;
    if (filters.gene) params.gene = filters.gene;
    if (filters.status) params.status = filters.status;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    if (filters.doctorId) params.doctorId = filters.doctorId;
    return params;
  }, [debouncedQ, filters, page, limit]);

  const hasQuery = hasActiveFilters({ ...filters, q: debouncedQ });

  const { data: searchData, isLoading } = useQuery({
    queryKey: ["search", searchParams],
    queryFn: () => api.searchCases(searchParams as Parameters<typeof api.searchCases>[0]),
    enabled: hasQuery,
  });

  const results = searchData?.results ?? [];
  const total = searchData?.total ?? 0;
  const totalPages = searchData?.totalPages ?? 0;

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => { setFilters(DEFAULT_FILTERS); };

  const activeFilterCount = [filters.gene, filters.status, filters.dateFrom, filters.dateTo, filters.doctorId].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск по коду, диагнозу, заметкам…" value={filters.q} onChange={(e) => updateFilter("q", e.target.value)} className="pl-9" />
          {filters.q && (
            <button onClick={() => updateFilter("q", "")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Очистить поиск">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button variant={showFilters ? "default" : "outline"} className="gap-2 shrink-0" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Фильтры</span>
          {activeFilterCount > 0 && <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs">{activeFilterCount}</Badge>}
        </Button>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="gene-filter" className="text-xs font-medium">Ген / мутация</Label>
                <div className="relative">
                  <Dna className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="gene-filter" placeholder="Напр. BRCA1, EGFR…" value={filters.gene} onChange={(e) => updateFilter("gene", e.target.value)} className="pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Статус</Label>
                <Select value={filters.status} onValueChange={(v) => updateFilter("status", v === "__all__" ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Все статусы" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все статусы</SelectItem>
                    {STATUS_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Врач</Label>
                <Select value={filters.doctorId} onValueChange={(v) => updateFilter("doctorId", v === "__all__" ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Все врачи" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все врачи</SelectItem>
                    {doctorsData?.doctors?.map((d) => (<SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date-from" className="text-xs font-medium">Дата от</Label>
                <Input id="date-from" type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date-to" className="text-xs font-medium">Дата до</Label>
                <Input id="date-to" type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={clearFilters} disabled={!hasActiveFilters(filters)}>
                  <X className="h-3.5 w-3.5" />Сбросить фильтры
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!hasQuery ? (
        <EmptySearchPrompt />
      ) : isLoading ? (
        <LoadingState />
      ) : results.length === 0 ? (
        <NoResults onClear={clearFilters} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Найдено: <span className="font-medium text-foreground">{total}</span> {total === 1 ? "результат" : total < 5 ? "результата" : "результатов"}</p>
            {totalPages > 1 && <p className="text-sm text-muted-foreground">Стр. {page} из {totalPages}</p>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
            <div className="space-y-2">
              {results.map((item) => (
                <SearchResultCard key={item.caseId} item={item} searchQuery={debouncedQ} onClick={() => selectCase(item.caseId)} />
              ))}
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="gap-1">
                <ChevronLeft className="h-4 w-4" />Назад
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="gap-1">
                Вперёд<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchResultCard({ item, searchQuery, onClick }: { item: SearchResultItem; searchQuery: string; onClick: () => void }) {
  const statusInfo = STATUS_BADGE[item.status] ?? STATUS_BADGE.new;

  return (
    <div className="group flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{item.caseCode}</span>
          <Badge variant="outline" className={cn("shrink-0", statusInfo.color)}>{statusInfo.label}</Badge>
          {item.relevanceScore > 0 && <Badge variant="secondary" className="shrink-0 text-xs">{Math.round(item.relevanceScore * 100)}%</Badge>}
        </div>
        {item.diagnosisHint && (
          <p className="mt-0.5 text-sm text-muted-foreground truncate">
            <HighlightText text={item.diagnosisHint} query={searchQuery} />
          </p>
        )}
        {item.matchedGenes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Dna className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {item.matchedGenes.map((gene) => (
              <Badge key={gene} variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">{gene}</Badge>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{item.doctorName}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(item.createdAt).toLocaleDateString("ru-RU")}</span>
        </div>
      </div>
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return <>{text}</>;
  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);
  return <>{before}<mark className="bg-yellow-200 dark:bg-yellow-800/50 rounded-sm px-0.5">{match}</mark>{after}</>;
}

function EmptySearchPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Search className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">Расширенный поиск</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Введите запрос для поиска по случаям пациентов. Используйте фильтры для поиска по генам, мутациям, статусу и дате.</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Поиск…
      </div>
    </div>
  );
}

function NoResults({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <FolderOpen className="mb-2 h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium">Ничего не найдено</p>
      <p className="mt-1 text-xs text-muted-foreground">Попробуйте изменить параметры поиска или фильтры</p>
      <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={onClear}><X className="h-3.5 w-3.5" />Сбросить фильтры</Button>
    </div>
  );
}
