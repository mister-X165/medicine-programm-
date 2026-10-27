"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sliders,
  MessageSquarePlus,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AnalysisResultData } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

interface Props {
  caseId: string;
  analysis: AnalysisResultData;
}

const DEFAULT_WEIGHTS: Record<string, { label: string; default: number }> = {
  genetic: { label: "Генетический профиль", default: 0.8 },
  clinical: { label: "Клиническая картина", default: 0.7 },
  imaging: { label: "Данные изображений", default: 0.6 },
  guidelines: { label: "Клинические рекомендации", default: 0.75 },
};

export function ControlPanel({ caseId, analysis }: Props) {
  const qc = useQueryClient();
  const [weights, setWeights] = React.useState<Record<string, number>>(
    () => ({
      genetic: DEFAULT_WEIGHTS.genetic.default,
      clinical: DEFAULT_WEIGHTS.clinical.default,
      imaging: DEFAULT_WEIGHTS.imaging.default,
      guidelines: DEFAULT_WEIGHTS.guidelines.default,
      ...(analysis.controlWeights ?? {}),
    }),
  );
  const [comment, setComment] = React.useState("");
  const [comments, setComments] = React.useState(analysis.doctorComments ?? []);

  React.useEffect(() => {
    setWeights((w) => ({ ...w, ...(analysis.controlWeights ?? {}) }));
    setComments(analysis.doctorComments ?? []);
  }, [analysis]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.updateControl(caseId, { controlWeights: weights, doctorComments: comments }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
      toast.success("Веса и комментарии сохранены");
    },
    onError: (e: Error) => toast.error("Ошибка: " + e.message),
  });

  const handleAddComment = () => {
    if (!comment.trim()) return;
    const newComment = { id: `c-${Date.now()}`, author: "Врач", text: comment.trim(), ts: new Date().toISOString() };
    setComments((c) => [...c, newComment]);
    setComment("");
  };

  const handleDeleteComment = (id: string) => {
    setComments((c) => c.filter((x) => (x.id ?? x.ts) !== id));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="h-4 w-4 text-primary" />
            Веса факторов
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Корректируйте влияние источников данных на итоговое заключение. Изменения сохраняются в протоколе.
          </p>
          {Object.entries(DEFAULT_WEIGHTS).map(([key, cfg]) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">{cfg.label}</Label>
                <span className="text-sm font-medium tabular-nums">{Math.round((weights[key] ?? cfg.default) * 100)}%</span>
              </div>
              <Slider
                value={[(weights[key] ?? cfg.default) * 100]}
                onValueChange={(v) => setWeights((w) => ({ ...w, [key]: v[0] / 100 }))}
                max={100}
                step={5}
                className="py-1"
              />
            </div>
          ))}
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="w-full gap-2">
            <Save className="h-4 w-4" />
            {saveMut.isPending ? "Сохранение…" : "Сохранить веса"}
          </Button>
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            Комментарии врача
            <span className="ml-auto text-xs font-normal text-muted-foreground">{comments.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <div className="mb-3 flex gap-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Добавьте клинический комментарий…"
              rows={2}
              className="resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAddComment(); }}
            />
            <Button onClick={handleAddComment} disabled={!comment.trim()} size="icon" className="shrink-0">
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto pr-1 -mr-1" style={{ maxHeight: 300 }}>
            <div className="space-y-2">
              {comments.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Пока нет комментариев</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id ?? c.ts} className="group rounded-lg border p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <User className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-medium">{c.author}</span>
                      <span className="text-xs text-muted-foreground">{new Date(c.ts).toLocaleString("ru-RU")}</span>
                      <button onClick={() => handleDeleteComment(c.id ?? c.ts)} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-sm">{c.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} variant="outline" className="mt-3 gap-2">
            <Save className="h-4 w-4" />
            Сохранить комментарии
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
