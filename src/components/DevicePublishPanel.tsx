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
type DemoResponse = {
  success?: boolean;
  scheduledAt?: string;
  scheduleVersion?: number;
  occurrenceId?: string;
  error?: string;
};

export default function DevicePublishPanel({ medications }: { medications: Medication[] }) {
  const [token, setToken] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [demoSending, setDemoSending] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");
  const [demoError, setDemoError] = useState(false);

  async function publish() {
    if (sending || demoSending || medications.length === 0 || !token) return;
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

  async function startDemo90() {
    if (sending || demoSending || medications.length === 0 || !token.trim()) return;
    const med = medications[0];
    const name = (med.drug_name_simple || med.drug_name || "").trim();
    const dose = (med.dosage || "").trim();
    if (!name || !dose) {
      setDemoError(true);
      setDemoMessage("첫 번째 약 이름/복용량을 확인하세요.");
      return;
    }
    if (!window.confirm(
      `학술제 시연용으로 ${name} (${dose}) 알람을 90초 뒤 한 번 실행할까요?\n` +
      "LCD와 Telegram에 시연용 알림이 생성됩니다. 실제 약은 복용하지 마세요."
    )) return;
    setDemoSending(true);
    setDemoError(false);
    setDemoMessage("");
    try {
      const res = await fetch("/api/demo/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirmed: true, name, dose }),
        cache: "no-store",
      });
      const data: DemoResponse = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const time = data.scheduledAt?.slice(11, 19) || "(시각 확인 필요)";
      setDemoMessage(
        `${name} (${dose}) · 한국시간 ${time} 알람 예약됨. ` +
        "이 시각에 LCD와 Telegram을 확인하세요. 그 뒤 LCD에서 복용 완료를 눌러주세요."
      );
    } catch (error) {
      setDemoError(true);
      setDemoMessage(error instanceof Error ? `90초 시연 실패: ${error.message}` : "시연 예약에 실패했습니다.");
    } finally {
      setDemoSending(false);
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
        정규 일정 등록은 기존 테스트 일정과 완료 표시를 교체합니다.
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
        disabled={sending || demoSending || !token || medications.length === 0}
        className="w-full py-4 rounded-xl bg-blue-700 text-white font-bold disabled:opacity-50"
      >
        {sending ? "등록 중..." : `선택한 약 ${medications.length}종을 스마트 약통에 등록`}
      </button>
      {message && <p role="status" className={`text-sm ${isError ? "text-red-700" : "text-green-700"}`}>{message}</p>}

      <div className="border-t border-blue-200 pt-4 space-y-2">
        <h3 className="text-lg font-bold text-blue-900">학술제 90초 시연 모드</h3>
        <p className="text-sm text-gray-700">
          최종 확인된 목록의 첫 번째 약으로 90초 뒤 LCD 알람과 Telegram 알림을 각각 한 번 예약합니다.
          정규 처방 일정은 삭제하지 않으며, 시연 중 실제 약을 복용하지 않습니다.
        </p>
        <p className="text-xs text-orange-800">
          정규 일정 등록 후 토큰이 지워졌다면 위 입력칸에 토큰을 다시 입력하세요.
        </p>
        <button
          type="button"
          onClick={startDemo90}
          disabled={sending || demoSending || !token.trim() || medications.length === 0}
          className="w-full py-4 rounded-xl bg-orange-600 text-white font-bold disabled:opacity-50"
        >
          {demoSending ? "90초 시연 예약 중..." : "90초 뒤 복약 시연 시작"}
        </button>
        {demoMessage && (
          <p role="status" className={`rounded-lg p-3 text-sm font-semibold ${demoError ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
            {demoMessage}
          </p>
        )}
      </div>
    </section>
  );
}
