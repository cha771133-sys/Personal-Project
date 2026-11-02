"use client";

import { useState } from "react";
import type { Medication } from "@/types/prescription";

type PublishResponse = {
  deviceId?: string;
  occurrenceCount?: number;
  scheduleVersion?: number;
  limitedToSevenDays?: boolean;
  error?: string;
};

export default function DevicePublishPanel({ medications }: { medications: Medication[] }) {
  const [token, setToken] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function publish() {
    if (sending || medications.length === 0 || !token) return;
    if (!window.confirm(
      "분석된 약 이름·복용량·복약 시간을 확인하셨나요?\n" +
      "기존 스마트 약통 일정은 새 일정으로 교체됩니다. 계속할까요?"
    )) return;

    setSending(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/device/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ confirmed: true, medications }),
        cache: "no-store",
      });
      const data: PublishResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage(
        `${data.deviceId}에 ${data.occurrenceCount}개 복약 일정이 등록됐습니다. ` +
        `버전 ${data.scheduleVersion}.` +
        (data.limitedToSevenDays ? " 현재 시험 버전은 최대 7일 일정만 등록합니다." : "")
      );
      setToken("");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? `등록 실패: ${error.message}` : "등록 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="bg-white border-2 border-blue-200 rounded-2xl p-5 space-y-3">
      <h2 className="text-xl font-bold text-gray-800">스마트 약통에 복약 일정 보내기</h2>
      <p className="text-sm text-gray-600">
        분석된 약 정보를 확인한 뒤 등록하세요. 현재 연결 기기는 PILLBOX-001이며,
        시험 버전은 앞으로 최대 7일의 일정만 전송합니다.
      </p>
      <p className="text-sm text-orange-800">
        등록하면 기존 테스트 일정과 완료 표시가 현재 일정 목록에서 교체됩니다.
        실제 처방전이라면 복용 시간과 복용량을 반드시 확인하세요.
      </p>
      <label htmlFor="device-publish-token" className="block text-sm font-semibold text-gray-800">
        관리자 등록 토큰 (DEVICE_PUBLISH_TOKEN)
      </label>
      <input
        id="device-publish-token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={e => setToken(e.target.value)}
        placeholder="Vercel에 등록한 별도 등록 토큰"
        className="w-full border rounded-xl px-4 py-3 text-base text-gray-900"
      />
      <button
        type="button"
        onClick={publish}
        disabled={sending || !token || medications.length === 0}
        className="w-full py-4 rounded-xl bg-blue-700 text-white font-bold disabled:opacity-50"
      >
        {sending ? "등록 중..." : `선택한 약 ${medications.length}종을 스마트 약통에 등록`}
      </button>
      {message && <p role="status" className={`text-sm ${isError ? "text-red-700" : "text-green-700"}`}>{message}</p>}
    </section>
  );
}
