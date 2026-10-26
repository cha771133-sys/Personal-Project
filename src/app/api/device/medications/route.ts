
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

import type {
  DeviceMedicationStore,
  DeviceMedicationResponse,
} from "@/types/device";

// ESP32 기기 1대
const DEVICE_ID = "PILLBOX-001";

// Redis에서 사용할 키
const REDIS_KEY =
  `device:${DEVICE_ID}:medications`;

// 매번 최신 데이터를 조회
export const dynamic = "force-dynamic";

// 응답 캐시 방지
const responseHeaders = {
  "Cache-Control": "private, no-store",
};

export async function GET(request: NextRequest) {

  // 1. 서버에 API 인증 토큰이 설정되어 있는지 확인
  const expectedToken = process.env.DEVICE_API_TOKEN;

  if (!expectedToken) {
    console.error("DEVICE_API_TOKEN is not configured");

    return NextResponse.json(
      { error: "SERVER_NOT_CONFIGURED" },
      {
        status: 503,
        headers: responseHeaders,
      }
    );
  }

  // 2. ESP32가 보낸 인증 토큰 검사
  const authorization =
    request.headers.get("authorization");

  if (authorization !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      {
        status: 401,
        headers: responseHeaders,
      }
    );
  }

  try {

    // 3. Redis에서 복약 일정 조회
    const stored =
      await redis.get<DeviceMedicationStore>(
        REDIS_KEY
      );

    // 4. 저장된 데이터 형식 검사
    if (
      stored !== null &&
      (
        !Array.isArray(stored.medications) ||
        typeof stored.scheduleVersion !== "number"
      )
    ) {
      console.error("Invalid medication data in Redis");

      return NextResponse.json(
        { error: "INVALID_STORED_DATA" },
        {
          status: 500,
          headers: responseHeaders,
        }
      );
    }

    // 5. ESP32로 전송할 JSON 생성
    const response: DeviceMedicationResponse = {
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      timezone: "Asia/Seoul",
      scheduleVersion: stored?.scheduleVersion ?? 0,
      generatedAt: new Date().toISOString(),
      medications: stored?.medications ?? [],
    };

    console.log(
      `[Device API] ${DEVICE_ID}:`,
      response.medications.length,
      "medications"
    );

    // 6. JSON 응답
    return NextResponse.json(
      response,
      {
        status: 200,
        headers: responseHeaders,
      }
    );

  } catch (error) {

    console.error(
      "[Device API] Redis read error:",
      error
    );

    return NextResponse.json(
      { error: "DATABASE_ERROR" },
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
}
