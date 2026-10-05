// СППВР v4.0 — Lab Interpretation API (LM Studio)
import { NextResponse } from "next/server";
import { llmChat, parseJSON } from "@/lib/ai-service";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  let body: { testResults: Array<{ name: string; value: number; unit: string; refLow?: number; refHigh?: number }>; patientAge?: number; patientSex?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }

  if (!body.testResults?.length) return NextResponse.json({ error: "Анализы обязательны" }, { status: 400 });

  const sys = `Ты — врач-лаборатор. Интерпретируй анализы. Верни JSON:
{"summary":"общее заключение","abnormalities":[{"test":"название","interpretation":"описание","severity":"normal|mild|moderate|severe"}],"recommendations":["рек1","рек2"]}
Только валидный JSON.`;

  const rows = body.testResults.map(t => {
    let flag = "норма";
    if (t.refLow != null && t.refHigh != null) {
      if (t.value < t.refLow) flag = "↓ снижен";
      else if (t.value > t.refHigh) flag = "↑ повышен";
    }
    return `${t.name}: ${t.value} ${t.unit} (норма: ${t.refLow ?? "—"}-${t.refHigh ?? "—"}) ${flag}`;
  }).join("\n");

  const user = `Анализы:\n${rows}${body.patientAge ? `\nВозраст: ${body.patientAge}` : ""}${body.patientSex ? `\nПол: ${body.patientSex}` : ""}`;

  const raw = await llmChat(sys, user, { json: true, temperature: 0.2, maxTokens: 2048 });
  if (!raw) return NextResponse.json({ error: "ИИ недоступен" }, { status: 503 });

  const parsed = parseJSON<{ summary?: string; abnormalities?: Array<{ test: string; interpretation: string; severity: string }>; recommendations?: string[] }>(raw);
  if (!parsed) return NextResponse.json({ summary: raw, abnormalities: [], recommendations: [] });

  return NextResponse.json({
    summary: parsed.summary || "",
    abnormalities: (parsed.abnormalities ?? []).map(a => ({ test: a.test?.slice(0, 100) || "—", interpretation: a.interpretation?.slice(0, 300) || "", severity: ["normal","mild","moderate","severe"].includes(a.severity) ? a.severity : "moderate" })),
    recommendations: (parsed.recommendations ?? []).slice(0, 10),
  });
}
