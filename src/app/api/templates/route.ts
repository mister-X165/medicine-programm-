// СППВР v2.0 — Report Templates API
// GET  /api/templates — List templates
// POST /api/templates — Create template

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") || undefined;

    const where: Record<string, unknown> = { isActive: true };
    if (category) where.category = category;

    const templates = await db.reportTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const result = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      sections: JSON.parse(t.sections),
      watermark: t.watermark,
      isActive: t.isActive,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));

    return NextResponse.json({ templates: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: creating report templates is admin-only.
    await requireAdmin(req);
    const body = await req.json();
    const { name, description, category, sections, watermark } = body as {
      name: string;
      description: string;
      category: string;
      sections: unknown[];
      watermark?: string;
    };

    if (!name || !category || !Array.isArray(sections)) {
      return NextResponse.json({ error: "Required fields: name, category, sections" }, { status: 400 });
    }

    const template = await db.reportTemplate.create({
      data: {
        name,
        description: description || "",
        category,
        sections: JSON.stringify(sections),
        watermark: watermark || "СППВР | CONFIDENTIAL",
      },
    });

    return NextResponse.json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        sections: JSON.parse(template.sections),
        watermark: template.watermark,
        isActive: template.isActive,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error.message === "Authentication required" || error.message === "Admin access required")) {
      const status = error.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
