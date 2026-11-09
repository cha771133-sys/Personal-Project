import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";
import { redis } from "@/lib/redis";
import type { DeviceMedication } from "@/types/device";

export const dynamic = "force-dynamic";

const DEVICE_ID = "PILLBOX-001";
const SCHEDULE_KEY = `device:${DEVICE_ID}:medications`;
const LOCK_KEY = `device:${DEVICE_ID}:demo:start:lock`;
const KST_MS = 9 * 60 * 60 * 1000;
const DEMO_DELAY_MS = 90_000;
const MAX_DEVICE_ITEMS = 24; // Arduino: MAX_MEDICATIONS = 24
const HEADERS = { "Cache-Control": "private, no-store" };

const ADD_DEMO_LUA = `
local raw = redis.call('GET', KEYS[1])
local store = { scheduleVersion = 0, medications = {} }
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= 'table' or
    type(decoded.scheduleVersion) ~= 'number' or type(decoded.medications) ~= 'table' then
    return -1
  end
  store = decoded
end
if #store.medications >= tonumber(ARGV[3]) then return -2 end
for _, med in ipairs(store.medications) do
  if type(med) ~= 'table' or type(med.occurrenceId) ~= 'string' or
    type(med.scheduledAt) ~= 'string' then return -1 end
  -- 다른 활성 시연이 있으면 중복 시연을 막습니다.
  if string.sub(med.occurrenceId, 1, 5) == 'demo-' and med.status == 'pending' and
    med.scheduledAt >= ARGV[2] then return -3 end
end
local ok, newMed = pcall(cjson.decode, ARGV[1])
if not ok or type(newMed) ~= 'table' then return -1 end
table.insert(store.medications, newMed)
table.sort(store.medications, function(a, b)
  if a.scheduledAt == b.scheduledAt then return a.occurrenceId < b.occurrenceId end
  return a.scheduledAt < b.scheduledAt
end)
store.scheduleVersion = store.scheduleVersion + 1
redis.call('SET', KEYS[1], cjson.encode(store), 'KEEPTTL')
return store.scheduleVersion
`;

// QStash 등록이 실패한 경우 추가한 시연 일정 1건만 삭제합니다.
const ROLLBACK_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, store = pcall(cjson.decode, raw)
if not ok or type(store) ~= 'table' or type(store.medications) ~= 'table' then return -1 end
for i, med in ipairs(store.medications) do
  if med.occurrenceId == ARGV[1] and med.status == 'pending' then
    table.remove(store.medications, i)
    store.scheduleVersion = store.scheduleVersion + 1
    redis.call('SET', KEYS[1], cjson.encode(store), 'KEEPTTL')
    return 1
  end
end
return 0
`;

const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
function validName(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0 && x.trim().length <= 100;
}

export async function POST(req: NextRequest) {
  const admin = process.env.DEVICE_PUBLISH_TOKEN;
  if (!admin || admin.length < 32) return fail("PUBLISH_TOKEN_NOT_CONFIGURED", 503);
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), admin)) {
    return fail("UNAUTHORIZED", 401);
  }
  if (!process.env.QSTASH_TOKEN || !process.env.QSTASH_CURRENT_SIGNING_KEY ||
      !process.env.QSTASH_NEXT_SIGNING_KEY || !process.env.TELEGRAM_BOT_TOKEN ||
      !process.env.TELEGRAM_CHAT_ID) {
    return fail("DEMO_TELEGRAM_NOT_CONFIGURED", 503);
  }

  let raw = "";
  try { raw = await req.text(); } catch { return fail("INVALID_REQUEST", 400); }
  if (Buffer.byteLength(raw, "utf8") > 4096) return fail("PAYLOAD_TOO_LARGE", 413);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return fail("INVALID_JSON", 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail("INVALID_REQUEST", 400);
  const request = data as Record<string, unknown>;
  if (request.confirmed !== true || !validName(request.name) || !validName(request.dose)) {
    return fail("INVALID_DEMO_MEDICATION", 422);
  }
  const name = request.name.trim();
  const dose = request.dose.trim();

  const originText = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
  let origin = "";
  try {
    const url = new URL(originText);
    if (url.protocol !== "https:" || !url.hostname || url.hostname === "localhost" ||
        url.hostname === "127.0.0.1") return fail("PUBLIC_BASE_URL_REQUIRED", 503);
    origin = url.origin;
  } catch { return fail("INVALID_BASE_URL", 503); }

  const lockId = randomUUID();
  const locked = await redis.set(LOCK_KEY, lockId, { nx: true, ex: 40 });
  if (locked !== "OK") return fail("DEMO_START_IN_PROGRESS", 409);

  try {
    const dueMs = Date.now() + DEMO_DELAY_MS;
    const scheduledAt = new Date(dueMs + KST_MS).toISOString().slice(0, 19) + "+09:00";
    const nowKst = new Date(Date.now() + KST_MS).toISOString().slice(0, 19) + "+09:00";
    const occurrenceId = `demo-${randomUUID()}`;
    const medication: DeviceMedication = {
      occurrenceId,
      medicationId: `demo-${occurrenceId}`,
      name,
      dose,
      scheduledAt,
      status: "pending",
      instruction: "학술제 시연용 알람입니다. 실제 약을 복용하지 마세요.",
    };

    const version = Number(await redis.eval(ADD_DEMO_LUA, [SCHEDULE_KEY], [
      JSON.stringify(medication), nowKst, String(MAX_DEVICE_ITEMS),
    ]));
    if (version === -1) return fail("INVALID_STORED_DATA", 500);
    if (version === -2) return fail("DEVICE_LIST_FULL_24", 409);
    if (version === -3) return fail("DEMO_ALREADY_PENDING", 409);
    if (!Number.isSafeInteger(version) || version < 1) return fail("DATABASE_ERROR", 500);

    try {
      const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
      const queued = await qstash.publishJSON({
        url: `${origin}/api/demo/notify`,
        body: { occurrenceId },
        notBefore: Math.ceil(dueMs / 1000),
      });
      console.info("[90s demo] queued", { occurrenceId, messageId: queued.messageId });
    } catch (error) {
      console.error("[90s demo] QStash publish failed", error);
      await redis.eval(ROLLBACK_LUA, [SCHEDULE_KEY], [occurrenceId]).catch(() => null);
      return fail("QSTASH_DEMO_SCHEDULE_FAILED", 502);
    }

    return NextResponse.json({
      success: true,
      occurrenceId,
      scheduledAt,
      scheduleVersion: version,
      message: "90초 시연 예약 완료. 실제 Telegram 수신은 알람 시각에 확인하세요.",
    }, { headers: HEADERS });
  } catch (error) {
    console.error("[90s demo] start error", error);
    return fail("DATABASE_ERROR", 500);
  } finally {
    await redis.eval(UNLOCK_LUA, [LOCK_KEY], [lockId]).catch(() => null);
  }
}
