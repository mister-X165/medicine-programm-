// СППВР v2.0 — Case Reports API
// GET  /api/cases/[id]/reports — List reports for case
// POST /api/cases/[id]/reports — Generate new report

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateMedicalReportPDF } from "@/lib/pdf-generator";
import { logger } from "@/lib/logger";
import { safeJsonParse, parseStructured } from "@/lib/utils";
import { appendAudit } from "@/lib/audit";
import { requireCaseAccess } from "@/lib/case-access";
import type { AnalysisResultData } from "@/lib/types";

export const dynamic = "force-dynamic";

// v2.7.2 (audit fix): сигнатура приведена к реальной модели AnalysisResult —
// поле aiAvailable в модели отсутствует; sections/therapyRecommendations
// теперь реально парсятся (раньше всегда передавались пустыми, PDF терял
// разделы и терапевтические рекомендации); version берётся из записи.
function deserializeAnalysis(a: {
  id: string;
  caseId: string;
  entities: string;
  mutations: string;
  recommendations: string;
  conclusion: string;
  sections: string;
  confidence: string;
  citations: string;
  imageFindings: string;
  controlWeights: string;
  doctorComments: string;
  therapyRecommendations: string;
  ddiAlerts: string;
  icd10Suggestions: string;
  pathwayMatches: string;
  structured?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): AnalysisResultData {
  return {
    id: a.id,
    caseId: a.caseId,
    entities: safeJsonParse(a.entities, []),
    mutations: safeJsonParse(a.mutations, []),
    recommendations: safeJsonParse(a.recommendations, []),
    conclusion: a.conclusion || "",
    sections: safeJsonParse(a.sections, []),
    confidence: safeJsonParse(a.confidence, {}),
    citations: safeJsonParse(a.citations, []),
    imageFindings: safeJsonParse(a.imageFindings, []),
    controlWeights: safeJsonParse(a.controlWeights, {}),
    doctorComments: safeJsonParse(a.doctorComments, []),
    therapyRecommendations: safeJsonParse(a.therapyRecommendations, []),
    ddiAlerts: safeJsonParse(a.ddiAlerts, []),
    icd10Suggestions: safeJsonParse(a.icd10Suggestions, []),
    pathwayMatches: safeJsonParse(a.pathwayMatches, []),
    // v5.0: структурированные клинические данные
    structured: parseStructured(a.structured),
    version: a.version ?? 1,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Verify the requesting session can see this case.
    const access = await requireCaseAccess(id, req);
    if (!access.ok) return access.response;

    const reports = await db.report.findMany({
      where: { caseId: id },
      orderBy: { createdAt: "desc" },
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
      },
    });

    const list = reports.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      title: r.title,
      status: r.status,
      pdfPath: r.pdfPath,
      watermark: r.watermark,
      templateId: r.templateId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ reports: list });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "reports GET error", { caseId: id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  try {
    // SECURITY (v2.1.4): enforce case ownership before generating a report —
    // previously any logged-in doctor could trigger PDF generation for ANY
    // case (consuming AI + storage resources and reading the case's analysis).
    const access = await requireCaseAccess(caseId, req);
    if (!access.ok) return access.response;
    const { session } = access;

    const found = await db.case.findUnique({
      where: { id: caseId },
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
        analysis: true,
        documents: { select: { id: true, fileName: true, fileType: true }, orderBy: { createdAt: "asc" } },
      },
    });

    if (!found) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (!found.analysis) {
      return NextResponse.json({ error: "Analysis not performed. Run analysis first." }, { status: 400 });
    }

    let title: string | undefined;
    let templateId: string | undefined;
    try {
      const body = await req.json();
      title = typeof body?.title === "string" ? body.title : undefined;
      templateId = typeof body?.templateId === "string" ? body.templateId : undefined;
    } catch { /* body may be empty */ }

    const reportTitle = title || `Report for case ${found.caseCode}`;

    const analysis = deserializeAnalysis(found.analysis);

    // Generate PDF
    let pdfResult;
    try {
      pdfResult = await generateMedicalReportPDF({
        caseCode: found.caseCode,
        doctor: {
          fullName: found.doctor.fullName,
          specialization: found.doctor.specialization,
          doctorCode: found.doctor.doctorCode,
        },
        analysis,
        watermark: "СППВР | CONFIDENTIAL",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("pdf", "PDF generation error", { caseCode: found.caseCode, error: msg });
      return NextResponse.json({ error: `PDF generation error: ${msg}` }, { status: 500 });
    }

    const content = buildMarkdownContent(found.caseCode, analysis);

    const report = await db.report.create({
      data: {
        caseId,
        doctorId: session.doctorId,
        title: reportTitle,
        content,
        pdfPath: pdfResult.publicUrl,
        status: "draft",
        watermark: "СППВР | CONFIDENTIAL",
        templateId: templateId || null,
      },
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true, doctorCode: true } },
      },
    });

    logger.info("pdf", "PDF report generated", { caseCode: found.caseCode, reportId: report.id });
    // Audit — attribute to the ACTING doctor (session.doctorId), not the case
    // owner. Previously this used `found.doctorId`, which meant a doctor who
    // generated a report for a shared case would log the action under the
    // owner's name — audit forgery.
    await appendAudit({
      caseId,
      doctorId: session.doctorId,
      action: "generate_report",
      details: JSON.stringify({ reportId: report.id, pdfPath: pdfResult.publicUrl, title: reportTitle }),
    }).catch(() => {});

    if (found.status !== "reported") {
      await db.case.update({ where: { id: caseId }, data: { status: "reported" } });
    }

    return NextResponse.json({
      report: {
        id: report.id,
        caseId: report.caseId,
        title: report.title,
        content: report.content,
        pdfPath: report.pdfPath,
        status: report.status,
        watermark: report.watermark,
        templateId: report.templateId,
        createdAt: report.createdAt.toISOString(),
        updatedAt: report.updatedAt.toISOString(),
      },
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "reports POST error", { caseId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildMarkdownContent(caseCode: string, analysis: AnalysisResultData): string {
  const lines: string[] = [];
  lines.push(`# Medical Report СППВР`);
  lines.push(`**Case Code:** ${caseCode}`);
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. Clinical Picture");
  lines.push(analysis.conclusion || "_Conclusion not formed._");
  lines.push("");
  lines.push("## 2. Genetic Profile");
  if (analysis.mutations.length > 0) {
    lines.push("| Gene | Variant | Interpretation | Significance |");
    lines.push("| --- | --- | --- | --- |");
    for (const m of analysis.mutations.slice(0, 50)) {
      lines.push(`| ${m.gene} | ${m.variant} | ${m.interpretation} | ${m.clinicalSignificance} |`);
    }
  } else {
    lines.push("_No mutations identified._");
  }
  lines.push("");
  lines.push("## 3. Clinical Recommendations");
  if (analysis.recommendations.length > 0) {
    for (const r of analysis.recommendations.slice(0, 20)) {
      lines.push(`- **${r.title}** (${r.source}, evidence: ${r.evidenceLevel ?? "—"})`);
    }
  } else {
    lines.push("_No recommendations._");
  }
  lines.push("");
  lines.push("## 4. Confidence");
  const conf = analysis.confidence || {};
  for (const k of Object.keys(conf)) {
    lines.push(`- ${k}: ${Math.round((conf[k] ?? 0) * 100)}%`);
  }
  lines.push("");
  lines.push("---");
  lines.push("Document generated by СППВР. Requires doctor approval.");
  return lines.join("\n");
}
