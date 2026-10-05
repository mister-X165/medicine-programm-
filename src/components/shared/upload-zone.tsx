"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UploadCloud,
  FileText,
  Dna,
  Image as ImageIcon,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FileType } from "@/lib/types";

interface UploadZoneProps {
  caseId: string;
}

const ACCEPT = ".pdf,.docx,.txt,.vcf,.csv,.tsv,.jpg,.jpeg,.png,.dcm";

const FILE_TYPE_CONFIG: Record<FileType, { icon: React.ElementType; label: string; color: string }> = {
  discharge: { icon: FileText, label: "Выписка", color: "text-blue-600" },
  genetic: { icon: Dna, label: "Генетика", color: "text-emerald-600" },
  image: { icon: ImageIcon, label: "Снимок", color: "text-purple-600" },
};

export function UploadZone({ caseId }: UploadZoneProps) {
  const [dragActive, setDragActive] = React.useState(false);
  const [uploads, setUploads] = React.useState<
    Array<{ name: string; size: number; progress: number; status: "uploading" | "done" | "error" }>
  >([]);
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const uploadMut = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      return api.uploadDocument(caseId, file);
    },
    onMutate: ({ file }) => {
      setUploads((u) => [...u, { name: file.name, size: file.size, progress: 0, status: "uploading" }]);
    },
    onSuccess: (_data, vars) => {
      setUploads((u) => u.map((x) => x.name === vars.file.name ? { ...x, progress: 100, status: "done" } : x));
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success(`Загружено: ${vars.file.name}`);
      setTimeout(() => { setUploads((u) => u.filter((x) => x.name !== vars.file.name)); }, 3000);
    },
    onError: (e: Error, vars) => {
      setUploads((u) => u.map((x) => x.name === vars.file.name ? { ...x, status: "error" as const } : x));
      toast.error(`Ошибка загрузки ${vars.file.name}: ${e.message}`);
      setTimeout(() => { setUploads((u) => u.filter((x) => x.name !== vars.file.name)); }, 5000);
    },
  });

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => { uploadMut.mutate({ file }); });
    },
    [uploadMut],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-accent/30",
        )}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className={cn("mb-3 flex h-14 w-14 items-center justify-center rounded-full transition-colors", dragActive ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
          <UploadCloud className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium">Перетащите файлы сюда или нажмите для выбора</p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF/DOCX — выписки · VCF/CSV — генетика · JPEG/PNG/DICOM — снимки
        </p>
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u, i) => (
            <Card key={i} className="p-3">
              <div className="flex items-center gap-2">
                <Loader2
                  className={cn(
                    "h-4 w-4 shrink-0",
                    u.status === "uploading" && "animate-spin text-primary",
                    u.status === "done" && "text-emerald-600",
                    u.status === "error" && "text-destructive",
                  )}
                />
                <span className="flex-1 truncate text-sm">{u.name}</span>
                <span className="text-xs text-muted-foreground">{(u.size / 1024).toFixed(0)} КБ</span>
                {u.status === "uploading" && <span className="text-xs text-muted-foreground">{u.progress}%</span>}
              </div>
              {u.status === "uploading" && <Progress value={u.progress} className="mt-2 h-1" />}
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">Де-идентификация на лету:</span>{" "}
          ФИО, СНИЛС, адреса и другие персональные данные автоматически
          заменяются токенами (напр. [ПАЦИЕНТ]) перед сохранением и передачей в
          ИИ-модель.
        </div>
      </div>
    </div>
  );
}

export function FileTypeBadge({ type }: { type: FileType }) {
  const cfg = FILE_TYPE_CONFIG[type];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}
