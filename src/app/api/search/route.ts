// СППВР v2.0 — Advanced Case Search API
// GET /api/search?q=...&gene=...&category=...&status=...&dateFrom=...&dateTo=...
//
// SECURITY (v4.3 audit fix): previously this route had NO authentication and
// NO ownership scoping — any anonymous caller (the edge proxy comment lied
// about scoping) received EVERY case in the database including other
// doctors' PHI (diagnosisHint, notes, matchedGenes, matchedMutations).
// Now: requires a valid session; non-admins are force-scoped to cases they
// own OR cases actively shared with them. The `doctorId` query param is
// honored only for admins.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";
import { getSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() || "";
    const gene = searchParams.get("gene")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "";
    const dateFrom = searchParams.get("dateFrom")?.trim() || "";
    const dateTo = searchParams.get("dateTo")?.trim() || "";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
      };
    }

    // AUTHORIZATION (v4.3): force-scope to the caller's cases.
    //   - admin: may optionally filter by ?doctorId= (no implicit scope)
    //   - non-admin: ONLY own cases + actively shared cases; any ?doctorId=
    //     from the query is IGNORED for non-admins (cannot be used to read
    //     another doctor's caseload).
    if (session.role === "admin") {
      const doctorId = searchParams.get("doctorId")?.trim() || "";
      if (doctorId) where.doctorId = doctorId;
    } else {
      where.OR = [
        { doctorId: session.doctorId },
        { shares: { some: { toDoctorId: session.doctorId, status: "active" } } },
      ];
    }

    if (q) {
      // Merge with any existing OR (ownership) — wrap in AND.
      const existingOR = where.OR;
      delete where.OR;
      const textMatch = {
        OR: [
          { caseCode: { contains: q } },
          { diagnosisHint: { contains: q } },
          { notes: { contains: q } },
        ],
      };
      where.AND = existingOR ? [existingOR, textMatch] : [textMatch];
    }

    const cases = await db.case.findMany({
      where,
      include: {
        doctor: { select: { id: true, fullName: true } },
        analysis: { select: { mutations: true, conclusion: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const results: Array<Record<string, unknown>> = [];

    for (const c of cases) {
      const mutations = c.analysis
        ? safeJsonParse<Array<{ gene: string; variant: string; clinicalSignificance: string }>>(c.analysis.mutations, [])
        : [];

      let matchedGenes: string[] = [];
      let matchedMutations: string[] = [];

      if (gene) {
        const geneLower = gene.toLowerCase();
        const matching = mutations.filter((m) => m.gene && m.gene.toLowerCase().includes(geneLower));
        if (matching.length === 0) continue;
        matchedGenes = [...new Set(matching.map((m) => m.gene))];
        matchedMutations = matching.map((m) => `${m.gene} ${m.variant} (${m.clinicalSignificance})`);
      } else if (mutations.length > 0) {
        matchedGenes = [...new Set(mutations.map((m) => m.gene))];
        matchedMutations = mutations.slice(0, 5).map((m) => `${m.gene} ${m.variant} (${m.clinicalSignificance})`);
      }

      if (category) {
        const catLower = category.toLowerCase();
        const inDiagnosis = c.diagnosisHint?.toLowerCase().includes(catLower);
        const inNotes = c.notes?.toLowerCase().includes(catLower);
        const inGenes = matchedGenes.some((g) => g.toLowerCase().includes(catLower));
        if (!inDiagnosis && !inNotes && !inGenes) continue;
      }

      const hasTextMatch = q
        ? c.caseCode.toLowerCase().includes(q.toLowerCase()) ||
          (c.diagnosisHint?.toLowerCase().includes(q.toLowerCase()) ?? false) ||
          (c.notes?.toLowerCase().includes(q.toLowerCase()) ?? false)
        : false;
      const hasGeneMatch = gene ? matchedGenes.length > 0 : false;
      const hasStatusMatch = status ? c.status === status : false;
      const now = Date.now();
      const ageDays = (now - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const dateProximity = Math.max(0, 1 - ageDays / 365);
      let score = 0;
      if (hasTextMatch) score += 0.3;
      if (hasGeneMatch) score += 0.4;
      if (hasStatusMatch) score += 0.1;
      score += dateProximity * 0.2;

      results.push({
        id: c.id,
        caseCode: c.caseCode,
        diagnosisHint: c.diagnosisHint,
        status: c.status,
        doctorName: c.doctor.fullName,
        createdAt: c.createdAt.toISOString(),
        matchedGenes,
        matchedMutations,
        relevanceScore: Math.round(score * 100) / 100,
      });
    }

    results.sort((a, b) => (b.relevanceScore as number) - (a.relevanceScore as number));

    const total = results.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return NextResponse.json({ results: paginated, total, page, totalPages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
