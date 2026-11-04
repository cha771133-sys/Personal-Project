import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis, getScheduleIds, saveScheduleIds } from "@/lib/redis";
import { scheduleNotification, deleteSchedulesWithFailures } from "@/lib/qstash";
import type { GuardianData } from "@/types/prescription";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const LOCK_TTL_SECONDS = 180;
const MAX_BODY_BYTES = 32_000;
const MAX_QSTASH_JOBS = 40;

type ValidMed = {
  name: string;
  dose: string;
  durationDays: number;
  times: string[];
};

type ActivePlan = {
  planId: string;
  createdOn: string;
  scheduleIds: string[];
};

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

function authorized(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMedications(input: unknown): ValidMed[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 16) return null;
  const meds: ValidMed[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const raw of input as unknown[]) {
    if (!isRecord(raw)) return null;
    const name = typeof raw.drug_name_simple === "string" ? raw.drug_name_simple.trim() : "";
    const dose = typeof raw.dosage === "string" ? raw.dosage.trim() : "";
    const days = raw.duration_days;
    const times = raw.alert_times;
    if (!name || name.length > 100 || seen.has(name) || !dose || dose.length > 100 ||
        typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > 365 ||
        !Array.isArray(times) || times.length < 1 || times.length > 4 ||
        times.some(t => typeof t !== "string" || !TIME.test(t)) ||
        new Set(times).size !== times.length) return null;
    seen.add(name);
    count += times.length;
    if (count > MAX_QSTASH_JOBS) return null;
    meds.push({ name, dose, durationDays: days, times: [...times].sort() });
  }
  return meds;
}

function kstDateNow(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function plusCalendarDays(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

async function sendConfirmation(patientChatId: string, count: number): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: patientChatId,
        text: `복약 알림 ${count}건이 최종 확인된 정보로 등록되었습니다. 등록된 기간 동안 복용 시각에 안내합니다.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data: { ok?: boolean } = await res.json();
    return res.ok && data.ok === true;
  } catch (error) {
    console.error("[Confirmed Notifications] Telegram confirmation failed", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  const expected = process.env.DEVICE_PUBLISH_TOKEN;
  if (!expected || expected.length < 32) return fail("PUBLISH_TOKEN_NOT_CONFIGURED", 503);
  const token = request.headers.get("authorization") ?? "";
  if (!token.startsWith("Bearer ") || !authorized(token.slice(7), expected)) {
    return fail("UNAUTHORIZED", 401);
  }
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!process.env.QSTASH_TOKEN || !process.env.TELEGRAM_BOT_TOKEN || !chatId) {
    return fail("NOTIFICATION_SERVICE_NOT_CONFIGURED", 503);
  }

  let raw: string;
  try {
    raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return fail("PAYLOAD_TOO_LARGE", 413);
  } catch { return fail("INVALID_REQUEST", 400); }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail("INVALID_JSON", 400); }
  if (!isRecord(body) || body.confirmed !== true) return fail("CONFIRMATION_REQUIRED", 400);
  const meds = validateMedications(body.medications);
  if (!meds) return fail("INVALID_MEDICATION_DATA", 422);
  const patientName = typeof body.patientName === "string" ? body.patientName.trim() : "";
  if (patientName.length > 100) return fail("INVALID_PATIENT_NAME", 422);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin;
  let destination: URL;
  try { destination = new URL(baseUrl); }
  catch { return fail("INVALID_BASE_URL", 503); }
  if (destination.protocol !== "https:" || destination.hostname === "localhost" ||
      destination.hostname === "127.0.0.1" || destination.hostname === "your-app.vercel.app") {
    return fail("PUBLIC_BASE_URL_REQUIRED", 503);
  }

  const day = kstDateNow();
  const guardianData = await redis.get<GuardianData>(`guardian:${chatId}`).catch(() => null);
  const guardianChatId = guardianData?.guardianChatId || "";
  const planId = createHash("sha256").update(JSON.stringify({
    day, patientName, meds, guardianChatId,
  })).digest("hex");

  const activeKey = `notifications:active:${chatId}`;
  const lockKey = `notifications:lock:${chatId}`;
  const retiredKey = `notifications:retired:${chatId}`;
  const lockId = randomUUID();
  const locked = await redis.set(lockKey, lockId, { nx: true, ex: LOCK_TTL_SECONDS });
  if (locked !== "OK") return fail("ANOTHER_REGISTRATION_IN_PROGRESS", 409);

  try {
    const previous = await redis.get<ActivePlan>(activeKey);
    if (previous && previous.planId === planId && Array.isArray(previous.scheduleIds) &&
        previous.scheduleIds.length === meds.reduce((n, m) => n + m.times.length, 0)) {
      await saveScheduleIds(chatId, previous.scheduleIds);
      return NextResponse.json({
        success: true, alreadyScheduled: true, scheduleCount: previous.scheduleIds.length,
        confirmationSent: false, warning: "", day,
      }, { headers: HEADERS });
    }

    // Old/legacy schedules are retained until new ones are created and made active.
    const existingIds = await getScheduleIds(chatId);
    const oldIds = [...new Set([
      ...(Array.isArray(previous?.scheduleIds) ? previous.scheduleIds : []), ...existingIds,
    ])];
    const created: string[] = [];
    let activated = false;
    try {
      for (const med of meds) {
        for (const time of med.times) {
          const id = await scheduleNotification(time, {
            patientChatId: chatId,
            patientName,
            guardianChatId: guardianChatId || undefined,
            drugName: med.name,
            dose: med.dose,
            scheduleTime: time,
            alertType: "medication",
            planId,
            startsOn: day,
            expiresOn: plusCalendarDays(day, med.durationDays - 1),
          }, destination.origin);
          created.push(id);
        }
      }
      // Flip the active plan first: /api/notify will reject stale and not-yet-active jobs.
      await redis.set(activeKey, { planId, scheduleIds: created, createdOn: day });
      activated = true;
    } catch (error) {
      if (!activated) {
        const failed = await deleteSchedulesWithFailures(created);
        if (failed.length) await redis.set(retiredKey, failed).catch(() => null);
      }
      console.error("[Confirmed Notifications] QStash create failed", error);
      return fail("QSTASH_REGISTRATION_FAILED", 502);
    }

    const warnings: string[] = [];
    try { await saveScheduleIds(chatId, created); }
    catch (error) {
      warnings.push("스케줄 목록 저장에 실패했습니다. 관리자에게 확인이 필요합니다.");
      console.error("[Confirmed Notifications] Legacy ID storage failed", error);
    }

    const lingering = await redis.get<string[]>(retiredKey).catch(() => null);
    const candidates = [...new Set([...oldIds, ...(Array.isArray(lingering) ? lingering : [])])]
      .filter(id => !created.includes(id));
    try {
      const failed = await deleteSchedulesWithFailures(candidates);
      if (failed.length) {
        await redis.set(retiredKey, failed);
        warnings.push(`이전 QStash 스케줄 ${failed.length}건의 삭제를 재시도해야 합니다.`);
      } else {
        await redis.del(retiredKey);
      }
    } catch (error) {
      warnings.push("이전 QStash 스케줄 삭제 상태를 확인해야 합니다.");
      console.error("[Confirmed Notifications] Old schedule cleanup failed", error);
    }

    const confirmationSent = await sendConfirmation(chatId, created.length);
    if (!confirmationSent) warnings.push("예약은 등록됐지만 환자 Telegram 확인 메시지 발송은 실패했습니다.");
    if (guardianChatId) {
      const guardianSent = await sendConfirmation(guardianChatId, created.length);
      if (!guardianSent) warnings.push("보호자 Telegram 등록 확인 메시지는 전송되지 않았습니다.");
    }

    return NextResponse.json({
      success: true, alreadyScheduled: false, scheduleCount: created.length,
      confirmationSent, day, warning: warnings.join(" "),
    }, { headers: HEADERS });
  } catch (error) {
    console.error("[Confirmed Notifications] Unexpected error", error);
    return fail("DATABASE_ERROR", 500);
  } finally {
    await redis.eval(UNLOCK_LUA, [lockKey], [lockId]).catch(() => null);
  }
}
