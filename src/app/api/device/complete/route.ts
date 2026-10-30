import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const DEVICE_ID = "PILLBOX-001";
const REDIS_KEY = `device:${DEVICE_ID}:medications`;

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store",
};

// 복약 일정 읽기·완료 처리·다시 저장을 한 번에 실행합니다.
// 반복 POST는 동일한 완료 시각을 반환하며 버전을 다시 증가시키지 않습니다.
const COMPLETE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'NO_SCHEDULE', '', '0'}
end

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

    if medication.status ~= 'pending' then
      return {'INVALID_STORED_DATA', '', '0'}
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
  const expectedToken = process.env.DEVICE_API_TOKEN;
  if (!expectedToken) {
    console.error("[Device Complete] DEVICE_API_TOKEN not configured");
    return NextResponse.json(
      { error: "SERVER_NOT_CONFIGURED" },
      { status: 503, headers: responseHeaders },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: responseHeaders },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON" },
      { status: 400, headers: responseHeaders },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400, headers: responseHeaders },
    );
  }

  const occurrenceId = (body as Record<string, unknown>).occurrenceId;
  if (
    typeof occurrenceId !== "string" ||
    occurrenceId.length === 0 ||
    occurrenceId.length > 128 ||
    occurrenceId.trim() !== occurrenceId
  ) {
    return NextResponse.json(
      { error: "INVALID_OCCURRENCE_ID" },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    // 완료 시각은 기기 시계가 아닌 서버의 UTC 시각을 사용합니다.
    const completedAt = new Date().toISOString();
    const result: unknown = await redis.eval(
      COMPLETE_LUA,
      [REDIS_KEY],
      [occurrenceId, completedAt],
    );

    // Upstash SDK can deserialize numeric-looking Redis strings into numbers.
    // Accept either representation rather than returning 500 after a successful write.
    if (!Array.isArray(result) || result.length !== 3) {
      console.error("[Device Complete] Unexpected EVAL result shape", {
        isArray: Array.isArray(result),
        valueType: typeof result,
      });
      throw new Error("Unexpected Redis EVAL response");
    }

    const [rawCode, rawSavedAt, rawVersion] = result as unknown[];
    if (
      typeof rawCode !== "string" ||
      typeof rawSavedAt !== "string" ||
      (typeof rawVersion !== "string" && typeof rawVersion !== "number")
    ) {
      console.error("[Device Complete] Unexpected EVAL value types", {
        types: result.map((value: unknown) => typeof value),
      });
      throw new Error("Unexpected Redis EVAL value types");
    }

    const code = rawCode;
    const savedAt = rawSavedAt;
    const scheduleVersion = Number(rawVersion);
    if (!Number.isSafeInteger(scheduleVersion) || scheduleVersion < 0) {
      throw new Error("Invalid Redis scheduleVersion");
    }

    if (code === "NO_SCHEDULE" || code === "NOT_FOUND") {
      return NextResponse.json(
        { error: "OCCURRENCE_NOT_FOUND" },
        { status: 404, headers: responseHeaders },
      );
    }
    if (code === "INVALID_STORED_DATA") {
      return NextResponse.json(
        { error: "INVALID_STORED_DATA" },
        { status: 500, headers: responseHeaders },
      );
    }
    if (code !== "COMPLETED" && code !== "ALREADY_COMPLETED") {
      throw new Error(`Unexpected Redis EVAL status: ${code}`);
    }

    return NextResponse.json(
      {
        schemaVersion: 1,
        deviceId: DEVICE_ID,
        occurrenceId,
        status: "completed",
        completedAt: savedAt,
        scheduleVersion,
        alreadyCompleted: code === "ALREADY_COMPLETED",
      },
      { status: 200, headers: responseHeaders },
    );
  } catch (error) {
    console.error("[Device Complete] Redis write error:", error);
    return NextResponse.json(
      { error: "DATABASE_ERROR" },
      { status: 500, headers: responseHeaders },
    );
  }
}
