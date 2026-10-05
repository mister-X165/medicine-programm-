"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  BookOpen,
  Dna,
  ShieldCheck,
  Filter,
  Upload,
  FileText,
  Loader2,
  X,
  FolderOpen,
  Pill,
  Code,
  Activity,
  Layers,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Landmark,
  ExternalLink,
  AlertTriangle,
  Database,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type {
  KnowledgeSearchResult,
  ClinrecMatch,
  MkbRefItem,
} from "@/lib/types";
import {
  MinzdravClinrecDialog,
  formatClinrecDate,
  type ClinrecDialogTarget,
} from "@/components/shared/minzdrav-clinrec-dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CATEGORY_LABELS: Record<string, string> = {
  oncology: "Онкология",
  pharmacogenomics: "Фармакогеномика",
  cardiology: "Кардиология",
  rare_diseases: "Редкие заболевания",
};

const CATEGORY_COLORS: Record<string, string> = {
  oncology: "bg-red-500/15 text-red-700 dark:text-red-400",
  pharmacogenomics: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cardiology: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  rare_diseases: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
};

// ---------------------------------------------------------------------------
// Global search source metadata — color-coded badges (NO indigo/blue primary).
//   recommendation → emerald
//   ddi            → red
//   icd10          → amber
//   pathway        → slate
// ---------------------------------------------------------------------------
type KnowledgeSource = KnowledgeSearchResult["source"];
type KnowledgeTab = "minzdrav" | "all" | "recommendations" | "ddi" | "icd10" | "pathways";

const SOURCE_META: Record<
  KnowledgeSource,
  { label: string; chipLabel: string; badgeClass: string; Icon: React.ElementType }
> = {
  recommendation: {
    label: "Рекомендация",
    chipLabel: "Рекомендации",
    badgeClass:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    Icon: BookOpen,
  },
  ddi: {
    label: "DDI",
    chipLabel: "DDI",
    badgeClass:
      "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    Icon: Pill,
  },
  icd10: {
    label: "МКБ-10",
    chipLabel: "МКБ-10",
    badgeClass:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    Icon: Code,
  },
  pathway: {
    label: "Путь",
    chipLabel: "Пути",
    badgeClass:
      "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
    Icon: Activity,
  },
  document: {
    label: "Документ",
    chipLabel: "Документы",
    badgeClass:
      "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
    Icon: FileText,
  },
};

const ALL_SOURCES: KnowledgeSource[] = ["recommendation", "ddi", "icd10", "pathway", "document"];

// ---------------------------------------------------------------------------
// Highlight — wraps every case-insensitive occurrence of `q` in a <mark>.
// Used for snippet + title rendering in the global search results list.
// ---------------------------------------------------------------------------
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let idx = 0;
  let key = 0;
  while (idx < text.length) {
    const found = lower.indexOf(needle, idx);
    if (found === -1) {
      parts.push(text.slice(idx));
      break;
    }
    if (found > idx) parts.push(text.slice(idx, found));
    parts.push(
      <mark
        key={key++}
        className="bg-yellow-200 dark:bg-yellow-900/50 rounded px-0.5"
      >
        {text.slice(found, found + needle.length)}
      </mark>,
    );
    idx = found + needle.length;
  }
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// metadataToRows — turn the per-source metadata bag into a flat list of
// (label, value) rows for the expanded view of a global search result.
// ---------------------------------------------------------------------------
function metadataToRows(
  source: KnowledgeSource,
  m?: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  if (!m) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const str = (v: unknown): string => (v == null ? "" : String(v));
  if (source === "recommendation") {
    if (m.category) rows.push({ label: "Категория", value: CATEGORY_LABELS[str(m.category)] ?? str(m.category) });
    if (m.gene) rows.push({ label: "Ген", value: str(m.gene) });
    if (m.mutation) rows.push({ label: "Мутация", value: str(m.mutation) });
    if (m.evidenceLevel) rows.push({ label: "Уровень", value: str(m.evidenceLevel) });
    if (m.source) rows.push({ label: "Источник", value: str(m.source) });
  } else if (source === "ddi") {
    if (m.severity) rows.push({ label: "Тяжесть", value: str(m.severity) });
    if (m.mechanism) rows.push({ label: "Механизм", value: str(m.mechanism) });
    if (m.management) rows.push({ label: "Ведение", value: str(m.management) });
    if (m.evidenceLevel) rows.push({ label: "Уровень", value: str(m.evidenceLevel) });
    if (m.source) rows.push({ label: "Источник", value: str(m.source) });
  } else if (source === "icd10") {
    if (m.code) rows.push({ label: "Код", value: str(m.code) });
    if (m.chapter) rows.push({ label: "Глава", value: str(m.chapter) });
    if (m.block) rows.push({ label: "Блок", value: str(m.block) });
  } else if (source === "pathway") {
    if (m.category) rows.push({ label: "Категория", value: CATEGORY_LABELS[str(m.category)] ?? str(m.category) });
    if (m.icd10Code) rows.push({ label: "МКБ-10", value: str(m.icd10Code) });
    if (m.version) rows.push({ label: "Версия", value: str(m.version) });
    if (m.source) rows.push({ label: "Источник", value: str(m.source) });
  }
  return rows;
}

export function KnowledgeBase() {
  const { currentDoctor, selectCase } = useAppStore();
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  // "minzdrav" — первичный источник: официальный репозиторий КР Минздрава РФ.
  const [activeTab, setActiveTab] = React.useState<KnowledgeTab>("minzdrav");
  // Per-source filter chips (default: all enabled).
  const [enabledSources, setEnabledSources] = React.useState<
    Record<KnowledgeSource, boolean>
  >({
    recommendation: true,
    ddi: true,
    icd10: true,
    pathway: true,
    document: true,
  });
  const qc = useQueryClient();

  React.useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(t); }, [search]);

  // Recommendations — always loaded (powers StatCards overview + recommendations tab)
  const { data, isLoading } = useQuery({
    queryKey: ["recommendations", debouncedSearch, category],
    queryFn: () => api.getRecommendations({ q: debouncedSearch || undefined, category: category !== "all" ? category : undefined }),
  });

  const { data: casesData } = useQuery({ queryKey: ["cases"], queryFn: api.getCases });
  const allCases = casesData?.cases ?? [];
  const recs = data?.recommendations ?? [];

  // DDI data
  const { data: ddiData, isLoading: ddiLoading } = useQuery({
    queryKey: ["ddi", debouncedSearch],
    queryFn: () => api.getDDIRecords({ drug: debouncedSearch || undefined, limit: 50 }),
    enabled: activeTab === "ddi",
  });

  // ICD-10 data
  const { data: icd10Data, isLoading: icd10Loading } = useQuery({
    queryKey: ["icd10", debouncedSearch],
    queryFn: () => api.getICD10Codes({ q: debouncedSearch || undefined, limit: 50 }),
    enabled: activeTab === "icd10",
  });

  // Pathways data
  const { data: pathwaysData, isLoading: pathwaysLoading } = useQuery({
    queryKey: ["pathways", category],
    queryFn: () => api.getPathways({ category: category !== "all" ? category : undefined }),
    enabled: activeTab === "pathways",
  });

  // NEW: Global aggregator search — fires when "Все" tab is active AND user
  // has typed at least one non-space character. Hits /api/knowledge which
  // fans the query out to all 4 sources server-side and returns a unified
  // ranked list (1 HTTP request instead of 4).
  const { data: globalData, isLoading: globalLoading } = useQuery({
    queryKey: ["knowledge-search", debouncedSearch],
    queryFn: () => api.searchKnowledge(debouncedSearch, 20),
    enabled: activeTab === "all" && debouncedSearch.trim().length > 0,
  });

  // Apply per-source filter chips to the global result list.
  const filteredResults = React.useMemo<KnowledgeSearchResult[]>(() => {
    const all = globalData?.results ?? [];
    return all.filter((r) => enabledSources[r.source]);
  }, [globalData, enabledSources]);

  const counts = globalData?.counts ?? {
    recommendation: 0,
    ddi: 0,
    icd10: 0,
    pathway: 0,
    document: 0,
  };

  const uploadMut = useMutation({
    mutationFn: async ({ file, caseId }: { file: File; caseId?: string }) => {
      return api.uploadKnowledgeDocument(file);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      setUploadOpen(false);
      toast.success(`Документ "${res.document.fileName}" загружен в базу данных`);
    },
    onError: (e: Error) => toast.error("Ошибка загрузки документа: " + e.message),
  });

  const [uploadFile, setUploadFile] = React.useState<File | null>(null);

  const toggleSource = (s: KnowledgeSource) => {
    setEnabledSources((prev) => ({ ...prev, [s]: !prev[s] }));
  };

  return (
    <div className="space-y-4">
      {/* Hero header with gradient accent */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 opacity-10">
          <BookOpen className="h-32 w-32 text-primary" />
        </div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <Landmark className="h-3.5 w-3.5" />
              Официальный источник: Минздрав РФ (cr.minzdrav.gov.ru)
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">База данных</h1>
            <p className="text-sm text-muted-foreground">Клинические рекомендации — из официального репозитория Минздрава России. Локальная база (RAG) и загруженные документы хранятся on-premise.</p>
          </div>
          <Button className="gap-2 bg-medical-gradient text-white shadow-lg shadow-emerald-500/20 hover:opacity-90" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />Загрузить документ
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard icon={BookOpen} label="Рекомендаций" value={data?.count ?? 0} accent="emerald" />
        <StatCard icon={Dna} label="Генов покрыто" value={new Set(recs.map((r) => r.gene).filter(Boolean)).size} accent="blue" />
        <StatCard icon={ShieldCheck} label="Категорий" value={new Set(recs.map((r) => r.category)).size} accent="purple" />
        <StatCard icon={Filter} label="В выдаче" value={recs.length} accent="amber" />
      </div>

      {/* Глобальный поиск (не показывается во вкладке «КР Минздрава» — там своя панель поиска) */}
      {activeTab !== "minzdrav" && (
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={activeTab === "all"
                  ? "Поиск по всем источникам (рекомендации, DDI, МКБ-10, пути). КР — из официального репозитория Минздрава…"
                  : "Поиск по гену, названию, ключевым словам…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Поиск по базе знаний"
              />
            </div>
            {activeTab !== "all" && (
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full sm:w-52"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все категории</SelectItem>
                  <SelectItem value="oncology">Онкология</SelectItem>
                  <SelectItem value="pharmacogenomics">Фармакогеномика</SelectItem>
                  <SelectItem value="cardiology">Кардиология</SelectItem>
                  <SelectItem value="rare_diseases">Редкие заболевания</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Загрузить документ в базу данных</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className={cn("relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors", uploadFile ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) setUploadFile(file); }}>
              {uploadFile ? (
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-primary" />
                  <div><div className="font-medium">{uploadFile.name}</div><div className="text-sm text-muted-foreground">{(uploadFile.size / 1024).toFixed(1)} КБ</div></div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setUploadFile(null)}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <><Upload className="mb-3 h-10 w-10 text-muted-foreground/50" /><p className="text-sm font-medium">Перетащите файл сюда</p><p className="mt-1 text-xs text-muted-foreground">VCF, CSV, TXT, PDF, DOCX, изображения</p></>
              )}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const file = e.target.files?.[0]; if (file) setUploadFile(file); }} accept=".vcf,.csv,.txt,.pdf,.docx,.doc,.png,.jpg,.jpeg" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose>
            <Button onClick={() => { if (uploadFile) uploadMut.mutate({ file: uploadFile }); }} disabled={!uploadFile || uploadMut.isPending} className="gap-2">
              {uploadMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Загрузка…</> : <><Upload className="h-4 w-4" />Загрузить</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as KnowledgeTab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="minzdrav" className="gap-1.5"><Landmark className="h-4 w-4" />КР Минздрава</TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5"><Layers className="h-4 w-4" />Все</TabsTrigger>
          <TabsTrigger value="recommendations" className="gap-1.5"><BookOpen className="h-4 w-4" />Рекомендации</TabsTrigger>
          <TabsTrigger value="ddi" className="gap-1.5"><Pill className="h-4 w-4" />DDI</TabsTrigger>
          <TabsTrigger value="icd10" className="gap-1.5"><Code className="h-4 w-4" />МКБ-10</TabsTrigger>
          <TabsTrigger value="pathways" className="gap-1.5"><Activity className="h-4 w-4" />Пути</TabsTrigger>
        </TabsList>

        {/* ===================================================================== */}
        {/* "КР Минздрава" — браузер официальных клинических рекомендаций          */}
        {/* ===================================================================== */}
        <TabsContent value="minzdrav">
          <MinzdravClinrecBrowser />
        </TabsContent>

        {/* ===================================================================== */}
        {/* "Все" tab — global aggregator search across all 4 sources             */}
        {/* ===================================================================== */}
        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4" />
                Глобальный поиск
              </CardTitle>
              <CardDescription className="text-xs">
                Поиск по всем источникам: рекомендации · DDI · МКБ-10 · клинические пути.
                Результаты отсортированы по релевантности.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Per-source counts */}
              {debouncedSearch.trim() && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Рекомендации: <strong className="text-foreground tabular-nums">{counts.recommendation}</strong>
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>
                    DDI: <strong className="text-foreground tabular-nums">{counts.ddi}</strong>
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>
                    МКБ-10: <strong className="text-foreground tabular-nums">{counts.icd10}</strong>
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>
                    Пути: <strong className="text-foreground tabular-nums">{counts.pathway}</strong>
                  </span>
                </div>
              )}

              {/* Source filter chips */}
              {debouncedSearch.trim() && (
                <div className="flex flex-wrap gap-2">
                  {ALL_SOURCES.map((s) => {
                    const meta = SOURCE_META[s];
                    const active = enabledSources[s];
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSource(s)}
                        aria-pressed={active}
                        aria-label={`Фильтр: ${meta.chipLabel}`}
                        className={cn(
                          "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          active
                            ? cn(meta.badgeClass, "shadow-sm")
                            : "border-muted bg-muted/40 text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <meta.Icon className="mr-1 inline-block h-3 w-3 align-[-2px]" />
                        {meta.chipLabel}
                        <span className="ml-1.5 tabular-nums opacity-70">
                          {counts[s] ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Results */}
              {!debouncedSearch.trim() ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Search className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm font-medium">Начните вводить запрос</p>
                  <p className="text-xs text-muted-foreground">
                    Глобальный поиск выполнится автоматически по всем 4 источникам.
                  </p>
                </div>
              ) : globalLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : filteredResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Search className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Ничего не найдено по запросу «{debouncedSearch}». Попробуйте изменить запрос или выбрать другой источник.
                  </p>
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
                  <div className="space-y-2">
                    {filteredResults.map((r) => (
                      <GlobalSearchResultCard key={`${r.source}-${r.id}`} result={r} q={debouncedSearch} />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations">
          <Card>
            <CardHeader><CardTitle className="text-base">Рекомендации ({recs.length})</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />))}</div>
              ) : recs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Рекомендации не найдены</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
                  <div className="space-y-2">
                    {recs.map((rec, idx) => (
                      <div key={rec.id as string ?? idx} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold">{rec.title as string}</h4>
                          <Badge variant="outline" className={cn("shrink-0 text-xs", CATEGORY_COLORS[rec.category as string])}>{CATEGORY_LABELS[rec.category as string] ?? (rec.category as string)}</Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {Boolean(rec.gene) && <span className="inline-flex items-center gap-1 font-mono font-medium text-emerald-600"><Dna className="h-3 w-3" />{rec.gene as string}</span>}
                          {Boolean(rec.mutation) && <span className="text-muted-foreground">{rec.mutation as string}</span>}
                          {Boolean(rec.evidenceLevel) && <Badge variant="secondary" className="text-xs">Уровень: {rec.evidenceLevel as string}</Badge>}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{rec.content as string}</p>
                        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">Источник: {rec.source as string}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ddi">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Pill className="h-4 w-4 text-red-600" />Лекарственные взаимодействия ({ddiData?.total ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {ddiLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />))}</div>
              ) : (ddiData?.interactions ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Взаимодействия не найдены</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
                  <div className="space-y-2">
                    {(ddiData?.interactions ?? []).map((ddi, i) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Pill className="h-4 w-4 text-red-600" />
                          <span className="font-medium text-sm">{ddi.drug1} + {ddi.drug2}</span>
                          <Badge variant="outline" className="text-xs">{ddi.severity}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{ddi.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="icd10">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Code className="h-4 w-4 text-primary" />МКБ-10 коды ({icd10Data?.total ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {icd10Loading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />))}</div>
              ) : (icd10Data?.codes ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Коды не найдены</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
                  <div className="space-y-2">
                    {(icd10Data?.codes ?? []).map((code, i) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-primary">{code.code}</span>
                          <Badge variant="outline" className="text-xs">{code.chapter}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{code.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pathways">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Клинические пути ({pathwaysData?.total ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {pathwaysLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />))}</div>
              ) : (pathwaysData?.pathways ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Клинические пути не найдены</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
                  <div className="space-y-2">
                    {(pathwaysData?.pathways ?? []).map((pathway, i) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{pathway.name}</span>
                          <Badge variant="outline" className="text-xs">{pathway.category}</Badge>
                        </div>
                        {pathway.icd10Code && <p className="mt-1 text-xs text-muted-foreground">МКБ-10: {pathway.icd10Code}</p>}
                        <p className="mt-1 text-sm text-muted-foreground">{pathway.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GlobalSearchResultCard — a single row in the "Все" tab ranked list.
// Title is clickable (Collapsible trigger) to reveal metadata details.
// ---------------------------------------------------------------------------
function GlobalSearchResultCard({
  result,
  q,
}: {
  result: KnowledgeSearchResult;
  q: string;
}) {
  const meta = SOURCE_META[result.source];
  const rows = metadataToRows(result.source, result.metadata);
  const [open, setOpen] = React.useState(false);
  const Icon = meta.Icon;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border transition-colors hover:bg-accent/40 data-[state=open]:bg-accent/30"
    >
      <div className="flex items-start gap-3 p-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
            meta.badgeClass,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("text-[10px] uppercase tracking-wide", meta.badgeClass)}
            >
              {meta.label}
            </Badge>
            {result.score != null && result.score > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                рел. {result.score}
              </span>
            )}
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-1 flex w-full items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
              aria-label={open ? "Свернуть детали" : "Развернуть детали"}
            >
              <h4 className="text-sm font-semibold leading-tight">
                <Highlight text={result.title} q={q} />
              </h4>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          {result.snippet && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              <Highlight text={result.snippet} q={q} />
            </p>
          )}
          {/* Compact metadata row (always visible) */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {Boolean(result.source === "recommendation" && result.metadata?.gene) && (
              <span className="inline-flex items-center gap-1 font-mono font-medium text-emerald-600">
                <Dna className="h-3 w-3" />
                {String(result.metadata!.gene)}
              </span>
            )}
            {Boolean(result.source === "icd10" && result.metadata?.code) && (
              <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                {String(result.metadata!.code)}
              </span>
            )}
            {Boolean(result.source === "ddi" && result.metadata?.severity) && (
              <Badge variant="outline" className="text-[10px] text-red-700 dark:text-red-400">
                {String(result.metadata!.severity)}
              </Badge>
            )}
            {Boolean(result.source === "pathway" && result.metadata?.category) && (
              <span>{CATEGORY_LABELS[String(result.metadata!.category)] ?? String(result.metadata!.category)}</span>
            )}
          </div>
        </div>
      </div>
      <CollapsibleContent>
        {rows.length > 0 && (
          <div className="border-t px-3 py-2">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{row.label}:</dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function StatCard({ icon: Icon, label, value, accent = "emerald" }: { icon: React.ElementType; label: string; value: number; accent?: "emerald" | "blue" | "purple" | "amber" }) {
  const ACCENT_BG: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
    blue: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/20",
    purple: "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/20",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  };
  const cfg = ACCENT_BG[accent] ?? ACCENT_BG.emerald;
  return (
    <Card className={cn("ring-1 transition-all hover:shadow-md", cfg.split(" ").find((c) => c.startsWith("ring-")))}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", cfg.split(" ").filter((c) => !c.startsWith("ring-")).join(" "))}><Icon className="h-4 w-4" /></div>
        <div><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold tabular-nums">{value}</div></div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// «КР Минздрава» — браузер официального репозитория клинических рекомендаций
// Минздрава РФ (cr.minzdrav.gov.ru). Поиск по названию КР и коду МКБ-10,
// возрастная категория, пагинация, полный текст КР в диалоге.
// ---------------------------------------------------------------------------
const MINZDRAV_PAGE_SIZE = 10;
const MINZDRAV_REPOSITORY_URL = "https://cr.minzdrav.gov.ru/clin-rec";

/** Убирает маркер раздела «【2. Диагностика】» из начала выдержки. */
function cleanClinrecExcerpt(s?: string): string {
  if (!s) return "";
  return s.replace(/^【[^】]*】\s*/, "").trim();
}

function MinzdravClinrecBrowser() {
  // Свободный текст (название КР) — дебаунс 400 мс
  const [crQuery, setCrQuery] = React.useState("");
  const [debouncedCrQuery, setDebouncedCrQuery] = React.useState("");
  // МКБ-10: подсказки из справочника Минздрава + выбранный код-фильтр
  const [mkbInput, setMkbInput] = React.useState("");
  const [debouncedMkbInput, setDebouncedMkbInput] = React.useState("");
  const [mkbSelected, setMkbSelected] = React.useState<string | null>(null);
  const [mkbOpen, setMkbOpen] = React.useState(false);
  // Возрастная категория: "all" | "1" (дети) | "2" (взрослые)
  const [ageFilter, setAgeFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  // Диалог полного текста КР
  const [dialogTarget, setDialogTarget] = React.useState<ClinrecDialogTarget | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedCrQuery(crQuery), 400);
    return () => clearTimeout(t);
  }, [crQuery]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedMkbInput(mkbInput), 300);
    return () => clearTimeout(t);
  }, [mkbInput]);

  // API Минздрава требует хотя бы один фильтр: текст или МКБ-10
  const canSearch = debouncedCrQuery.trim().length > 0 || Boolean(mkbSelected);

  // При смене фильтров возвращаемся на первую страницу
  React.useEffect(() => {
    setPage(1);
  }, [debouncedCrQuery, mkbSelected, ageFilter]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["minzdrav-clinrecs", debouncedCrQuery.trim(), mkbSelected ?? "", ageFilter, page],
    queryFn: () =>
      api.searchMinzdravClinrecs({
        q: debouncedCrQuery.trim() || undefined,
        mkb: mkbSelected ?? undefined,
        age: ageFilter === "all" ? null : Number(ageFilter),
        page,
        pageSize: MINZDRAV_PAGE_SIZE,
        includeContent: true,
      }),
    enabled: canSearch,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Подсказки справочника МКБ-10 (кэшируется на сервере 30 дней)
  const { data: mkbData, isLoading: mkbLoading } = useQuery({
    queryKey: ["minzdrav-mkb-ref", debouncedMkbInput.trim()],
    queryFn: () => api.searchMkbRef(debouncedMkbInput.trim(), 20),
    enabled: mkbOpen && debouncedMkbInput.trim().length >= 2,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / MINZDRAV_PAGE_SIZE));

  // «Искать в Минздраве» — применить текущий текст сразу, не ждя дебаунса
  const runSearch = () => {
    setDebouncedCrQuery(crQuery);
    setPage(1);
    if (!crQuery.trim() && !mkbSelected) {
      toast.info("Введите название КР или выберите код МКБ-10");
    }
  };

  const openClinrec = (m: ClinrecMatch) => {
    setDialogTarget({ codeVersion: m.codeVersion, name: m.name, url: m.url, pdfUrl: m.pdfUrl });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* ── Панель поиска ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Поиск в официальном репозитории КР Минздрава РФ
          </CardTitle>
          <CardDescription className="text-xs">
            Утверждённые клинические рекомендации Минздрава России (cr.minzdrav.gov.ru).
            Поиск по названию КР и коду МКБ-10.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Название КР */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={crQuery}
                onChange={(e) => setCrQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
                placeholder="Название КР, напр. «артериальная гипертензия»…"
                className="pl-9"
                aria-label="Поиск по названию клинической рекомендации"
              />
            </div>

            {/* МКБ-10 — комбобокс со справочником Минздрава */}
            <div className="flex items-center gap-2">
              <Popover
                open={mkbOpen}
                onOpenChange={(open) => {
                  setMkbOpen(open);
                  if (!open) {
                    setMkbInput("");
                    setDebouncedMkbInput("");
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={mkbOpen}
                    className="w-full justify-between font-normal"
                  >
                    {mkbSelected ? (
                      <span className="font-mono font-semibold">{mkbSelected}</span>
                    ) : (
                      <span className="text-muted-foreground">Код МКБ-10…</span>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0 sm:w-[360px]" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      value={mkbInput}
                      onValueChange={setMkbInput}
                      placeholder="Код или название диагноза (напр. E11)…"
                    />
                    <CommandList>
                      {mkbLoading ? (
                        <div className="space-y-2 p-2">
                          {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                          ))}
                        </div>
                      ) : (
                        <>
                          <CommandEmpty>
                            {debouncedMkbInput.trim().length >= 2
                              ? "Ничего не найдено в справочнике МКБ-10"
                              : "Введите минимум 2 символа для поиска"}
                          </CommandEmpty>
                          {(mkbData?.items ?? []).length > 0 && (
                            <CommandGroup heading="Справочник МКБ-10 Минздрава">
                              {(mkbData?.items ?? []).map((item: MkbRefItem) => (
                                <CommandItem
                                  key={item.Id}
                                  value={`${item.Code} ${item.Name}`}
                                  onSelect={() => {
                                    setMkbSelected(item.Code);
                                    setMkbOpen(false);
                                    setMkbInput("");
                                    setDebouncedMkbInput("");
                                  }}
                                  className="gap-2"
                                >
                                  <span className="shrink-0 font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">
                                    {item.Code}
                                  </span>
                                  <span className="truncate text-xs">{item.Name}</span>
                                  {mkbSelected === item.Code && (
                                    <ShieldCheck className="ml-auto h-3.5 w-3.5 text-emerald-600" />
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {mkbSelected && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMkbSelected(null)}
                  aria-label="Сбросить фильтр МКБ-10"
                  className="h-9 w-9 shrink-0 text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Кнопки + счётчик */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={ageFilter} onValueChange={setAgeFilter}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Возрастная категория">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все возрасты</SelectItem>
                  <SelectItem value="2">Взрослые</SelectItem>
                  <SelectItem value="1">Дети</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={runSearch}
                disabled={!crQuery.trim() && !mkbSelected}
                className="gap-2 bg-medical-gradient text-white shadow-lg shadow-emerald-500/20 hover:opacity-90"
              >
                <Search className="h-4 w-4" />
                Искать в Минздраве
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={MINZDRAV_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Открыть репозиторий
                </a>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {canSearch && data && (
                <span>
                  Найдено:{" "}
                  <strong className="tabular-nums text-foreground">{total}</strong> КР
                </span>
              )}
              {data?.fromCache && (
                <span
                  className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                  title="Данные получены из локального кэша (репозиторий Минздрава недоступен)"
                >
                  <Database className="h-3 w-3" />
                  Из локального кэша (офлайн)
                </span>
              )}
            </div>
          </div>

          {/* ── Результаты ────────────────────────────────────────────── */}
          {!canSearch ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Landmark className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">Поиск по официальному репозиторию Минздрава РФ</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Введите название клинической рекомендации (напр. «сахарный диабет»,
                «гипертензия») или выберите код МКБ-10 (напр. E11) — признаки и
                лечение подберутся по официальным КР Минздрава России.
              </p>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <p className="max-w-md text-sm text-muted-foreground">
                Ошибка обращения к репозиторию Минздрава:{" "}
                {(error as Error | null)?.message ?? "неизвестная ошибка"}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5" />
                Повторить
              </Button>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Search className="h-10 w-10 text-muted-foreground/40" />
              <p className="max-w-md text-sm text-muted-foreground">
                В официальном репозитории не найдено КР — измените запрос
                (поиск выполняется по названию рекомендации).
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1 -mr-1">
                {results.map((cr) => (
                  <MinzdravClinrecCard key={cr.codeVersion} clinrec={cr} onOpen={() => openClinrec(cr)} />
                ))}
              </div>
              {total > MINZDRAV_PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">
                    Страница <strong className="tabular-nums text-foreground">{page}</strong> из{" "}
                    <strong className="tabular-nums text-foreground">{totalPages}</strong>
                    {" "}· всего {total} КР
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || isFetching}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Предыдущая
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || isFetching}
                      onClick={() => setPage((p) => p + 1)}
                      className="gap-1"
                    >
                      Следующая
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Диалог полного текста КР */}
      <MinzdravClinrecDialog
        clinrec={dialogTarget}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MinzdravClinrecCard — карточка одной КР в результатах поиска.
// ---------------------------------------------------------------------------
function MinzdravClinrecCard({
  clinrec,
  onOpen,
}: {
  clinrec: ClinrecMatch;
  onOpen: () => void;
}) {
  const [diagOpen, setDiagOpen] = React.useState(false);
  const [therapyOpen, setTherapyOpen] = React.useState(false);

  const publishStr = formatClinrecDate(clinrec.publishDate);
  const diagExcerpt = cleanClinrecExcerpt(clinrec.diagnosticsExcerpt);
  const therapyExcerpt = cleanClinrecExcerpt(clinrec.therapyExcerpt);
  const mkbShown = clinrec.mkbCodes.slice(0, 6);
  const mkbHidden = clinrec.mkbCodes.length - mkbShown.length;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        {/* Название + код версии */}
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm leading-snug font-semibold sm:text-base">{clinrec.name}</h4>
          <Badge variant="secondary" className="shrink-0 font-mono text-xs">
            {clinrec.codeVersion}
          </Badge>
        </div>

        {/* Бейджи: НПС, возрастная категория, дата публикации */}
        <div className="flex flex-wrap items-center gap-1.5">
          {clinrec.npcApproved && (
            <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              Одобрена НПС Минздрава
            </Badge>
          )}
          {clinrec.ageCategory && (
            <Badge variant="outline" className="text-xs">{clinrec.ageCategory}</Badge>
          )}
          {publishStr && (
            <Badge variant="outline" className="text-xs">{publishStr}</Badge>
          )}
        </div>

        {/* Коды МКБ-10 */}
        {mkbShown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">МКБ-10:</span>
            {mkbShown.map((code) => (
              <Badge key={code} variant="outline" className="font-mono text-[10px]">{code}</Badge>
            ))}
            {mkbHidden > 0 && (
              <span className="text-xs text-muted-foreground">+{mkbHidden}</span>
            )}
          </div>
        )}

        {/* НКО-разработчики */}
        {clinrec.developers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            НКО-разработчик: {clinrec.developers.join(", ")}
          </p>
        )}

        {/* Превью разделов «Диагностика» / «Лечение» */}
        {(diagExcerpt || therapyExcerpt) && (
          <div className="space-y-1.5">
            {diagExcerpt && (
              <Collapsible open={diagOpen} onOpenChange={setDiagOpen}>
                <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", diagOpen && "rotate-180")}
                  />
                  Диагностика (КР)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-1 line-clamp-3 rounded-md border bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground">
                    {diagExcerpt}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}
            {therapyExcerpt && (
              <Collapsible open={therapyOpen} onOpenChange={setTherapyOpen}>
                <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", therapyOpen && "rotate-180")}
                  />
                  Лечение (КР)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-1 line-clamp-3 rounded-md border bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground">
                    {therapyExcerpt}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {/* Действия */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            size="sm"
            onClick={onOpen}
            className="gap-1.5 bg-medical-gradient text-white shadow-sm hover:opacity-90"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Открыть
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={clinrec.pdfUrl} target="_blank" rel="noopener noreferrer">
              <FileText className="h-3.5 w-3.5" />
              PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
            <a href={clinrec.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              На сайте Минздрава
            </a>
          </Button>
          {clinrec.sectionsCount != null && (
            <span className="ml-auto text-xs text-muted-foreground">
              Разделов: {clinrec.sectionsCount}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
