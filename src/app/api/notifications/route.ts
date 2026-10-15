// СППВР v2.0 — Notifications API
// GET    /api/notifications — Get notifications for doctor
// DELETE /api/notifications — Clear read notifications / delete one
//
// SECURITY (v2.1.4): previously GET/DELETE accepted `?doctorId=<any>` and
// returned/cleared ANY doctor's notifications. Now we extract the session
// from the JWT and:
//   - 401 if no session
//   - non-admins: force `doctorId = session.doctorId` (ignore query/body param)
//   - admins: may specify a different doctorId to read/clear on behalf of a user

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedDoctorId = searchParams.get("doctorId");
    // Non-admins can only see their own notifications. Admins may pass any
    // doctorId to inspect another doctor's feed (e.g. for support).
    const doctorId =
      session.role === "admin" && requestedDoctorId ? requestedDoctorId : session.doctorId;

    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
    const skip = (page - 1) * limit;

    const where = {
      doctorId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, count, unreadCount] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.notification.count({ where }),
      db.notification.count({ where: { doctorId, isRead: false } }),
    ]);

    return NextResponse.json({ notifications, count, unreadCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "notifications GET error", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is allowed — treat as "no-op" and fall through to the 400.
      body = {};
    }

    // Delete a single notification by id — must belong to the session doctor
    // (or admin may delete anyone's).
    if (body.id) {
      const id = String(body.id);
      const notif = await db.notification.findUnique({
        where: { id },
        select: { doctorId: true },
      });
      if (!notif) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
      if (notif.doctorId !== session.doctorId && session.role !== "admin") {
        return NextResponse.json(
          { error: "Not authorized to delete this notification" },
          { status: 403 },
        );
      }
      await db.notification.delete({ where: { id } });
      return NextResponse.json({ success: true });
    }

    // Clear all read notifications for a doctor.
    if (body.clearRead) {
      const requestedDoctorId = typeof body.doctorId === "string" ? body.doctorId : undefined;
      const doctorId =
        session.role === "admin" && requestedDoctorId ? requestedDoctorId : session.doctorId;

      const result = await db.notification.deleteMany({
        where: { doctorId, isRead: true },
      });
      return NextResponse.json({ success: true, deleted: result.count });
    }

    return NextResponse.json({ error: "Specify id or {clearRead: true}" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "notifications DELETE error", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
