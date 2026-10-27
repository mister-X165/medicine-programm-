// СППВР v2.0 — Seed Report Templates API
// POST /api/seed-templates

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_TEMPLATES: Array<{
  name: string;
  description: string;
  category: string;
  sections: Array<{ id: string; title: string; type: "text" | "table" | "chart" | "signature"; required: boolean }>;
  watermark: string;
}> = [
  {
    name: "Oncological Protocol",
    description: "Template for oncological protocol with genetic profile and therapy recommendations",
    category: "oncology",
    sections: [
      { id: "s1", title: "Clinical Picture", type: "text", required: true },
      { id: "s2", title: "Genetic Profile", type: "text", required: true },
      { id: "s3", title: "Recommended Therapy", type: "text", required: true },
      { id: "s4", title: "Alternative Regimens", type: "text", required: false },
      { id: "s5", title: "Contraindications", type: "text", required: true },
      { id: "s6", title: "Monitoring", type: "text", required: true },
    ],
    watermark: "СППВР | ONCOLOGY | CONFIDENTIAL",
  },
  {
    name: "Pharmacogenetic Report",
    description: "Pharmacogenetic report template with metabolizer status and dosing recommendations",
    category: "pharmacogenomics",
    sections: [
      { id: "s1", title: "Pharmacogenetic Profile", type: "text", required: true },
      { id: "s2", title: "Metabolizer Status", type: "text", required: true },
      { id: "s3", title: "Dosing Recommendations", type: "text", required: true },
      { id: "s4", title: "Drug Interactions", type: "text", required: true },
      { id: "s5", title: "Warnings", type: "text", required: true },
    ],
    watermark: "СППВР | PHARMACOGENOMICS | CONFIDENTIAL",
  },
  {
    name: "Genetic Counseling Protocol",
    description: "Genetic counseling protocol with risk assessment for relatives",
    category: "genetic_counseling",
    sections: [
      { id: "s1", title: "Reason for Referral", type: "text", required: true },
      { id: "s2", title: "Genetic Profile", type: "text", required: true },
      { id: "s3", title: "Variant Classification", type: "text", required: true },
      { id: "s4", title: "Recommendations", type: "text", required: true },
      { id: "s5", title: "Genetic Risk for Relatives", type: "text", required: true },
    ],
    watermark: "СППВР | GENETIC COUNSELING | CONFIDENTIAL",
  },
  {
    name: "General Medical Report",
    description: "Universal medical report template with clinical recommendations and sources",
    category: "general",
    sections: [
      { id: "s1", title: "Clinical Picture", type: "text", required: true },
      { id: "s2", title: "Genetic Profile", type: "text", required: true },
      { id: "s3", title: "Clinical Recommendations", type: "text", required: true },
      { id: "s4", title: "Warnings", type: "text", required: true },
      { id: "s5", title: "Confidence", type: "text", required: false },
      { id: "s6", title: "Source Citations", type: "text", required: false },
    ],
    watermark: "СППВР | CONFIDENTIAL",
  },
];

export async function POST(req: Request) {
  try {
    // v4.3 audit fix: seeding templates mutates report templates — admin only.
    await requireAdmin(req);
    let created = 0;
    let skipped = 0;

  for (const tpl of DEFAULT_TEMPLATES) {
    const existing = await db.reportTemplate.findFirst({
      where: { name: tpl.name, isActive: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await db.reportTemplate.create({
      data: {
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        sections: JSON.stringify(tpl.sections),
        watermark: tpl.watermark,
      },
    });
    created++;
  }

  return NextResponse.json({ success: true, created, skipped, total: DEFAULT_TEMPLATES.length });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
