// СППВР v2.0 — Notification by ID API
// PATCH  /api/notifications/[id] — Mark as read
// DELETE /api/notifications/[id] — Delete notification
//
// SECURITY (v2.1.4): previously PATCH/DELETE had NO ownership check — any
// logged-in doctor could mark or delete ANY other doctor's notifications by
// guessing/enumerating the cuid. Now we extract the session and verify that
// the notification belongs to the session doctor (or the session is admin).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const existing = await db.notification.findUnique({
      where: { id },
      select: { doctorId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    if (existing.doctorId !== session.doctorId && session.role !== "admin") {
      return NextResponse.json(
        { error: "Not authorized to modify this notification" },
        { status: 403 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const data: Record<string, unknown> = {};
    // Strictly type-check `isRead` to avoid Prisma coercion surprises.
    if (typeof body.isRead === "boolean") {
      data.isRead = body.isRead;
    } else if ("isRead" in body) {
      return NextResponse.json(
        { error: "`isRead` must be a boolean" },
        { status: 400 },
      );
    }

    const updated = await db.notification.update({
      where: { id },
      data,
    });
    return NextResponse.json({ notification: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "notifications PATCH error", { id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const existing = await db.notification.findUnique({
      where: { id },
      select: { doctorId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    if (existing.doctorId !== session.doctorId && session.role !== "admin") {
      return NextResponse.json(
        { error: "Not authorized to delete this notification" },
        { status: 403 },
      );
    }

    await db.notification.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("api", "notifications DELETE error", { id, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
