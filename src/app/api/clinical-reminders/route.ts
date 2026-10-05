// СППВР v2.5.7 — Clinical Reminders API
// GET /api/clinical-reminders — Aggregates overdue/urgent clinical items:
//   1. Abnormal/critical lab results requiring follow-up
//   2. Active medications without a specified end date (review needed)
//   3. Scheduled visits (upcoming and past-due)
//   4. Patients with uncontrolled problems
//   5. Immunizations with upcoming next-dose dates
//
// SECURITY: JWT-protected. Non-admins see only their primary patients.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Scope patients for non-admins
    const patientWhere = session.role !== "admin"
      ? { OR: [{ primaryDoctorId: session.doctorId }, { cases: { some: { doctorId: session.doctorId } } }] }
      : {};

    // 1. Critical/abnormal lab results (last 30 days, not yet followed up)
    const abnormalLabs = await db.labResult.findMany({
      where: {
        flag: { in: ["critical", "high", "low"] },
        collectedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        patient: patientWhere,
      },
      include: {
        patient: { select: { id: true, patientToken: true, lastName: true, firstName: true } },
      },
      orderBy: { collectedAt: "desc" },
      take: 10,
    });

    const labReminders = abnormalLabs.map((l) => ({
      id: l.id,
      type: "lab_followup" as const,
      priority: l.flag === "critical" ? "urgent" : "high",
      title: `${l.testName}: ${l.value} ${l.unit} (${l.flag})`,
      patientLast: l.patient.lastName, // enc:v1:… (v2.7)
        patientFirst: l.patient.firstName,
      patientToken: l.patient.patientToken,
      patientId: l.patient.id,
      date: l.collectedAt.toISOString(),
      detail: l.refRangeLow != null && l.refRangeHigh != null
        ? `Норма: ${l.refRangeLow}–${l.refRangeHigh} ${l.unit}`
        : undefined,
      daysAgo: Math.floor((now.getTime() - l.collectedAt.getTime()) / (1000 * 60 * 60 * 24)),
    }));

    // 2. Scheduled visits (upcoming in next 7 days, or past-due/no-show)
    const upcomingVisits = await db.visit.findMany({
      where: {
        status: "scheduled",
        scheduledAt: { gte: weekAgo, lte: weekAhead },
        patient: patientWhere,
      },
      include: {
        patient: { select: { id: true, patientToken: true, lastName: true, firstName: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: 10,
    });

    const visitReminders = upcomingVisits.map((v) => {
      const isPast = v.scheduledAt < now;
      return {
        id: v.id,
        type: "visit_scheduled" as const,
        priority: isPast ? "urgent" : "medium",
        title: `${({ outpatient: "Амбулаторный", inpatient: "Стационарный", emergency: "Экстренный", telemedicine: "Телемедицина", home: "Дом", consultation: "Консультация" } as Record<string, string>)[v.visitType] || v.visitType} визит`,
        patientLast: v.patient.lastName, // enc:v1:… (v2.7)
        patientFirst: v.patient.firstName,
        patientToken: v.patient.patientToken,
        patientId: v.patient.id,
        date: v.scheduledAt.toISOString(),
        detail: v.chiefComplaint || undefined,
        daysUntil: isPast ? -Math.floor((now.getTime() - v.scheduledAt.getTime()) / (1000 * 60 * 60 * 24)) : Math.floor((v.scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

    // 3. Active medications started >90 days ago (review needed)
    const oldMeds = await db.medication.findMany({
      where: {
        status: "active",
        startDate: { lte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
        patient: patientWhere,
      },
      include: {
        patient: { select: { id: true, patientToken: true, lastName: true, firstName: true } },
      },
      orderBy: { startDate: "asc" },
      take: 10,
    });

    const medReminders = oldMeds.map((m) => ({
      id: m.id,
      type: "med_review" as const,
      priority: "medium" as const,
      title: `Review: ${m.drugName} ${m.dosage}`,
      patientLast: m.patient.lastName, // enc:v1:… (v2.7)
        patientFirst: m.patient.firstName,
      patientToken: m.patient.patientToken,
      patientId: m.patient.id,
      date: m.startDate.toISOString(),
      detail: `${m.frequency || ""} · с ${m.startDate.toLocaleDateString("ru-RU")} (${Math.floor((now.getTime() - m.startDate.getTime()) / (1000 * 60 * 60 * 24))} дн)`,
      daysAgo: Math.floor((now.getTime() - m.startDate.getTime()) / (1000 * 60 * 60 * 24)),
    }));

    // 4. Uncontrolled problems
    const uncontrolledProblems = await db.problem.findMany({
      where: {
        status: { in: ["active", "uncontrolled"] },
        patient: patientWhere,
      },
      include: {
        patient: { select: { id: true, patientToken: true, lastName: true, firstName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const problemReminders = uncontrolledProblems.map((p) => ({
      id: p.id,
      type: "problem_uncontrolled" as const,
      priority: p.severity === "critical" ? "urgent" : p.severity === "severe" ? "high" : "medium",
      title: p.title,
      patientLast: p.patient.lastName, // enc:v1:… (v2.7)
        patientFirst: p.patient.firstName,
      patientToken: p.patient.patientToken,
      patientId: p.patient.id,
      date: (p.onsetDate || p.createdAt).toISOString(),
      detail: p.icd10 ? `МКБ-10: ${p.icd10} · ${p.status}` : p.status,
    }));

    // 5. Immunizations with upcoming next-dose
    const upcomingImmunizations = await db.immunization.findMany({
      where: {
        nextDoseDate: { gte: now, lte: monthAhead },
        patient: patientWhere,
      },
      include: {
        patient: { select: { id: true, patientToken: true, lastName: true, firstName: true } },
      },
      orderBy: { nextDoseDate: "asc" },
      take: 10,
    });

    const immunizationReminders = upcomingImmunizations.map((i) => ({
      id: i.id,
      type: "immunization_due" as const,
      priority: "medium" as const,
      title: `Прививка: ${i.vaccineName} (доза №${i.doseNumber})`,
      patientLast: i.patient.lastName, // enc:v1:… (v2.7)
        patientFirst: i.patient.firstName,
      patientToken: i.patient.patientToken,
      patientId: i.patient.id,
      date: i.nextDoseDate!.toISOString(),
      detail: i.targetDisease ? `Против: ${i.targetDisease}` : undefined,
      daysUntil: Math.floor((i.nextDoseDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    }));

    // Combine and sort by priority then date
    const allReminders = [
      ...labReminders,
      ...visitReminders,
      ...medReminders,
      ...problemReminders,
      ...immunizationReminders,
    ];

    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    allReminders.sort((a, b) => {
      const po = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (po !== 0) return po;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    // Summary counts
    const summary = {
      total: allReminders.length,
      urgent: allReminders.filter(r => r.priority === "urgent").length,
      high: allReminders.filter(r => r.priority === "high").length,
      medium: allReminders.filter(r => r.priority === "medium").length,
      byType: {
        lab_followup: labReminders.length,
        visit_scheduled: visitReminders.length,
        med_review: medReminders.length,
        problem_uncontrolled: problemReminders.length,
        immunization_due: immunizationReminders.length,
      },
    };

    logger.info("clinical-reminders", "Generated reminders", { count: allReminders.length, urgent: summary.urgent });

    return NextResponse.json({
      reminders: allReminders,
      summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("clinical-reminders", "Failed to generate reminders", { error: msg });
    return NextResponse.json({ error: "Failed to generate reminders", detail: msg }, { status: 500 });
  }
}
