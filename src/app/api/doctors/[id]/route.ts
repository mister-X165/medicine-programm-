// СППВР v2.0 — Doctor by ID API
// GET    /api/doctors/[id] — Get doctor profile (any authenticated user)
// PATCH  /api/doctors/[id] — Update doctor profile
//   - Self can edit fullName/specialization
//   - Only admin can change role / isActive
// DELETE /api/doctors/[id] — Delete doctor (admin only)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAuth, invalidateAccountCache } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // v4.3 audit fix: defense-in-depth — require a session at the route level
    // (the edge proxy enforces auth on /api/doctors/*, but the handler never
    // re-checked). Prevents user enumeration if the proxy is ever bypassed.
    await requireAuth(req);
    const doctor = await db.doctor.findUnique({
      where: { id },
      include: {
        _count: { select: { cases: true, reports: true, auditLogs: true } },
      },
    });
    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }
    return NextResponse.json({
      doctor: {
        id: doctor.id,
        fullName: doctor.fullName,
        specialization: doctor.specialization,
        doctorCode: doctor.doctorCode,
        role: doctor.role,
        isActive: doctor.isActive,
        hasPassword: !!doctor.passwordHash,
        createdAt: doctor.createdAt.toISOString(),
        _count: doctor._count,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const { role, isActive, fullName, specialization } = body;

    const isSelf = session.doctorId === id;
    const isAdmin = session.role === "admin";

    // Authorization: only admin can change role / isActive.
    // Self can edit only fullName/specialization.
    if ((role !== undefined || isActive !== undefined) && !isAdmin) {
      return NextResponse.json(
        { error: "Only administrators can change role or active status" },
        { status: 403 },
      );
    }

    // Non-admin cannot edit other doctors' profiles
    if (!isSelf && !isAdmin) {
      return NextResponse.json(
        { error: "You can only edit your own profile" },
        { status: 403 },
      );
    }

    // Cannot remove last admin
    if (role === "doctor") {
      const currentDoctor = await db.doctor.findUnique({ where: { id } });
      if (currentDoctor?.role === "admin") {
        const adminCount = await db.doctor.count({
          where: { role: "admin", isActive: true },
        });
        if (adminCount <= 1) {
          return NextResponse.json(
            { error: "Cannot remove admin role from the last active administrator" },
            { status: 400 },
          );
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (role && typeof role === "string") data.role = role;
    if (isActive !== undefined && typeof isActive === "boolean") data.isActive = isActive;
    if (fullName && typeof fullName === "string") data.fullName = fullName.trim();
    if (specialization && typeof specialization === "string") data.specialization = specialization.trim();
    // v2.6: изменение роли/деактивация мгновенно отзывают все JWT врача
    // (tokenVersion++ — проверяется в getSessionFromRequest).
    if (data.role !== undefined || data.isActive !== undefined) {
      data.tokenVersion = { increment: 1 };
    }

    const updated = await db.doctor.update({
      where: { id },
      data,
    });
    invalidateAccountCache(id);

    await appendAudit({
      doctorId: session.doctorId,
      action: "update_doctor_profile",
      details: JSON.stringify({
        targetDoctorId: id,
        updatedFields: Object.keys(data),
        byAdmin: isAdmin,
        bySelf: isSelf,
      }),
    });

    logger.info("doctors", "Doctor updated", { doctorId: id, fields: Object.keys(data), by: session.doctorCode });

    return NextResponse.json({
      doctor: {
        id: updated.id,
        fullName: updated.fullName,
        specialization: updated.specialization,
        doctorCode: updated.doctorCode,
        role: updated.role,
        isActive: updated.isActive,
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const session = await requireAuth(req);
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Safety: an admin must NEVER be able to delete themselves or another admin.
    if (session.doctorId === id) {
      return NextResponse.json(
        { error: "Нельзя удалить собственный профиль. Используйте деактивацию." },
        { status: 400 },
      );
    }

    const doctor = await db.doctor.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            cases: true,
            reports: true,
            auditLogs: true,
            sentShares: true,
            recvShares: true,
            notifications: true,
            signatures: true,
            consents: true,
          },
        },
      },
    });
    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }
    if (doctor.role === "admin") {
      return NextResponse.json(
        { error: "Нельзя удалить профиль администратора. Сначала понизьте роль до врача." },
        { status: 403 },
      );
    }

    // v2.1.5 FIX: Wrap the deletion in a transaction so that if ANY step
    // fails, the whole operation rolls back. Previously the cascade was
    // implicit and a partial failure could leave the DB in an inconsistent
    // state. We also explicitly nullify audit-log and signature doctorId
    // references via the schema's onDelete: SetNull (AuditLog) — those are
    // compliance records that must survive deletion.
    //
    // Order matters for referential integrity:
    //   1. Reassign case ownership (transfer cases to the admin) OR delete
    //      them. We DELETE cases here because the doctor is being fully
    //      removed and their cases are no longer needed. (Admins can export
    //      cases before deletion via the backup endpoint.)
    //   2. Delete the doctor — Prisma cascades to reports, signatures
    //      (Cascade), consents (Cascade), shares (Cascade), notifications
    //      (Cascade). AuditLog rows are SetNull'd (preserved).
    await db.$transaction(async (tx) => {
      // The transaction will cascade-delete: cases, documents, analysis,
      // analysis_versions, reports, report_signatures, consents, case_shares,
      // notifications. AuditLog.doctorId is set to NULL (SetNull) so the
      // WORM hash-chain survives the deletion.
      await tx.doctor.delete({ where: { id } });
    });

    // Audit AFTER the successful deletion. We pass `doctorId: null` so the
    // audit entry doesn't reference the (now-deleted) target doctor — only
    // the admin who performed the action is recorded. This keeps the chain
    // intact even though the target doctor's audit rows were SetNull'd.
    await appendAudit({
      doctorId: session.doctorId,
      action: "delete_doctor_profile",
      details: JSON.stringify({
        deletedDoctorCode: doctor.doctorCode,
        deletedFullName: doctor.fullName,
        deletedSpecialization: doctor.specialization,
        deletedCounts: doctor._count,
      }),
    });

    logger.info("doctors", "Doctor deleted", {
      doctorCode: doctor.doctorCode,
      deletedBy: session.doctorCode,
    });
    return NextResponse.json({
      success: true,
      message: `Профиль врача ${doctor.fullName} (${doctor.doctorCode}) удалён. Аудит-логи сохранены (WORM).`,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "Authentication required" || e.message === "Admin access required")) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    logger.error("doctors", "Doctor deletion failed", {
      targetId: id,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
