import "server-only";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const DEVICE_ID = "PILLBOX-001";
const REDIS_KEY = `device:${DEVICE_ID}:medications`;

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store",
};

// Redis에서 복약 완료 변경과 약 정보 조회를 원자적으로 처리합니다.
// status, completedAt, scheduleVersion, name, dose, scheduledAt 총 6개 값을 반환합니다.
// 반복 요청이라도 동일한 completedAt을 유지합니다.
const COMPLETE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'NO_SCHEDULE', '', '0', '', '', ''}
end

local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.medications) ~= 'table'
  or type(data.scheduleVersion) ~= 'number' then
  return {'INVALID_STORED_DATA', '', '0', '', '', ''}
end

for _, medication in ipairs(data.medications) do
  if type(medication) ~= 'table' then
    return {'INVALID_STORED_DATA', '', '0', '', '', ''}
  end

  if medication.occurrenceId == ARGV[1] then
    if type(medication.name) ~= 'string' or type(medication.dose) ~= 'string'
      or type(medication.scheduledAt) ~= 'string' then
      return {'INVALID_STORED_DATA', '', '0', '', '', ''}
    end

    if medication.status == 'completed' then
      return {
        'ALREADY_COMPLETED', medication.completedAt or '',
        tostring(data.scheduleVersion), medication.name,
        medication.dose, medication.scheduledAt
      }
    end

    if medication.status ~= 'pending' then
      return {'INVALID_STORED_DATA', '', '0', '', '', ''}
    end

    medication.status = 'completed'
    medication.completedAt = ARGV[2]
    data.scheduleVersion = data.scheduleVersion + 1

    redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
    return {
      'COMPLETED', ARGV[2], tostring(data.scheduleVersion),
      medication.name, medication.dose, medication.scheduledAt
    }
  end
end

return {'NOT_FOUND', '', '0', '', '', ''}
`;

const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type MedicationInfo = {
  occurrenceId: string;
  name: string;
  dose: string;
  scheduledAt: string;
  completedAt: string;
};

function koreanCompletionTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Telegram의 sendMessage 성공이 확인된 이후에만 '전송 완료' 키를 기록합니다.
// 동일 occurrenceId가 다시 POST돼도 이미 전송한 알림은 건너뜁니다.
// 실패 시 ESP32가 완료 요청을 재전송하도록 HTTP 503을 반환합니다.
async function notifyTelegramCompletion(info: MedicationInfo): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error("[Device Complete Telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing");
    return false;
  }

  const sentKey = `device:${DEVICE_ID}:telegram:completion:sent:${info.occurrenceId}`;
  const lockKey = `device:${DEVICE_ID}:telegram:completion:lock:${info.occurrenceId}`;
  const lockValue = randomUUID();

  try {
    if (await redis.get(sentKey)) return true;

    // 같은 복용 완료 요청이 동시에 도착할 때 중복 발송을 방지합니다.
    const acquired = await redis.set(lockKey, lockValue, { nx: true, ex: 30 });
    if (acquired !== "OK") return false;

    try {
      if (await redis.get(sentKey)) return true;

      const message = [
        "✅ 약속 복약 완료 알림",
        "",
        `약 이름: ${info.name}`,
        `복용량: ${info.dose}`,
        `예정 시각: ${info.scheduledAt.slice(0, 16).replace("T", " ")}`,
        `완료 시각: ${koreanCompletionTime(info.completedAt)}`,
        `기기: ${DEVICE_ID}`,
      ].join("\n");

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: message }),
          signal: AbortSignal.timeout(7000),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" ||
          (payload as { ok?: boolean }).ok !== true) {
        console.error("[Device Complete Telegram] sendMessage rejected", {
          httpStatus: response.status,
          occurrenceId: info.occurrenceId,
        });
        return false;
      }

      // 완료 ID는 재등록마다 달라집니다. 중복 방지 기록은 90일 유지합니다.
      await redis.set(sentKey, "sent", { ex: 90 * 24 * 60 * 60 });
      console.log("[Device Complete Telegram] SENT", info.occurrenceId);
      return true;
    } finally {
      await redis.eval(UNLOCK_LUA, [lockKey], [lockValue]).catch(error => {
        console.error("[Device Complete Telegram] unlock failed", error);
      });
    }
  } catch (error) {
    console.error("[Device Complete Telegram] delivery failed", error);
    return false;
  }
}

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
    const completedAt = new Date().toISOString();
    const result: unknown = await redis.eval(
      COMPLETE_LUA,
      [REDIS_KEY],
      [occurrenceId, completedAt],
    );

    if (!Array.isArray(result) || result.length !== 6) {
      console.error("[Device Complete] Unexpected EVAL result shape", {
        isArray: Array.isArray(result),
        valueType: typeof result,
      });
      throw new Error("Unexpected Redis EVAL response");
    }

    const [rawCode, rawSavedAt, rawVersion, rawName, rawDose, rawScheduledAt] = result as unknown[];
    if (
      typeof rawCode !== "string" ||
      typeof rawSavedAt !== "string" ||
      (typeof rawVersion !== "string" && typeof rawVersion !== "number") ||
      typeof rawName !== "string" ||
      typeof rawDose !== "string" ||
      typeof rawScheduledAt !== "string"
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

    // Redis의 복용 완료 기록은 이미 확정되었습니다.
    // Telegram 실패 시 503 -> ESP32의 NVS 큐가 요청을 보존하고 15초 후 재전송합니다.
    const telegramSent = await notifyTelegramCompletion({
      occurrenceId,
      name: rawName,
      dose: rawDose,
      scheduledAt: rawScheduledAt,
      completedAt: savedAt,
    });
    if (!telegramSent) {
      return NextResponse.json(
        {
          error: "TELEGRAM_DELIVERY_PENDING",
          occurrenceId,
          status: "completed",
          completionRecorded: true,
          telegramSent: false,
        },
        { status: 503, headers: responseHeaders },
      );
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
        telegramSent: true,
      },
      { status: 200, headers: responseHeaders },
    );
  } catch (error) {
    console.error("[Device Complete] Redis write or notify error:", error);
    return NextResponse.json(
      { error: "DATABASE_ERROR" },
      { status: 500, headers: responseHeaders },
    );
  }
}
