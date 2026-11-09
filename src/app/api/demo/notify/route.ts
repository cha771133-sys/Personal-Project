import "server-only";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { redis } from "@/lib/redis";
import type { DeviceMedicationStore } from "@/types/device";

export const dynamic = "force-dynamic";

const SCHEDULE_KEY = "device:PILLBOX-001:medications";
const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export async function POST(req: NextRequest) {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!current || !next || !chatId || !botToken) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  const body = await req.text();
  const signature = req.headers.get("upstash-signature") || "";
  const receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });
  if (!await receiver.verify({ body, signature }).catch(() => false)) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  let occurrenceId = "";
  try {
    const payload: unknown = JSON.parse(body);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const id = (payload as Record<string, unknown>).occurrenceId;
      if (typeof id === "string") occurrenceId = id;
    }
  } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  if (!/^demo-[a-f0-9-]{36}$/i.test(occurrenceId)) {
    return NextResponse.json({ error: "INVALID_DEMO_ID" }, { status: 400 });
  }

  // 메시지의 이름/복용량을 그대로 신뢰하지 않고 서버 일정과 대조합니다.
  const data = await redis.get<DeviceMedicationStore>(SCHEDULE_KEY);
  const item = data?.medications?.find(m => m.occurrenceId === occurrenceId);
  if (!item || item.status !== "pending") {
    return NextResponse.json({ skipped: true, reason: "not-pending-or-removed" });
  }
  if (Date.now() < Date.parse(item.scheduledAt)) {
    return NextResponse.json({ error: "BEFORE_DUE" }, { status: 503 });
  }

  const sentKey = `demo:telegram:sent:${occurrenceId}`;
  const lockKey = `demo:telegram:lock:${occurrenceId}`;
  if (await redis.get(sentKey)) return NextResponse.json({ success: true, duplicate: true });
  const lockValue = randomUUID();
  const acquired = await redis.set(lockKey, lockValue, { nx: true, ex: 30 });
  if (acquired !== "OK") return NextResponse.json({ error: "IN_PROGRESS" }, { status: 503 });

  try {
    if (await redis.get(sentKey)) return NextResponse.json({ success: true, duplicate: true });
    const formatted = item.scheduledAt.slice(0, 19).replace("T", " ");
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `💊 [약속 학술제 시연]\n복약 시간입니다!\n\n약 이름: ${item.name}\n복용량: ${item.dose}\n예정 시각: ${formatted} (한국 시간)\n\n※ 시연용 알림이며 실제 복용 지시가 아닙니다.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const responseData: unknown = await response.json();
    if (!response.ok || !responseData || typeof responseData !== "object" ||
      (responseData as {ok?: boolean}).ok !== true) {
      console.error("[90s demo] Telegram send failed", response.status);
      return NextResponse.json({ error: "TELEGRAM_SEND_FAILED" }, { status: 503 });
    }
    await redis.set(sentKey, "1", { ex: 7 * 24 * 60 * 60 });
    console.info("[90s demo] Telegram SENT", occurrenceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[90s demo] deliver error", error);
    return NextResponse.json({ error: "TELEGRAM_SEND_ERROR" }, { status: 503 });
  } finally {
    await redis.eval(UNLOCK_LUA, [lockKey], [lockValue]).catch(() => null);
  }
}
