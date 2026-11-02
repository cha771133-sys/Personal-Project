import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { DeviceMedicationStore } from "@/types/device";

const DEVICE_ID = "PILLBOX-001";
const REDIS_KEY = `device:${DEVICE_ID}:medications`;
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export const dynamic = "force-dynamic";

function authorized(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  // The prototype's admin token is reused for this read-only calendar view.
  // Device token never leaves the ESP32; no credentials are embedded in frontend code.
  const expectedToken = process.env.DEVICE_PUBLISH_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return NextResponse.json({ error: "CALENDAR_TOKEN_NOT_CONFIGURED" },
      { status: 503, headers: HEADERS });
  }

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") ||
      !authorized(auth.slice(7), expectedToken)) {
    return NextResponse.json({ error: "UNAUTHORIZED" },
      { status: 401, headers: HEADERS });
  }

  try {
    const stored = await redis.get<DeviceMedicationStore>(REDIS_KEY);
    if (stored && (!Array.isArray(stored.medications) ||
        !Number.isSafeInteger(stored.scheduleVersion))) {
      return NextResponse.json({ error: "INVALID_STORED_DATA" },
        { status: 500, headers: HEADERS });
    }
    const medications = (stored?.medications ?? []).map((m) => ({
      occurrenceId: m.occurrenceId,
      name: m.name,
      dose: m.dose,
      scheduledAt: m.scheduledAt,
      status: m.status,
      completedAt: m.completedAt ?? null,
    }));
    return NextResponse.json({
      deviceId: DEVICE_ID,
      timezone: "Asia/Seoul",
      scheduleVersion: stored?.scheduleVersion ?? 0,
      generatedAt: new Date().toISOString(),
      medications,
    }, { status: 200, headers: HEADERS });
  } catch (error) {
    console.error("[Device Calendar] Read failed", error);
    return NextResponse.json({ error: "DATABASE_ERROR" },
      { status: 500, headers: HEADERS });
  }
}
