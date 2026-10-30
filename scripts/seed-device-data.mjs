import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const key = "device:PILLBOX-001:medications";

const testData = {
  scheduleVersion: 1,
  medications: [
    {
      occurrenceId: "demo-20261028-0800",
      medicationId: "demo-med-001",
      name: "통신 테스트",
      dose: "테스트용 데이터",
      scheduledAt: "2026-10-28T08:00:00+09:00",
      instruction: "실제 복용하지 않는 가상 데이터",
      pillColor: "#FFFFFF",
      pillShape: "round",
      status: "pending",
    },
  ],
};

const result = await redis.set(key, testData, {
  nx: true,
});

if (result === "OK") {
  console.log("테스트 복약 데이터 저장 성공!");
} else {
  console.log("이미 데이터가 있어서 덮어쓰지 않았습니다.");
}