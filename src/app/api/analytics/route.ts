// СППВР v2.0 — Aggregated Analytics API
// GET /api/analytics — Summary statistics for the analytics dashboard
//
// SECURITY (v4.3 audit fix): previously this route had NO authentication and
// returned institution-wide PHI aggregates (top genes, chronic diseases, top
// medications, hypertension rate, etc.) to anyone. Now: admin-only. The
// edge proxy already gates /api/analytics behind a session, but this adds
// route-level defense-in-depth and enforces admin role.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  try {
    // v4.3 audit fix: institution-wide PHI aggregates are admin-only.
    await requireAdmin(req);

    const [
      casesCount,
      documentsCount,
      analysesCount,
      reportsCount,
      recommendationsCount,
      doctorsCount,
      cases,
      documents,
      analyses,
      reports,
      auditLogs,
    ] = await Promise.all([
      db.case.count(),
      db.document.count(),
      db.analysisResult.count(),
      db.report.count(),
      db.clinicalRecommendation.count(),
      db.doctor.count(),
      db.case.findMany({ select: { status: true, createdAt: true } }),
      db.document.findMany({ select: { fileType: true } }),
      // v2.7.2 (audit fix): controlWeights добавлен в select — раньше поле не
      // выбиралось, режим ИИ/ручной всегда засчитывался как «ИИ».
      db.analysisResult.findMany({ select: { mutations: true, confidence: true, ddiAlerts: true, icd10Suggestions: true, pathwayMatches: true, controlWeights: true } }),
      db.report.findMany({ select: { status: true } }),
      db.auditLog.findMany({ select: { createdAt: true } }),
    ]);

    const totals = { cases: casesCount, documents: documentsCount, analyses: analysesCount, reports: reportsCount, recommendations: recommendationsCount, doctors: doctorsCount };

    // Cases by status
    const statusCounts = new Map<string, number>();
    for (const c of cases) statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
    const casesByStatus = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count }));

    // Cases by month (last 6 months)
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthKey(d));
    }
    const monthCounts = new Map<string, number>(months.map((m) => [m, 0]));
    for (const c of cases) {
      const k = monthKey(c.createdAt);
      if (monthCounts.has(k)) monthCounts.set(k, (monthCounts.get(k) ?? 0) + 1);
    }
    const casesByMonth = months.map((month) => ({ month, count: monthCounts.get(month) ?? 0 }));

    // Documents by type
    const typeCounts = new Map<string, number>();
    for (const d of documents) typeCounts.set(d.fileType, (typeCounts.get(d.fileType) ?? 0) + 1);
    const documentsByType = Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count }));

    // Top genes
    const geneCounts = new Map<string, number>();
    for (const a of analyses) {
      const muts = safeJsonParse<Array<{ gene?: string }>>(a.mutations, []);
      if (!Array.isArray(muts)) continue;
      for (const m of muts) {
        const gene = (m?.gene ?? "").trim();
        if (gene) geneCounts.set(gene, (geneCounts.get(gene) ?? 0) + 1);
      }
    }
    const topGenes = Array.from(geneCounts.entries()).map(([gene, count]) => ({ gene, count })).sort((a, b) => b.count - a.count).slice(0, 8);

    // Reports by status
    const reportStatusCounts = new Map<string, number>();
    for (const r of reports) reportStatusCounts.set(r.status, (reportStatusCounts.get(r.status) ?? 0) + 1);
    const reportsByStatus = Array.from(reportStatusCounts.entries()).map(([status, count]) => ({ status, count }));

    // Average confidence
    let diagSum = 0, diagN = 0, therapySum = 0, therapyN = 0, progSum = 0, progN = 0;
    for (const a of analyses) {
      const conf = safeJsonParse<Record<string, number>>(a.confidence, {});
      if (!conf || typeof conf !== "object") continue;
      if (typeof conf.diagnosis === "number" && isFinite(conf.diagnosis)) { diagSum += conf.diagnosis; diagN++; }
      if (typeof conf.therapy === "number" && isFinite(conf.therapy)) { therapySum += conf.therapy; therapyN++; }
      if (typeof conf.prognosis === "number" && isFinite(conf.prognosis)) { progSum += conf.prognosis; progN++; }
    }
    const avgConfidence = (diagN === 0 && therapyN === 0 && progN === 0) ? null : {
      diagnosis: diagN ? Math.round(diagSum / diagN * 1000) / 1000 : 0,
      therapy: therapyN ? Math.round(therapySum / therapyN * 1000) / 1000 : 0,
      prognosis: progN ? Math.round(progSum / progN * 1000) / 1000 : 0,
    };

    // DDI stats
    let ddiAlertCount = 0;
    const ddiSeverityCounts = new Map<string, number>();
    for (const a of analyses) {
      const ddi = safeJsonParse<Array<{ severity?: string }>>(a.ddiAlerts, []);
      if (Array.isArray(ddi)) {
        ddiAlertCount += ddi.length;
        for (const alert of ddi) {
          if (alert?.severity) {
            ddiSeverityCounts.set(alert.severity, (ddiSeverityCounts.get(alert.severity) ?? 0) + 1);
          }
        }
      }
    }
    const ddiAlertsBySeverity = Array.from(ddiSeverityCounts.entries()).map(([severity, count]) => ({ severity, count }));

    // ICD-10 stats
    let icd10Count = 0;
    for (const a of analyses) {
      const icd = safeJsonParse<Array<unknown>>(a.icd10Suggestions, []);
      if (Array.isArray(icd)) icd10Count += icd.length;
    }

    // Pathway stats
    let pathwayCount = 0;
    for (const a of analyses) {
      const pw = safeJsonParse<Array<unknown>>(a.pathwayMatches, []);
      if (Array.isArray(pw)) pathwayCount += pw.length;
    }

    // AI Availability — count analyses with AI vs manual mode
    let aiAvailable = 0;
    let manual = 0;
    for (const a of analyses) {
      const cw = safeJsonParse<Record<string, unknown>>(a.controlWeights, {});
      if (cw && typeof cw === "object") {
        const mode = cw.mode;
        if (mode === "manual") { manual++; } else { aiAvailable++; }
      } else {
        aiAvailable++;
      }
    }

    // Consent compliance rate
    const [totalConsents, grantedConsents] = await Promise.all([
      db.consent.count(),
      db.consent.count({ where: { granted: true } }),
    ]);
    const consentComplianceRate = totalConsents > 0 ? grantedConsents / totalConsents : 0;

    // ==========================================================================
    // EMR Analytics (v2.5.3) — patient population health metrics
    // ==========================================================================
    const [
      patientsCount,
      activePatientsCount,
      patients,
      vitalSigns,
      labResults,
      medications,
      visits,
      problems,
    ] = await Promise.all([
      db.patient.count(),
      db.patient.count({ where: { status: "active" } }),
      db.patient.findMany({ select: { sex: true, birthYear: true, birthDate: true, bloodType: true, chronicDiseases: true, allergies: true, smokingStatus: true } }),
      db.vitalSign.findMany({ select: { systolicBP: true, diastolicBP: true, heartRate: true, oxygenSaturation: true, recordedAt: true } }),
      db.labResult.findMany({ select: { flag: true, category: true, testName: true } }),
      db.medication.findMany({ select: { status: true, drugName: true } }),
      db.visit.findMany({ select: { visitType: true, status: true, scheduledAt: true } }),
      db.problem.findMany({ select: { status: true, severity: true, icd10: true, isPrimary: true } }),
    ]);

    // Patients by sex
    const sexCounts = new Map<string, number>();
    for (const p of patients) sexCounts.set(p.sex || "Не указан", (sexCounts.get(p.sex || "Не указан") ?? 0) + 1);
    const patientsBySex = Array.from(sexCounts.entries()).map(([sex, count]) => ({ sex, count }));

    // Patients by age group
    const ageGroups = { "0-18": 0, "19-40": 0, "41-60": 0, "61-80": 0, "80+": 0, "Неизвестно": 0 };
    // v2.6 (E2EE): полная дата рождения зашифрована — возраст считается по
    // открытому полю birthYear (аналогично модели Case).
    for (const p of patients) {
      if (!p.birthYear || p.birthYear < 1850) { ageGroups["Неизвестно"]++; continue; }
      const age = new Date().getFullYear() - p.birthYear;
      if (age < 0 || !isFinite(age)) { ageGroups["Неизвестно"]++; continue; }
      if (age <= 18) ageGroups["0-18"]++;
      else if (age <= 40) ageGroups["19-40"]++;
      else if (age <= 60) ageGroups["41-60"]++;
      else if (age <= 80) ageGroups["61-80"]++;
      else ageGroups["80+"]++;
    }
    const patientsByAgeGroup = Object.entries(ageGroups).map(([group, count]) => ({ group, count }));

    // Patients by blood type
    const bloodTypeCounts = new Map<string, number>();
    for (const p of patients) bloodTypeCounts.set(p.bloodType || "Не указан", (bloodTypeCounts.get(p.bloodType || "Не указан") ?? 0) + 1);
    const patientsByBloodType = Array.from(bloodTypeCounts.entries()).map(([type, count]) => ({ type, count })).filter(b => b.count > 0);

    // Chronic diseases distribution — parse JSON
    const diseaseCounts = new Map<string, number>();
    let allergyPatientCount = 0;
    for (const p of patients) {
      const diseases = safeJsonParse<Array<{ name?: string }>>(p.chronicDiseases, []);
      if (Array.isArray(diseases)) {
        for (const d of diseases) {
          const name = (d?.name ?? "").trim();
          if (name) diseaseCounts.set(name, (diseaseCounts.get(name) ?? 0) + 1);
        }
      }
      const allergies = safeJsonParse<Array<unknown>>(p.allergies, []);
      if (Array.isArray(allergies) && allergies.length > 0) allergyPatientCount++;
    }
    const chronicDiseasesDist = Array.from(diseaseCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const allergyRate = patientsCount > 0 ? Math.round((allergyPatientCount / patientsCount) * 1000) / 10 : 0;

    // Lab abnormalities
    const labFlagCounts = new Map<string, number>();
    for (const l of labResults) labFlagCounts.set(l.flag, (labFlagCounts.get(l.flag) ?? 0) + 1);
    const labResultsByFlag = Array.from(labFlagCounts.entries()).map(([flag, count]) => ({ flag, count }));
    const abnormalLabCount = labResults.filter(l => l.flag !== "normal").length;
    const labAbnormalityRate = labResults.length > 0 ? Math.round((abnormalLabCount / labResults.length) * 1000) / 10 : 0;

    // Lab categories distribution
    const labCategoryCounts = new Map<string, number>();
    for (const l of labResults) labCategoryCounts.set(l.category, (labCategoryCounts.get(l.category) ?? 0) + 1);
    const labResultsByCategory = Array.from(labCategoryCounts.entries()).map(([category, count]) => ({ category, count }));

    // Medications stats
    const activeMedsCount = medications.filter(m => m.status === "active").length;
    const topDrugs = new Map<string, number>();
    for (const m of medications) {
      if (!m.drugName) continue;
      topDrugs.set(m.drugName, (topDrugs.get(m.drugName) ?? 0) + 1);
    }
    const topMedications = Array.from(topDrugs.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Vitals stats — average BP, HR, SpO2
    let bpSysSum = 0, bpSysN = 0, bpDiaSum = 0, bpDiaN = 0, hrSum = 0, hrN = 0, spo2Sum = 0, spo2N = 0;
    for (const v of vitalSigns) {
      if (v.systolicBP > 0) { bpSysSum += v.systolicBP; bpSysN++; }
      if (v.diastolicBP > 0) { bpDiaSum += v.diastolicBP; bpDiaN++; }
      if (v.heartRate > 0) { hrSum += v.heartRate; hrN++; }
      if (v.oxygenSaturation > 0) { spo2Sum += v.oxygenSaturation; spo2N++; }
    }
    // Hypertension rate — patients with any BP reading >= 140/90
    const hypertensiveReadings = vitalSigns.filter(v => v.systolicBP >= 140 || v.diastolicBP >= 90).length;
    const hypertensionRate = vitalSigns.length > 0 ? Math.round((hypertensiveReadings / vitalSigns.length) * 1000) / 10 : 0;

    // Visits by type
    const visitTypeCounts = new Map<string, number>();
    for (const v of visits) visitTypeCounts.set(v.visitType, (visitTypeCounts.get(v.visitType) ?? 0) + 1);
    const visitsByType = Array.from(visitTypeCounts.entries()).map(([type, count]) => ({ type, count }));

    // Problems stats
    const activeProblemsCount = problems.filter(p => p.status === "active" || p.status === "chronic" || p.status === "uncontrolled").length;
    const topIcd10 = new Map<string, number>();
    for (const p of problems) {
      if (!p.icd10) continue;
      topIcd10.set(p.icd10, (topIcd10.get(p.icd10) ?? 0) + 1);
    }
    const topProblemsIcd10 = Array.from(topIcd10.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const emrTotals = {
      patients: patientsCount,
      activePatients: activePatientsCount,
      vitalSigns: vitalSigns.length,
      labResults: labResults.length,
      medications: medications.length,
      activeMedications: activeMedsCount,
      visits: visits.length,
      problems: problems.length,
      activeProblems: activeProblemsCount,
      allergyPatientCount,
    };

    const emrAnalytics = {
      totals: emrTotals,
      patientsBySex,
      patientsByAgeGroup,
      patientsByBloodType,
      chronicDiseasesDist,
      allergyRate,
      labResultsByFlag,
      labResultsByCategory,
      labAbnormalityRate,
      topMedications,
      visitsByType,
      topProblemsIcd10,
      hypertensionRate,
      avgVitals: {
        systolicBP: bpSysN ? Math.round(bpSysSum / bpSysN) : 0,
        diastolicBP: bpDiaN ? Math.round(bpDiaSum / bpDiaN) : 0,
        heartRate: hrN ? Math.round(hrSum / hrN) : 0,
        oxygenSaturation: spo2N ? Math.round(spo2Sum / spo2N) : 0,
      },
    };

    // Recent activity (last 7 days)
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push(dateKey(d));
    }
    const dayCounts = new Map<string, number>(days.map((d) => [d, 0]));
    for (const a of auditLogs) {
      const k = dateKey(a.createdAt);
      if (dayCounts.has(k)) dayCounts.set(k, (dayCounts.get(k) ?? 0) + 1);
    }
    const recentActivity = days.map((date) => ({ date, count: dayCounts.get(date) ?? 0 }));

    return NextResponse.json({
      totals,
      casesByStatus,
      casesByMonth,
      documentsByType,
      topGenes,
      reportsByStatus,
      avgConfidence,
      aiAvailability: { aiAvailable, manual },
      ddiAlertsBySeverity,
      consentComplianceRate,
      ddiAlertCount,
      icd10Count,
      pathwayCount,
      recentActivity,
      emrAnalytics,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      const status = e.message === "Authentication required" ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
