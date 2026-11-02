import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { DeviceMedication, DeviceMedicationStore } from "@/types/device";
import type { Medication, PillShape } from "@/types/prescription";

// 학술제 단일 기기 시제품. 다중 사용자 기능은 별도 구현해야 합니다.
const DEVICE_ID = "PILLBOX-001";
const REDIS_KEY = `device:${DEVICE_ID}:medications`;
const MAX_DAYS = 7; // 현재 펌웨어 전송량을 고려한 임시 기간
const MAX_OCCURRENCES = 100;
const MAX_MEDICATIONS = 16;
const MAX_BODY_BYTES = 32_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

function checkToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= max ? value.trim() : null;
}

const SHAPES: readonly PillShape[] = [
  "round", "oval", "capsule", "tablet", "liquid", "powder", "ointment",
];

function buildOccurrences(input: unknown): {
  medications: DeviceMedication[];
  limitedToSevenDays: boolean;
} | { error: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MEDICATIONS) {
    return { error: "INVALID_MEDICATION_COUNT" };
  }

  const now = Date.now();
  const kstToday = new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
  const [year, month, day] = kstToday.split("-").map(Number);
  const publicationId = randomUUID().slice(0, 12);
  const result: DeviceMedication[] = [];
  let limitedToSevenDays = false;

  for (let i = 0; i < input.length; i++) {
    const raw: unknown = input[i];
    if (!isRecord(raw)) return { error: "INVALID_MEDICATION" };

    const name = boundedText(raw.drug_name_simple, 100) || boundedText(raw.drug_name, 100);
    const dose = boundedText(raw.dosage, 100);
    const alertTimes = raw.alert_times;
    const rawDuration = raw.duration_days;
    const duration = rawDuration == null ? 7 : rawDuration;

    if (!name || !dose || !Array.isArray(alertTimes) || alertTimes.length === 0 ||
        alertTimes.length > 4 || !Number.isInteger(duration) ||
        (duration as number) < 1 || (duration as number) > 365) {
      return { error: `INVALID_MEDICATION_DATA_AT_${i + 1}` };
    }

    const times = new Set<string>();
    for (const value of alertTimes) {
      if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return { error: `INVALID_ALERT_TIME_AT_${i + 1}` };
      }
      times.add(value);
    }

    const days = Math.min(duration as number, MAX_DAYS);
    if ((duration as number) > MAX_DAYS) limitedToSevenDays = true;

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const date = new Date(Date.UTC(year, month - 1, day + dayOffset))
        .toISOString().slice(0, 10);
      for (const time of [...times].sort()) {
        const scheduledAt = `${date}T${time}:00+09:00`;
        if (Date.parse(scheduledAt) <= now) continue; // 이미 지난 시각 제외

        const occurrence: DeviceMedication = {
          occurrenceId: `rx-${publicationId}-${i + 1}-${date.replace(/-/g, "")}-${time.replace(":", "")}`,
          medicationId: `rx-${publicationId}-${i + 1}`,
          name,
          dose,
          scheduledAt,
          status: "pending",
        };
        const instruction = boundedText(raw.senior_friendly_instruction, 250);
        if (instruction) occurrence.instruction = instruction;
        if (typeof raw.pill_color === "string" && /^#[0-9A-Fa-f]{6}$/.test(raw.pill_color)) {
          occurrence.pillColor = raw.pill_color;
        }
        if (typeof raw.pill_shape === "string" && SHAPES.includes(raw.pill_shape as PillShape)) {
          occurrence.pillShape = raw.pill_shape as Medication["pill_shape"];
        }
        result.push(occurrence);
        if (result.length > MAX_OCCURRENCES) return { error: "TOO_MANY_OCCURRENCES" };
      }
    }
  }

  result.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) ||
    a.occurrenceId.localeCompare(b.occurrenceId));
  if (result.length === 0) return { error: "NO_FUTURE_OCCURRENCES" };
  return { medications: result, limitedToSevenDays };
}

// 서버에서 버전을 증가시키고 Redis 데이터를 한 번에 교체합니다.
const PUBLISH_LUA = `
local previous = redis.call('GET', KEYS[1])
local version = 0
if previous then
  local ok, stored = pcall(cjson.decode, previous)
  if not ok or type(stored) ~= 'table' or type(stored.scheduleVersion) ~= 'number'
    or type(stored.medications) ~= 'table' then
    return -1
  end
  version = stored.scheduleVersion
end
local ok, newData = pcall(cjson.decode, ARGV[1])
if not ok or type(newData) ~= 'table' or type(newData.medications) ~= 'table' then
  return -2
end
newData.scheduleVersion = version + 1
redis.call('SET', KEYS[1], cjson.encode(newData))
return version + 1
`;

export async function POST(request: NextRequest) {
  const expectedToken = process.env.DEVICE_PUBLISH_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return fail("PUBLISH_TOKEN_NOT_CONFIGURED", 503);
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !checkToken(auth.slice(7), expectedToken)) {
    return fail("UNAUTHORIZED", 401);
  }

  let raw: string;
  try {
    raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return fail("PAYLOAD_TOO_LARGE", 413);
  } catch { return fail("INVALID_REQUEST", 400); }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail("INVALID_JSON", 400); }
  if (!isRecord(body) || body.confirmed !== true) return fail("CONFIRMATION_REQUIRED", 400);

  const plan = buildOccurrences(body.medications);
  if ("error" in plan) return fail(plan.error, 422);

  try {
    const store: DeviceMedicationStore = { scheduleVersion: 0, medications: plan.medications };
    const result: unknown = await redis.eval(PUBLISH_LUA, [REDIS_KEY], [JSON.stringify(store)]);
    const scheduleVersion = Number(result);
    if (!Number.isSafeInteger(scheduleVersion) || scheduleVersion < 1) {
      console.error("[Device Publish] Unexpected Redis result:", result);
      return fail("DATABASE_ERROR", 500);
    }

    return NextResponse.json({
      deviceId: DEVICE_ID,
      scheduleVersion,
      occurrenceCount: plan.medications.length,
      firstScheduledAt: plan.medications[0].scheduledAt,
      lastScheduledAt: plan.medications[plan.medications.length - 1].scheduledAt,
      limitedToSevenDays: plan.limitedToSevenDays,
    }, { status: 200, headers });
  } catch (error) {
    console.error("[Device Publish] Redis write failed", error);
    return fail("DATABASE_ERROR", 500);
  }
}
