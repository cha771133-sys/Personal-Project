import { Redis } from "@upstash/redis";

// 기존 Personal-Project의 .env.local에 담긴 Upstash 인증 정보만 사용합니다.
const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
if (!url || !token) {
  console.error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 없습니다.");
  process.exit(1);
}

const redis = new Redis({ url, token });
const key = "device:PILLBOX-001:medications";
let stored = await redis.get(key);
if (typeof stored === "string") {
  try { stored = JSON.parse(stored); }
  catch { console.error("기존 데이터가 올바른 JSON이 아닙니다. 중단합니다."); process.exit(1); }
}

// 실제 처방전이나 다른 기기 일정을 절대 덮어쓰지 않도록 엄격하게 검증합니다.
if (!stored || !Array.isArray(stored.medications) || stored.medications.length !== 1 ||
    stored.medications[0]?.medicationId !== "demo-med-001" ||
    stored.medications[0]?.name !== "통신 테스트" ||
    typeof stored.scheduleVersion !== "number") {
  console.error("기존 데이터가 예상한 1개짜리 데모 일정이 아닙니다. 덮어쓰지 않고 중단합니다.");
  process.exit(1);
}

// 실행한 시점 기준 약 3~4분 뒤의 정각 분으로 설정합니다.
const targetUtcMs = Math.ceil((Date.now() + 3 * 60_000) / 60_000) * 60_000;
const targetKst = new Date(targetUtcMs + 9 * 60 * 60_000);
const scheduledAt = targetKst.toISOString().slice(0, 19) + "+09:00";
const occurrenceId = "demo-" + scheduledAt.slice(0, 10).replaceAll("-", "") + "-" +
  scheduledAt.slice(11, 16).replace(":", "");

const previous = stored.medications[0];
const updated = {
  scheduleVersion: stored.scheduleVersion + 1,
  medications: [{
    ...previous,
    occurrenceId,
    scheduledAt,
    status: "pending",
    instruction: "자동 알람 기능을 확인하기 위한 가상 데이터. 실제 복용 금지",
  }],
};
await redis.set(key, updated);
console.log("데모 일정 갱신 성공:", scheduledAt);
console.log("예정 시각: 한국 시간(KST), 약 3~4분 후");
console.log("scheduleVersion:", updated.scheduleVersion);
console.log("실제 처방전이 아닌 테스트 데이터입니다.");
