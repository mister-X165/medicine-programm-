// ============================================================================
// СППВР v2.6/v2.7 — API ключевого материала E2EE врача
// ============================================================================
// GET  /api/auth/key           — материал для unlock (только шифротекст!)
// POST /api/auth/key           — регистрация ключа (первый вход после v2.6)
//                                body: { wrappedDek, kdfSalt, kdfParams, checkBlob,
//                                        wrapPubKey?, wrappedWrapKey? }
// POST /api/auth/key?action=wrap-upgrade — v2.7: до-регистрация X25519-пары
//                                у легаси-аккаунта (требует разблокированный DEK;
//                                body: { wrapPubKey, wrappedWrapKey })
// PUT  /api/auth/key           — пере-заворачивание при смене пароля
//                                body: { oldPassword, wrappedDek, kdfSalt, kdfParams, checkBlob }
//
// ZERO-KNOWLEDGE: сервер хранит только enc:v1:… шифротекст. Пароль, KEK и
// DEK существуют только в памяти браузера врача. Сервер не может расшифровать
// данные пациентов даже при компрометации БД (без пароля врача).
// wrapPubKey — ЕДИНСТВЕННОЕ открытое поле (публичный X25519 для выдачи PDEK).
// ============================================================================

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSessionFromRequest } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ENC_FIELD_RE = /^enc:v1:[A-Za-z0-9_-]+$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const WRAP_PUB_RE = /^[A-Za-z0-9+/]{43}=?$/; // base64(32 байта) = 44 симв.

function parseKeyMaterialBody(body: Record<string, unknown>) {
  const wrappedDek = String(body.wrappedDek ?? "");
  const kdfSalt = String(body.kdfSalt ?? "");
  const checkBlob = String(body.checkBlob ?? "");
  const kdfParamsRaw = body.kdfParams as
    | { memoryKiB?: unknown; iterations?: unknown; parallelism?: unknown }
    | undefined;

  if (!ENC_FIELD_RE.test(wrappedDek)) {
    return { error: "wrappedDek должен быть шифротекстом enc:v1:…" } as const;
  }
  if (!ENC_FIELD_RE.test(checkBlob)) {
    return { error: "checkBlob должен быть шифротекстом enc:v1:…" } as const;
  }
  if (!B64_RE.test(kdfSalt) || kdfSalt.length < 16) {
    return { error: "kdfSalt должен быть base64 ≥ 16 байт" } as const;
  }
  if (
    !kdfParamsRaw ||
    typeof kdfParamsRaw.memoryKiB !== "number" ||
    typeof kdfParamsRaw.iterations !== "number" ||
    typeof kdfParamsRaw.parallelism !== "number" ||
    kdfParamsRaw.memoryKiB < 8 * 1024 || // минимум 8 MiB
    kdfParamsRaw.memoryKiB > 1024 * 1024 || // максимум 1 GiB
    kdfParamsRaw.iterations < 1 ||
    kdfParamsRaw.iterations > 16 ||
    kdfParamsRaw.parallelism < 1 ||
    kdfParamsRaw.parallelism > 16
  ) {
    return { error: "Некорректные параметры Argon2id" } as const;
  }

  return {
    value: {
      wrappedDek,
      kdfSalt,
      checkBlob,
      kdfParamsJson: JSON.stringify({
        memoryKiB: kdfParamsRaw.memoryKiB,
        iterations: kdfParamsRaw.iterations,
        parallelism: kdfParamsRaw.parallelism,
      }),
    },
  } as const;
}

// ----------------------------------------------------------------------------
// GET — материал текущего врача (для unlock после перезагрузки страницы)
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const material = await db.doctorKeyMaterial.findUnique({
    where: { doctorId: session.doctorId },
    select: {
      wrappedDek: true,
      kdfSalt: true,
      kdfParamsJson: true,
      checkBlob: true,
      wrapPubKey: true,
      wrappedWrapKey: true,
      createdAt: true,
    },
  });

  if (!material) {
    return NextResponse.json({ enrolled: false }, { status: 404 });
  }

  let kdfParams: unknown;
  try {
    kdfParams = JSON.parse(material.kdfParamsJson);
  } catch {
    kdfParams = null;
  }

  return NextResponse.json({
    enrolled: true,
    material: {
      wrappedDek: material.wrappedDek,
      kdfSalt: material.kdfSalt,
      kdfParams,
      checkBlob: material.checkBlob,
      wrapPubKey: material.wrapPubKey ?? null,
      wrappedWrapKey: material.wrappedWrapKey ?? null,
    },
    createdAt: material.createdAt.toISOString(),
  });
}

// ----------------------------------------------------------------------------
// POST — первичная регистрация ключа (после первого входа в v2.6)
//         или v2.7 wrap-upgrade — до-регистрация X25519-пары легаси-аккаунта
// ----------------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(req.url);
  const isWrapUpgrade = url.searchParams.get("action") === "wrap-upgrade";

  try {
    const body = (await req.json()) as Record<string, unknown>;

    // ----------------------------------------------------------------------
    // v2.7: action=wrap-upgrade — добавление X25519-пары к СУЩЕСТВУЮЩЕМУ
    // материалу (аккаунты, зарегистрированные до v2.7). Заменяет только
    // wrap-поля, не трогает DEK/соль/checkBlob.
    // ----------------------------------------------------------------------
    if (isWrapUpgrade) {
      const wrapPubKey = String(body.wrapPubKey ?? "");
      const wrappedWrapKey = String(body.wrappedWrapKey ?? "");
      if (!WRAP_PUB_RE.test(wrapPubKey)) {
        return NextResponse.json(
          { error: "wrapPubKey должен быть base64(32 байта) X25519" },
          { status: 400 },
        );
      }
      if (!ENC_FIELD_RE.test(wrappedWrapKey)) {
        return NextResponse.json(
          { error: "wrappedWrapKey должен быть шифротекстом enc:v1:…" },
          { status: 400 },
        );
      }

      // Замена wrap-ключей разрешена только если их ещё нет (первичная
      // регистрация X25519) — повторная замена потребовала бы master-DEK,
      // который сервер не видит. Ротация — через смену пароля (PUT).
      const existing = await db.doctorKeyMaterial.findUnique({
        where: { doctorId: session.doctorId },
        select: { wrapPubKey: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "Ключ ещё не зарегистрирован" }, { status: 404 });
      }
      if (existing.wrapPubKey) {
        return NextResponse.json(
          { error: "X25519-пара уже зарегистрирована" },
          { status: 409 },
        );
      }

      await db.doctorKeyMaterial.update({
        where: { doctorId: session.doctorId },
        data: { wrapPubKey, wrappedWrapKey },
      });

      await appendAudit({
        action: "e2ee.wrap.upgrade",
        details: { doctorId: session.doctorId, key: "x25519" },
        doctorId: session.doctorId,
      });
      logger.info("auth", "E2EE wrap keys upgraded (v2.7)", { doctorId: session.doctorId });
      return NextResponse.json({ success: true }, { status: 201 });
    }

    const parsed = parseKeyMaterialBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const existing = await db.doctorKeyMaterial.findUnique({
      where: { doctorId: session.doctorId },
    });
    if (existing) {
      // Защита от подмены DEK: повторная регистрация запрещена.
      // Замена ключа — только через PUT (требует старый пароль).
      return NextResponse.json(
        { error: "Ключ уже зарегистрирован. Используйте смену пароля для замены." },
        { status: 409 },
      );
    }

    // v2.7: X25519-пара для key-wrapping (опционально, но генерируется всегда)
    let wrapPubKey: string | undefined;
    let wrappedWrapKey: string | undefined;
    const bodyWrapPub = String(body.wrapPubKey ?? "");
    const bodyWrappedWrap = String(body.wrappedWrapKey ?? "");
    if (bodyWrapPub || bodyWrappedWrap) {
      if (!WRAP_PUB_RE.test(bodyWrapPub) || !ENC_FIELD_RE.test(bodyWrappedWrap)) {
        return NextResponse.json(
          { error: "wrapPubKey/wrappedWrapKey имеют неверный формат" },
          { status: 400 },
        );
      }
      wrapPubKey = bodyWrapPub;
      wrappedWrapKey = bodyWrappedWrap;
    }

    await db.doctorKeyMaterial.create({
      data: {
        doctorId: session.doctorId,
        wrappedDek: parsed.value.wrappedDek,
        kdfSalt: parsed.value.kdfSalt,
        kdfParamsJson: parsed.value.kdfParamsJson,
        checkBlob: parsed.value.checkBlob,
        wrapPubKey,
        wrappedWrapKey,
      },
    });

    await appendAudit({
      action: "e2ee.key.enroll",
      details: { doctorId: session.doctorId, kdf: "argon2id", wrap: !!wrapPubKey },
      doctorId: session.doctorId,
    });
    logger.info("auth", "E2EE key enrolled", { doctorId: session.doctorId });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("auth", "Failed to enroll E2EE key", { error: msg, doctorId: session.doctorId });
    return NextResponse.json({ error: "Не удалось зарегистрировать ключ" }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// PUT — пере-заворачивание DEK при смене пароля (требует СТАРЫЙ пароль)
// ----------------------------------------------------------------------------

export async function PUT(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const oldPassword = String(body.oldPassword ?? "");
    if (!oldPassword) {
      return NextResponse.json({ error: "Требуется текущий пароль" }, { status: 400 });
    }

    // Проверка старого пароля bcrypt-ом (как в set-password)
    const doctor = await db.doctor.findUnique({
      where: { id: session.doctorId },
      select: { passwordHash: true },
    });
    if (!doctor || !doctor.passwordHash) {
      return NextResponse.json({ error: "Врач не найден" }, { status: 404 });
    }
    const ok = await bcrypt.compare(oldPassword, doctor.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 401 });
    }

    const parsed = parseKeyMaterialBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    await db.doctorKeyMaterial.update({
      where: { doctorId: session.doctorId },
      data: {
        wrappedDek: parsed.value.wrappedDek,
        kdfSalt: parsed.value.kdfSalt,
        kdfParamsJson: parsed.value.kdfParamsJson,
        checkBlob: parsed.value.checkBlob,
      },
    });

    await appendAudit({
      action: "e2ee.key.rewrap",
      details: { doctorId: session.doctorId },
      doctorId: session.doctorId,
    });
    logger.info("auth", "E2EE key rewrapped", { doctorId: session.doctorId });

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("auth", "Failed to rewrap E2EE key", { error: msg, doctorId: session.doctorId });
    return NextResponse.json({ error: "Не удалось обновить ключ" }, { status: 500 });
  }
}
