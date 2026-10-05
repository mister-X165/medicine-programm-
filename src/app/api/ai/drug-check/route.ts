// СППВР v4.0 — Drug Interaction Check API (LM Studio)
import { NextResponse } from "next/server";
import { llmChat, parseJSON } from "@/lib/ai-service";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  let body: { medications: string[]; patientConditions?: string[] };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }

  if (!body.medications?.length || body.medications.length < 2) {
    return NextResponse.json({ error: "Минимум 2 препарата" }, { status: 400 });
  }

  const sys = `Ты — клинический фармаколог. Проверь лекарственные взаимодействия. Верни JSON:
{"interactions":[{"drugA":"препарат1","drugB":"препарат2","severity":"minor|moderate|severe|contraindicated","mechanism":"механизм","recommendation":"рекомендация"}],"contraindications":[{"drug":"препарат","condition":"состояние","recommendation":"рек"}],"summary":"общее заключение"}
Только валидный JSON.`;

  const user = `Препараты: ${body.medications.join(", ")}${body.patientConditions?.length ? `\nСостояния: ${body.patientConditions.join(", ")}` : ""}`;

  const raw = await llmChat(sys, user, { json: true, temperature: 0.2, maxTokens: 2048 });
  if (!raw) return NextResponse.json({ error: "ИИ недоступен" }, { status: 503 });

  const parsed = parseJSON<{ interactions?: Array<{ drugA: string; drugB: string; severity: string; mechanism: string; recommendation: string }>; contraindications?: Array<{ drug: string; condition: string; recommendation: string }>; summary?: string }>(raw);
  if (!parsed) return NextResponse.json({ summary: raw, interactions: [], contraindications: [] });

  return NextResponse.json({
    interactions: (parsed.interactions ?? []).map(i => ({ drugA: i.drugA?.slice(0, 100) || "—", drugB: i.drugB?.slice(0, 100) || "—", severity: ["minor","moderate","severe","contraindicated"].includes(i.severity) ? i.severity : "moderate", mechanism: i.mechanism?.slice(0, 300) || "", recommendation: i.recommendation?.slice(0, 300) || "" })),
    contraindications: (parsed.contraindications ?? []).map(c => ({ drug: c.drug?.slice(0, 100) || "—", condition: c.condition?.slice(0, 100) || "—", recommendation: c.recommendation?.slice(0, 300) || "" })),
    summary: parsed.summary || "",
  });
}
