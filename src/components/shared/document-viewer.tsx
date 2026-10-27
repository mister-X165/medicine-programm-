"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  FileText,
  Dna,
  Image as ImageIcon,
  Eye,
  EyeOff,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DocumentRecord, FileType } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileTypeBadge } from "./upload-zone";

const FILE_ICONS: Record<FileType, React.ElementType> = {
  discharge: FileText,
  genetic: Dna,
  image: ImageIcon,
};

interface Props {
  caseId: string;
  documents: DocumentRecord[];
}

export function DocumentViewer({ caseId, documents }: Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(documents[0]?.id ?? null);
  const [showRaw, setShowRaw] = React.useState(false);

  React.useEffect(() => {
    if (!selectedId && documents.length > 0) {
      setSelectedId(documents[0].id);
    }
  }, [documents, selectedId]);

  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (docId: string) => api.deleteDocument(caseId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success("Документ удалён");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  if (documents.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="mb-3 h-12 w-12 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Документы не загружены</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Загрузите выписки, генетические отчёты или снимки для анализа
        </p>
      </Card>
    );
  }

  const selected = documents.find((d) => d.id === selectedId) ?? documents[0];
  const meta = parseMeta(selected.extractedMeta);

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Card className="p-2">
        <div className="h-[60vh] overflow-y-auto pr-1 -mr-1">
          <div className="space-y-1">
            {documents.map((doc) => {
              const Icon = FILE_ICONS[doc.fileType];
              const active = doc.id === selectedId;
              return (
                <button
                  key={doc.id}
                  onClick={() => setSelectedId(doc.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors",
                    active ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      doc.fileType === "discharge" && "text-blue-600",
                      doc.fileType === "genetic" && "text-emerald-600",
                      doc.fileType === "image" && "text-purple-600",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{doc.fileName}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{new Date(doc.createdAt).toLocaleDateString("ru-RU")}</span>
                      {Array.isArray(meta?.deidSummary) && meta.deidSummary.length > 0 && (
                        <span className="flex items-center gap-0.5 text-emerald-600">
                          <ShieldCheck className="h-3 w-3" />
                          де-идент.
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{selected.fileName}</span>
              <FileTypeBadge type={selected.fileType} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {new Date(selected.createdAt).toLocaleString("ru-RU")}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {selected.fileType !== "image" && (
              <Button variant="ghost" size="sm" onClick={() => setShowRaw((s) => !s)} className="gap-1.5">
                {showRaw ? <><EyeOff className="h-4 w-4" /> Скрыть оригинал</> : <><Eye className="h-4 w-4" /> Оригинал</>}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => deleteMut.mutate(selected.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {selected.fileType === "image" ? (
            <ImagePreview doc={selected} />
          ) : showRaw ? (
            <RawPreview content={selected.rawContent} />
          ) : (
            <DeidPreview content={selected.deidContent} meta={meta} fileType={selected.fileType} />
          )}
        </div>
      </Card>
    </div>
  );
}

function ImagePreview({ doc }: { doc: DocumentRecord }) {
  // SECURITY (v2.1): images are no longer served from /public/uploads.
  // We fetch them through the auth-checked /api/cases/.../documents/[docId]
  // endpoint using the JWT, then render via an object URL.
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    async function load() {
      try {
        // v2.6.2: cookie-only аутентификация — Bearer-инъекция удалена
        const res = await fetch(
          `/api/cases/${doc.caseId}/documents/${doc.id}?preview=1`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const objUrl = URL.createObjectURL(blob);
        revoked = objUrl;
        setUrl(objUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc.caseId, doc.id]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Изображение недоступно (нет доступа или файл не найден)
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Загрузка изображения…
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-muted/30 p-4">
      <img src={url} alt={doc.fileName} className="max-h-[55vh] max-w-full rounded-lg object-contain shadow-sm" />
    </div>
  );
}

function RawPreview({ content }: { content: string }) {
  return (
    <div className="h-[55vh] overflow-y-auto pr-1 -mr-1">
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-foreground">
        {content || "[пусто]"}
      </pre>
    </div>
  );
}

function DeidPreview({ content, meta, fileType }: { content: string; meta: Record<string, unknown> | null; fileType: FileType }) {
  return (
    <div className="h-[55vh] overflow-y-auto pr-1 -mr-1">
      <div className="p-4">
        {Array.isArray(meta?.deidSummary) && meta.deidSummary.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5 rounded-lg bg-emerald-500/10 p-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Де-идентифицировано:</span>
            {(meta.deidSummary as Array<{ type: string; count: number }>).map((r, i) => (
              <Badge key={i} variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                {r.type}: {r.count}
              </Badge>
            ))}
          </div>
        )}

        {fileType === "genetic" && meta?.variantCount !== undefined && (
          <div className="mb-3 rounded-lg bg-emerald-500/5 p-2.5 text-xs">
            <span className="font-medium">Распознано вариантов: </span>
            <span className="text-emerald-600">{String(meta.variantCount)}</span>
          </div>
        )}

        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {highlightTokens(content || "[пусто]")}
        </div>
      </div>
    </div>
  );
}

function highlightTokens(text: string) {
  const parts = text.split(/(\[[А-ЯЁ_]+\])/g);
  return parts.map((part, i) => {
    if (/^\[[А-ЯЁ_]+\]$/.test(part)) {
      return (
        <mark key={i} className="rounded bg-primary/20 px-1 text-primary-foreground font-medium">
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function parseMeta(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
