// СППВР v2.0 — Template by ID API
// GET    /api/templates/[id] — Get template
// PATCH  /api/templates/[id] — Update template
// DELETE /api/templates/[id] — Soft delete (isActive=false)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

function formatTemplate(t: { id: string; name: string; description: string; category: string; sections: string; watermark: string | null; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    sections: JSON.parse(t.sections),
    watermark: t.watermark,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = await db.reportTemplate.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json({ template: formatTemplate(template) });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // v4.3 audit fix: editing report templates is admin-only.
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const body = await req.json();
  const allowed = ["name", "description", "category", "sections", "watermark", "isActive"];
  const data: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) {
      if (k === "sections" && Array.isArray(body[k])) {
        data[k] = JSON.stringify(body[k]);
      } else {
        data[k] = body[k];
      }
    }
  }

  try {
    const updated = await db.reportTemplate.update({
      where: { id },
      data,
    });
    return NextResponse.json({ template: formatTemplate(updated) });
  } catch {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // v4.3 audit fix: deleting report templates is admin-only.
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  try {
    const updated = await db.reportTemplate.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ success: true, template: formatTemplate(updated) });
  } catch {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
}
