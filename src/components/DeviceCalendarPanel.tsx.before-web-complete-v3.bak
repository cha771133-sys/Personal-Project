"use client";

import { useMemo, useState } from "react";

export type DeviceCalendarEntry = {
  occurrenceId: string;
  name: string;
  dose: string;
  scheduledAt: string;
  status: "pending" | "completed";
  completedAt: string | null;
};

type DeviceCalendarData = {
  deviceId: string;
  timezone: string;
  scheduleVersion: number;
  generatedAt: string;
  medications: DeviceCalendarEntry[];
};

type Props = {
  onRecordsLoaded?: (records: DeviceCalendarEntry[] | null) => void;
};

function readableTime(value: string): string {
  return value.slice(11, 16);
}

function completedTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function DeviceCalendarPanel({ onRecordsLoaded }: Props) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<DeviceCalendarData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadFromServer() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/device/calendar", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json: DeviceCalendarData & { error?: string } = await response.json();
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
      if (!Array.isArray(json.medications)) throw new Error("INVALID_RESPONSE");
      setData(json);
      onRecordsLoaded?.(json.medications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "NETWORK_ERROR");
      setData(null);
      onRecordsLoaded?.(null); // 조회 실패 시 기존 서버 상태를 남겨두지 않음
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, DeviceCalendarEntry[]>();
    for (const item of data?.medications ?? []) {
      const day = item.scheduledAt.slice(0, 10);
      const existing = map.get(day) ?? [];
      existing.push(item);
      map.set(day, existing);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const completed = data?.medications.filter(item => item.status === "completed").length ?? 0;
  const total = data?.medications.length ?? 0;

  return (
    <section className="rounded-2xl border-2 border-blue-200 bg-white p-5 space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-gray-900">스마트 약통 복약 기록 (서버)</h2>
        <p className="text-sm text-gray-600">
          서버 기록을 불러오면 달력의 날짜 표시와 오늘의 체크리스트에도
          ESP32 완료 상태가 반영됩니다. 수동 체크는 브라우저에만 저장됩니다.
        </p>
      </div>

      <label htmlFor="device-calendar-token" className="block text-sm font-semibold text-gray-800">
        관리자 토큰 (DEVICE_PUBLISH_TOKEN)
      </label>
      <input
        id="device-calendar-token" type="password" autoComplete="off"
        value={token} onChange={(e) => setToken(e.target.value)}
        placeholder="스마트 약통 등록 때 사용한 관리자 토큰"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900"
      />
      <button type="button" onClick={loadFromServer} disabled={!token || busy}
        className="w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">
        {busy ? "서버 기록 조회 중..." : data ? "서버 기록 새로고침" : "스마트 약통 기록 불러오기"}
      </button>

      {error && <p className="text-sm font-semibold text-red-700" role="alert">
        조회 실패: {error}
      </p>}

      {data && (
        <div className="space-y-4" aria-live="polite">
          <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <p className="font-bold">{data.deviceId} · 일정 버전 {data.scheduleVersion}</p>
            <p>총 {total}건 중 완료 {completed}건 / 미완료 {total - completed}건</p>
            <p className="mt-1 text-xs">달력: ● 예정 / ◐ 일부 완료 / ✅ 완료 / ❌ 지난 미완료</p>
          </div>

          {total === 0 ? (
            <p className="text-sm text-gray-500">기기에 등록된 일정이 없습니다.</p>
          ) : grouped.map(([day, items]) => (
            <div key={day} className="rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-gray-800">{day}</h3>
                <span className="text-xs text-gray-600">
                  {items.filter(item => item.status === "completed").length}/{items.length} 완료
                </span>
              </div>
              <ul className="divide-y divide-gray-100">
                {items.map((item) => (
                  <li key={item.occurrenceId} className="flex items-start justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">
                        {readableTime(item.scheduledAt)} · {item.name}
                      </p>
                      <p className="text-sm text-gray-600">복용량: {item.dose}</p>
                      {item.status === "completed" && item.completedAt && (
                        <p className="text-xs text-green-700">
                          완료 기록: {completedTime(item.completedAt)} (한국 시간)
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${
                      item.status === "completed"
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      {item.status === "completed" ? "복용 완료" : "미완료"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-gray-500">
            현재 Redis에 남아 있는 일정만 표시합니다. 새 처방전을 등록하면
            기존 일정 목록과 완료 기록은 교체될 수 있습니다.
          </p>
        </div>
      )}
    </section>
  );
}
