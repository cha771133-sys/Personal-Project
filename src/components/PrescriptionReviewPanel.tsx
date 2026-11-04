"use client";

import { useState } from "react";
import type { Medication } from "@/types/prescription";

type DraftMedication = {
  drug_name: string;
  drug_name_simple: string;
  dosage: string;
  duration_days: string;
  timing: string;
  senior_friendly_instruction: string;
  alert_times: string[];
};

type Props = {
  medications: Medication[];
  confirmed: boolean;
  onDirty: () => void;
  onConfirm: (medications: Medication[]) => boolean;
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function makeDraft(medications: Medication[]): DraftMedication[] {
  return medications.map(m => ({
    drug_name: m.drug_name ?? "",
    drug_name_simple: m.drug_name_simple ?? "",
    dosage: m.dosage ?? "",
    duration_days: m.duration_days === undefined || m.duration_days === null
      ? "" : String(m.duration_days),
    timing: m.timing ?? "",
    senior_friendly_instruction: m.senior_friendly_instruction ?? "",
    alert_times: Array.isArray(m.alert_times) && m.alert_times.length > 0
      ? [...m.alert_times]
      : [""],
  }));
}

function validate(medications: DraftMedication[]): string | null {
  if (medications.length < 1 || medications.length > 16) {
    return "등록할 약은 1~16종이어야 합니다.";
  }
  const names = new Set<string>();
  for (let i = 0; i < medications.length; i++) {
    const m = medications[i];
    const n = i + 1;
    if (!m.drug_name.trim() || m.drug_name.trim().length > 100) {
      return `${n}번 약: 정확한 약 이름을 1~100자로 입력하세요.`;
    }
    const simple = m.drug_name_simple.trim();
    if (!simple || simple.length > 100) {
      return `${n}번 약: 쉬운 약 이름을 1~100자로 입력하세요.`;
    }
    if (names.has(simple)) {
      return `쉬운 약 이름 '${simple}'이(가) 중복됩니다. 약마다 구분되는 이름을 사용하세요.`;
    }
    names.add(simple);
    if (!m.dosage.trim() || m.dosage.trim().length > 100) {
      return `${n}번 약: 복용량을 1~100자로 입력하세요.`;
    }
    if (!/^\d+$/.test(m.duration_days.trim())) {
      return `${n}번 약: 복용 기간을 숫자(일수)로 입력하세요.`;
    }
    const days = Number(m.duration_days.trim());
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
      return `${n}번 약: 복용 기간은 1~365일입니다. 실제 처방 기간을 확인하세요.`;
    }
    if (m.alert_times.length < 1 || m.alert_times.length > 4) {
      return `${n}번 약: 복용 시간은 1~4개 입력하세요.`;
    }
    if (m.alert_times.some(t => !TIME_PATTERN.test(t))) {
      return `${n}번 약: 복용 시간을 HH:MM 형식으로 입력하세요.`;
    }
    if (new Set(m.alert_times).size !== m.alert_times.length) {
      return `${n}번 약: 중복된 복용 시간이 있습니다.`;
    }
    if (m.timing.length > 100 || m.senior_friendly_instruction.length > 250) {
      return `${n}번 약: 복용 시점 또는 안내 문구가 너무 깁니다.`;
    }
  }
  return null;
}

export default function PrescriptionReviewPanel({
  medications, confirmed, onDirty, onConfirm,
}: Props) {
  const [draft, setDraft] = useState<DraftMedication[]>(() => makeDraft(medications));
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [expandedIndex, setExpandedIndex] = useState(0);

  function change(index: number, field: keyof Omit<DraftMedication, "alert_times">, value: string) {
    setDraft(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m));
    setAcknowledged(false);
    setError("");
    onDirty();
  }

  function changeTime(index: number, timeIndex: number, value: string) {
    setDraft(prev => prev.map((m, i) => i === index
      ? { ...m, alert_times: m.alert_times.map((t, j) => j === timeIndex ? value : t) }
      : m));
    setAcknowledged(false);
    setError("");
    onDirty();
  }

  function addTime(index: number) {
    const next = draft[index];
    if (next.alert_times.length >= 4) return;
    setDraft(prev => prev.map((m, i) => i === index
      ? { ...m, alert_times: [...m.alert_times, ""] } : m));
    setAcknowledged(false);
    setError("");
    onDirty();
  }

  function removeTime(index: number, timeIndex: number) {
    if (draft[index].alert_times.length <= 1) return;
    setDraft(prev => prev.map((m, i) => i === index
      ? { ...m, alert_times: m.alert_times.filter((_, j) => j !== timeIndex) }
      : m));
    setAcknowledged(false);
    setError("");
    onDirty();
  }

  function confirm() {
    setError("");
    const issue = validate(draft);
    if (issue) { setError(issue); return; }
    if (!acknowledged) {
      setError("원본 처방전과 대조했음을 먼저 체크하세요.");
      return;
    }
    const updated = medications.map((m, i) => ({
      ...m,
      drug_name: draft[i].drug_name.trim(),
      drug_name_simple: draft[i].drug_name_simple.trim(),
      dosage: draft[i].dosage.trim(),
      duration_days: Number(draft[i].duration_days.trim()),
      timing: draft[i].timing.trim(),
      senior_friendly_instruction: draft[i].senior_friendly_instruction.trim(),
      alert_times: [...draft[i].alert_times].sort(),
      frequency: draft[i].alert_times.length,
    }));
    if (!onConfirm(updated)) {
      setError("수정된 처방 정보 저장에 실패했습니다. 브라우저 저장 공간을 확인하세요.");
    }
  }

  const fieldClass = "w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <section className="rounded-2xl border-2 border-blue-300 bg-white p-5 space-y-4" aria-label="처방전 분석 결과 수정 및 확인">
      <div className="space-y-1">
        <h2 className="text-xl font-black text-gray-900">처방전 분석 결과 수정·확인</h2>
        <p className="text-sm text-gray-700">
          AI가 추출한 내용은 틀릴 수 있습니다. 원본 처방전과 비교하여 약 이름,
          1회 복용량, 복용 시간, 복용 기간을 확인하거나 수정하세요.
        </p>
      </div>
      <div className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 space-y-1">
        <p className="font-bold">안전 확인</p>
        <p>복용량·시간·기간을 추측해서 입력하지 마세요. 확인할 수 없다면 처방 의료기관 또는 약사에게 문의하세요.</p>
        <p>Telegram/QStash 알림은 분석 직후 자동 예약되지 않습니다. 최종 확인 후 아래 알림 설정에서 관리자 토큰을 입력하고 Telegram/QStash 알림 예약·갱신 버튼을 눌러 등록하세요. 기존 예약은 새로 등록할 때까지 유지될 수 있습니다.
        {/* CONFIRMED_NOTIFICATIONS_V1 */}</p>
      </div>

      {draft.map((m, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={() => setExpandedIndex(expandedIndex === i ? -1 : i)}
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl p-3 text-left"
            aria-expanded={expandedIndex === i}
          >
            <span className="font-bold text-gray-900">{i + 1}번 약 · {m.drug_name_simple || "이름 확인 필요"}</span>
            <span className="shrink-0 text-sm font-semibold text-blue-700">{expandedIndex === i ? "접기 ▲" : "수정 ▼"}</span>
          </button>
          {expandedIndex === i && (
            <div className="space-y-3 border-t border-gray-200 p-3">
              <div>
                <label htmlFor={`review-drug-${i}`} className="mb-1 block text-sm font-semibold text-gray-800">정확한 약 이름</label>
                <input id={`review-drug-${i}`} className={fieldClass} maxLength={100}
                  value={m.drug_name} onChange={e => change(i, "drug_name", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`review-simple-${i}`} className="mb-1 block text-sm font-semibold text-gray-800">화면에 표시할 쉬운 약 이름</label>
                <input id={`review-simple-${i}`} className={fieldClass} maxLength={100}
                  value={m.drug_name_simple} onChange={e => change(i, "drug_name_simple", e.target.value)} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`review-dose-${i}`} className="mb-1 block text-sm font-semibold text-gray-800">1회 복용량</label>
                  <input id={`review-dose-${i}`} className={fieldClass} maxLength={100}
                    value={m.dosage} onChange={e => change(i, "dosage", e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`review-days-${i}`} className="mb-1 block text-sm font-semibold text-gray-800">복용 기간 (일)</label>
                  <input id={`review-days-${i}`} type="number" inputMode="numeric" min="1" max="365" step="1"
                    className={fieldClass} value={m.duration_days}
                    onChange={e => change(i, "duration_days", e.target.value)} />
                  {Number(m.duration_days) > 365 && <p className="mt-1 text-sm font-semibold text-red-700">365일 초과: 원본 처방 기간을 확인하세요.</p>}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-800">복용 시간 (최대 4개)</label>
                <div className="space-y-2">
                  {m.alert_times.map((time, timeIndex) => (
                    <div key={timeIndex} className="flex items-center gap-2">
                      <label htmlFor={`review-time-${i}-${timeIndex}`} className="sr-only">{i + 1}번 약 {timeIndex + 1}번째 복용 시간</label>
                      <input id={`review-time-${i}-${timeIndex}`} type="time" step="60"
                        className={fieldClass} value={time}
                        onChange={e => changeTime(i, timeIndex, e.target.value)} />
                      <button type="button" disabled={m.alert_times.length === 1}
                        onClick={() => removeTime(i, timeIndex)}
                        className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40">
                        삭제
                      </button>
                    </div>
                  ))}
                  <button type="button" disabled={m.alert_times.length >= 4} onClick={() => addTime(i)}
                    className="rounded-lg border border-blue-400 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800 disabled:opacity-40">
                    + 복용 시간 추가
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor={`review-timing-${i}`} className="mb-1 block text-sm font-semibold text-gray-800">복용 시점 안내 (예: 아침 식후)</label>
                <input id={`review-timing-${i}`} className={fieldClass} maxLength={100}
                  value={m.timing} onChange={e => change(i, "timing", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`review-instruction-${i}`} className="mb-1 block text-sm font-semibold text-gray-800">쉬운 복용 안내 문구</label>
                <textarea id={`review-instruction-${i}`} rows={2} maxLength={250} className={fieldClass}
                  value={m.senior_friendly_instruction}
                  onChange={e => change(i, "senior_friendly_instruction", e.target.value)} />
              </div>
              <p className="text-xs text-gray-600">입력한 복용 시간 수에 따라 하루 복용 횟수가 자동 계산됩니다.</p>
            </div>
          )}
        </div>
      ))}

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-800">
        <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-blue-700" />
        <span>모든 약의 이름·복용량·복용 시간·복용 기간을 원본 처방전과 대조했고, 확인된 내용만 등록하겠습니다.</span>
      </label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <button type="button" onClick={confirm} disabled={!acknowledged}
        className="w-full rounded-xl bg-blue-700 px-4 py-4 text-lg font-bold text-white disabled:opacity-40">
        수정 내용 저장 및 최종 확인
      </button>
      {confirmed && (
        <div role="status" className="rounded-xl border border-green-400 bg-green-50 p-3 text-sm font-bold text-green-800">
          확인 완료 · 아래 약 목록과 스마트 약통 등록에 수정된 정보가 적용됐습니다.
        </div>
      )}
    </section>
  );
}
