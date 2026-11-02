import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const DEVICE_ID = "PILLBOX-001";
const REDIS_KEY = `device:${DEVICE_ID}:medications`;
const HEADERS = { "Cache-Control": "private, no-store" };
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

function authorized(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Atomic, idempotent update. The stored schedule always uses +09:00 ISO strings.
// A future scheduledAt must not be completed via the web.
const COMPLETE_WEB_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND', '', '0'} end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.medications) ~= 'table'
  or type(data.scheduleVersion) ~= 'number' then
  return {'INVALID_STORED_DATA', '', '0'}
end

for _, medication in ipairs(data.medications) do
  if type(medication) ~= 'table' then
    return {'INVALID_STORED_DATA', '', '0'}
  end
  if medication.occurrenceId == ARGV[1] then
    if medication.status == 'completed' then
      return {'ALREADY_COMPLETED', medication.completedAt or '', tostring(data.scheduleVersion)}
    end
    if medication.status ~= 'pending' or type(medication.scheduledAt) ~= 'string'
      or not string.match(medication.scheduledAt, '^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%+09:00$') then
      return {'INVALID_STORED_DATA', '', '0'}
    end
    if medication.scheduledAt > ARGV[3] then
      return {'NOT_DUE', '', tostring(data.scheduleVersion)}
    end
    medication.status = 'completed'
    medication.completedAt = ARGV[2]
    data.scheduleVersion = data.scheduleVersion + 1
    redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
    return {'COMPLETED', ARGV[2], tostring(data.scheduleVersion)}
  end
end
return {'NOT_FOUND', '', '0'}
`;

export async function POST(request: NextRequest) {
  const expected = process.env.DEVICE_PUBLISH_TOKEN;
  if (!expected || expected.length < 32) return fail("PUBLISH_TOKEN_NOT_CONFIGURED", 503);
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !authorized(auth.slice(7), expected)) {
    return fail("UNAUTHORIZED", 401);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 2048) return fail("PAYLOAD_TOO_LARGE", 413);
    body = JSON.parse(text);
  } catch {
    return fail("INVALID_JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("INVALID_REQUEST", 400);
  const occurrenceId = (body as Record<string, unknown>).occurrenceId;
  if (typeof occurrenceId !== "string" || occurrenceId.length < 1 ||
      occurrenceId.length > 128 || occurrenceId.trim() !== occurrenceId) {
    return fail("INVALID_OCCURRENCE_ID", 400);
  }

  try {
    const completedAt = new Date().toISOString();
    const kstNow = new Date(Date.now() + KST_OFFSET_MS).toISOString().replace("Z", "+09:00");
    const result: unknown = await redis.eval(COMPLETE_WEB_LUA, [REDIS_KEY],
      [occurrenceId, completedAt, kstNow]);
    if (!Array.isArray(result) || result.length !== 3 ||
        typeof result[0] !== "string" || typeof result[1] !== "string" ||
        (typeof result[2] !== "string" && typeof result[2] !== "number")) {
      throw new Error("Unexpected Redis EVAL result");
    }
    const [code, savedAt, rawVersion] = result;
    const scheduleVersion = Number(rawVersion);
    if (!Number.isSafeInteger(scheduleVersion) || scheduleVersion < 0) {
      throw new Error("Invalid scheduleVersion");
    }
    if (code === "NOT_FOUND") return fail("OCCURRENCE_NOT_FOUND", 404);
    if (code === "NOT_DUE") return fail("SCHEDULE_NOT_DUE", 409);
    if (code === "INVALID_STORED_DATA") return fail("INVALID_STORED_DATA", 500);
    if (code !== "COMPLETED" && code !== "ALREADY_COMPLETED") {
      throw new Error("Unexpected completion result");
    }
    return NextResponse.json({
      deviceId: DEVICE_ID, occurrenceId, status: "completed", completedAt: savedAt,
      scheduleVersion, alreadyCompleted: code === "ALREADY_COMPLETED",
    }, { status: 200, headers: HEADERS });
  } catch (error) {
    console.error("[Web Calendar Complete] Redis update failed", error);
    return fail("DATABASE_ERROR", 500);
  }
}
