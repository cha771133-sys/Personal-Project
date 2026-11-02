'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import DeviceCalendarPanel, { type DeviceCalendarEntry } from '@/components/DeviceCalendarPanel';
import { useVoiceGuide } from '@/hooks/useVoiceGuide';
import type { AnalyzeResponse, Medication, MedicationCheckState } from '@/types/prescription';
import type { PillInfoResult } from '@/app/api/pill-info/route';
import { loadChecks, saveChecks, toggleCheck as toggleCheckState } from '@/lib/checkStorage';
import { getTimeLabel } from '@/lib/timeLabel';
import { notifyGuardianCheck, notifyPatientCheck } from '@/lib/guardianNotify';

// ── localStorage 키 ─────────────────────────────────────────
const CALENDAR_KEY = 'yaksouk_calendar';

type DayRecord = Record<string, boolean>; // { "약이름": true }
type CalendarData = Record<string, DayRecord>; // { "2026-02-26": { ... } }

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadCalendar(): CalendarData {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(CALENDAR_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCalendar(data: CalendarData): void {
  localStorage.setItem(CALENDAR_KEY, JSON.stringify(data));
}

// ── 달력 유틸 ────────────────────────────────────────────────
function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const total = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= total; d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=일
}

// ── 컴포넌트 ─────────────────────────────────────────────────
export default function CalendarPage() {
  const router = useRouter();
  const { speak } = useVoiceGuide();

  const today = new Date();
  const todayKey = toDateKey(today);

  const [medications, setMedications] = useState<Medication[]>([]);
  const [calendarData, setCalendarData] = useState<CalendarData>({});
  // CALENDAR_SERVER_SYNC_V2: records are in memory only, not localStorage.
  const [serverEntries, setServerEntries] = useState<DeviceCalendarEntry[] | null>(null);
  // CALENDAR_WEB_COMPLETE_V3: authenticated web completion shares the ESP32 Redis store.
  const [serverToken, setServerToken] = useState("");
  const [serverRefreshVersion, setServerRefreshVersion] = useState(0);
  const [savingOccurrenceId, setSavingOccurrenceId] = useState<string | null>(null);
  const [serverWriteError, setServerWriteError] = useState("");
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  // drug_name → 낱알식별 정보 (없으면 null)
  const [pillInfoMap, setPillInfoMap] = useState<Record<string, PillInfoResult | null>>({});
  // 시간대별 복약 체크 상태 (localStorage에서 복원, SSR-safe)
  const [checkStates, setCheckStates] = useState<MedicationCheckState[]>(
    () => loadChecks(todayKey)
  );

  // 처방전 데이터 로드 + 뷰 모드 복원
  useEffect(() => {
    const stored = sessionStorage.getItem('yaksouk_result');
    if (stored) {
      try {
        const parsed: AnalyzeResponse = JSON.parse(stored);
        if (parsed.data?.medications) {
          setMedications(parsed.data.medications);
        }
      } catch { /* ignore */ }
    }
    setCalendarData(loadCalendar());

    // localStorage는 클라이언트에서만 접근 가능하므로 mount 시 재로드
    setCheckStates(loadChecks(todayKey));
  }, [todayKey]);

  // 약 목록이 로드되면 낱알식별 정보 병렬 페치 (실패 시 조용히 무시)
  useEffect(() => {
    if (medications.length === 0) return;
    const fetchAll = async () => {
      const entries = await Promise.all(
        medications.map(async (med) => {
          try {
            const res = await fetch(
              `/api/pill-info?itemName=${encodeURIComponent(med.drug_name)}`
            );
            const data: PillInfoResult | null = res.ok ? await res.json() : null;
            return [med.drug_name, data] as const;
          } catch {
            return [med.drug_name, null] as const;
          }
        })
      );
      setPillInfoMap(Object.fromEntries(entries));
    };
    fetchAll();
  }, [medications]);

  // 서버 일정은 브라우저의 로컬 체크 대신 occurrenceId로 정확히 완료 처리합니다.
  const completeServerOccurrence = useCallback(async (entry: DeviceCalendarEntry) => {
    if (savingOccurrenceId !== null) return;
    if (!serverToken) {
      window.alert("먼저 관리자 토큰으로 서버 기록을 불러와 주세요.");
      return;
    }
    if (entry.status === "completed") return;
    if (Date.parse(entry.scheduledAt) > Date.now()) {
      window.alert("아직 복약 예정 시간이 되지 않았습니다.");
      return;
    }
    if (!window.confirm(`${entry.name} (${entry.scheduledAt.slice(0, 16).replace("T", " ")}) 복용을 완료하셨나요?\n서버에 기록한 완료 상태는 이 화면에서 취소할 수 없습니다.`)) return;

    setSavingOccurrenceId(entry.occurrenceId);
    setServerWriteError("");
    try {
      const response = await fetch("/api/device/calendar/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverToken}`,
        },
        body: JSON.stringify({ occurrenceId: entry.occurrenceId }),
        cache: "no-store",
      });
      const body: { error?: string; completedAt?: string; status?: string } = await response.json();
      if (!response.ok || body.status !== "completed") {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      // Only update the UI after server confirmation. Then re-read to verify.
      setServerEntries(previous => previous?.map(record =>
        record.occurrenceId === entry.occurrenceId
          ? { ...record, status: "completed", completedAt: body.completedAt ?? null }
          : record
      ) ?? null);
      setServerRefreshVersion(v => v + 1);
      speak(`${entry.name} 복약 완료가 서버에 기록됐습니다.`);
    } catch (error) {
      setServerWriteError(error instanceof Error ? error.message : "서버 저장 실패");
    } finally {
      setSavingOccurrenceId(null);
    }
  }, [savingOccurrenceId, serverToken, speak]);

  // 시간대별 체크 핸들러 — calendarData(달력 도트)도 함께 동기화
  const handleTimeCheck = useCallback((
    drugName: string,
    alertTime: string,
    checked: boolean
  ) => {
    const med = medications.find(m => m.drug_name === drugName);
    const matches = serverEntries?.filter(entry =>
      entry.name === med?.drug_name_simple &&
      entry.scheduledAt.slice(0, 10) === todayKey &&
      entry.scheduledAt.slice(11, 16) === alertTime
    ) ?? [];
    if (serverEntries !== null && matches.length > 0) {
      if (!checked) {
        window.alert("서버에 기록된 완료 상태는 이 화면에서 해제할 수 없습니다.");
        return;
      }
      if (matches.length !== 1) {
        window.alert("일치하는 서버 복약 일정이 여러 개여서 완료 처리하지 않았습니다.");
        return;
      }
      void completeServerOccurrence(matches[0]);
      return;
    }
    // 서버 일정과 일치하지 않는 체크는 기존처럼 브라우저에만 저장합니다.
    const newStates = toggleCheckState(checkStates, drugName, alertTime, checked);
    setCheckStates(newStates);
    saveChecks(todayKey, newStates);

    // 해당 약의 모든 시간대가 완료됐는지 계산해 calendarData 도트 업데이트
    const medObj = medications.find(m => m.drug_name === drugName);
    const allTimes = medObj?.alert_times?.length ? medObj.alert_times : [''];
    const drugState = newStates.find(s => s.drugName === drugName);
    const allTimesChecked = allTimes.every(t => drugState?.checks[t] === true);

    setCalendarData(prev => {
      const updated = { ...prev };
      const day = { ...(updated[todayKey] ?? {}) };
      day[drugName] = allTimesChecked;
      updated[todayKey] = day;
      saveCalendar(updated);
      return updated;
    });

    if (checked) {
      speak(`${drugName} ${alertTime} 복약 완료! 잘 하셨어요!`);
    }

    notifyGuardianCheck(drugName, alertTime, checked);
    notifyPatientCheck(drugName, alertTime, checked);
  }, [checkStates, todayKey, medications, speak, serverEntries, completeServerOccurrence]);

  // 이번 달 복약률 계산
  const calcAdherence = useCallback((): number | null => {
    if (serverEntries !== null) {
      // Only doses already due are in the denominator. No scheduled doses -> N/A.
      const month = String(viewYear) + '-' + String(viewMonth + 1).padStart(2, '0');
      const due = serverEntries.filter(entry =>
        entry.scheduledAt.startsWith(month) && Date.parse(entry.scheduledAt) <= Date.now()
      );
      if (due.length === 0) return null;
      const done = due.filter(entry => entry.status === 'completed').length;
      return Math.round((done / due.length) * 100);
    }
    if (medications.length === 0) return 0;
    const days = getDaysInMonth(viewYear, viewMonth);
    const pastDays = days.filter(d => toDateKey(d) <= todayKey && d.getMonth() === viewMonth);
    if (pastDays.length === 0) return 0;

    let total = 0;
    let checked = 0;
    for (const d of pastDays) {
      const key = toDateKey(d);
      const rec = calendarData[key] || {};
      for (const med of medications) {
        total++;
        if (rec[med.drug_name]) checked++;
      }
    }
    return total === 0 ? 0 : Math.round((checked / total) * 100);
  }, [calendarData, medications, viewYear, viewMonth, todayKey, serverEntries]);

  // 오늘 모든 약의 모든 시간대 완료 여부
  const todayDone = medications.length > 0 && medications.every(med => {
    const times = med.alert_times?.length ? med.alert_times : [''];
    const state = checkStates.find(s => s.drugName === med.drug_name);
    return times.every(t => {
      const serverMatch = serverEntries?.find(e =>
        e.name === med.drug_name_simple &&
        e.scheduledAt.slice(0, 10) === todayKey && e.scheduledAt.slice(11, 16) === t
      );
      return serverMatch ? serverMatch.status === "completed" : state?.checks[t] === true;
    });
  });

  const adherence = calcAdherence();
  const isServerMode = serverEntries !== null;
  const highAdherence = adherence !== null && adherence >= 80;
  const days = getDaysInMonth(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);
  const WEEK_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // 달력 날짜별 복약 상태
  const getDayStatus = (date: Date): 'done' | 'miss' | 'none' | 'scheduled' | 'partial' => {
    const key = toDateKey(date);
    if (serverEntries !== null) {
      const entries = serverEntries.filter(e => e.scheduledAt.slice(0, 10) === key);
      if (entries.length === 0) return 'none';
      if (key > todayKey) return 'scheduled';
      if (entries.every(e => e.status === 'completed')) return 'done';
      if (key < todayKey) return 'miss';
      return entries.some(e => e.status === 'completed') ? 'partial' : 'scheduled';
    }
    if (key > todayKey) return 'none'; // 미래
    if (medications.length === 0) return 'none';
    const rec = calendarData[key] || {};
    const allChecked = medications.every(m => rec[m.drug_name]);
    const anyChecked = medications.some(m => rec[m.drug_name]);
    if (allChecked) return 'done';
    if (anyChecked || key < todayKey) return 'miss';
    return 'none';
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] pb-28">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="w-12 h-12 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 text-xl"
            aria-label="뒤로가기"
          >
            ←
          </button>
          <h1 className="text-3xl font-black text-gray-900">📅 복약 기록</h1>
        </div>

        {/* 복약률 */}
        <div className={`rounded-2xl p-5 text-center shadow-sm ${
          highAdherence ? 'bg-green-50 border-2 border-green-400' : 'bg-orange-50 border-2 border-orange-400'
        }`}>
          <p className="text-lg font-semibold text-gray-600">{isServerMode ? '이번 달 스마트 약통 복약률' : '이번 달 복약률 (수동 기록)'}</p>
          <p className={`text-5xl font-black mt-1 ${highAdherence ? 'text-green-700' : 'text-orange-600'}`}>
            {adherence === null ? '—' : String(adherence) + '%'}
          </p>
          <p className="text-base text-gray-500 mt-1">
            {isServerMode
              ? (adherence === null
                  ? '이번 달에는 아직 복용 시간이 지난 서버 일정이 없습니다.'
                  : '복용 시각이 지난 서버 일정 중 완료된 비율입니다. (수동 체크 미포함)')
              : (highAdherence ? '정말 잘 챙겨 드시고 있어요 👏' : '조금 더 꼼꼼하게 챙겨봐요 💪')}
          </p>
        </div>

        {/* ESP32 / Redis: read-only server calendar */}
        <DeviceCalendarPanel
          onRecordsLoaded={setServerEntries}
          onAuthorizedToken={setServerToken}
          onCompleteRequest={(entry) => { void completeServerOccurrence(entry); }}
          savingOccurrenceId={savingOccurrenceId}
          refreshVersion={serverRefreshVersion}
        />
        {serverWriteError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            웹 복용 완료 저장 실패: {serverWriteError}
          </p>
        )}

        {/* 달력 */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          {/* 월 이동 */}
          <div className="flex items-center justify-between px-1">
            <button type="button" onClick={prevMonth}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-xl font-bold"
              aria-label="이전 달"
            >‹</button>
            <h2 className="text-xl font-bold text-gray-800">
              {viewYear}년 {viewMonth + 1}월
            </h2>
            <button type="button" onClick={nextMonth}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-xl font-bold"
              aria-label="다음 달"
            >›</button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 text-center">
            {WEEK_LABELS.map((w, i) => (
              <div key={w} className={`text-sm font-bold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}>
                {w}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-y-1">
            {/* 첫 주 빈칸 */}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {days.map((date) => {
              const key = toDateKey(date);
              const isToday = key === todayKey;
              const status = getDayStatus(date);
              return (
                <div
                  key={key}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-sm font-semibold ${
                    isToday
                      ? 'bg-blue-700 text-white'
                      : 'text-gray-700'
                  }`}
                >
                  <span>{date.getDate()}</span>
                  {status === 'done' && <span className="text-xs leading-none">✅</span>}
                  {status === 'miss' && <span className="text-xs leading-none">❌</span>}
                  {status === 'scheduled' && <span className="text-xs leading-none text-blue-500" title="복약 일정 있음">●</span>}
                  {status === 'partial' && <span className="text-xs leading-none text-amber-600" title="일부 복용 완료">◐</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 오늘 복약 체크리스트 */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <h2 className="text-xl font-bold text-gray-800">
            오늘 복약 체크 ({today.getMonth() + 1}/{today.getDate()})
          </h2>
          {serverEntries !== null && (
            <p className="text-sm text-blue-800">
              스마트 약통에 등록된 약은 체크하면 Redis에도 기록됩니다.
              그 외 체크는 현재 브라우저에만 저장됩니다. 서버 완료는 취소할 수 없습니다.
            </p>
          )}

          {medications.length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <p className="text-lg text-gray-500">처방전을 먼저 분석해주세요</p>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="px-6 py-4 bg-blue-700 text-white text-lg font-bold rounded-2xl hover:bg-blue-800"
              >
                처방전 분석하러 가기
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {medications.map((med) => {
                const times = med.alert_times?.length
                  ? [...med.alert_times].sort()
                  : [''];
                const drugState = checkStates.find(s => s.drugName === med.drug_name);
                const allChecked = times.every(t => {
                  const serverMatch = serverEntries?.find(e =>
                    e.name === med.drug_name_simple &&
                    e.scheduledAt.slice(0, 10) === todayKey && e.scheduledAt.slice(11, 16) === t
                  );
                  return serverMatch ? serverMatch.status === "completed" : drugState?.checks[t] === true;
                });

                return (
                  <div
                    key={med.drug_name}
                    className={`rounded-2xl border-2 px-4 pt-4 pb-2 transition-all ${
                      allChecked ? 'bg-green-50 border-green-400' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    {/* 약 이름 (전체 완료 시 취소선) */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <p className={`text-[18px] font-bold ${
                        allChecked ? 'line-through text-gray-400' : 'text-gray-900'
                      }`}>
                        💊 {med.drug_name_simple}
                      </p>
                      {pillInfoMap[med.drug_name] && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-full text-xs font-medium text-blue-700 leading-none">
                          {[pillInfoMap[med.drug_name]!.color, pillInfoMap[med.drug_name]!.shape].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </div>

                    {/* 시간대별 체크박스 행 */}
                    <div className="divide-y divide-gray-100">
                      {times.map((alertTime) => {
                        const manualChecked = drugState?.checks[alertTime] === true;
                        const serverMatch = serverEntries?.find(e =>
                          e.name === med.drug_name_simple &&
                          e.scheduledAt.slice(0, 10) === todayKey &&
                          e.scheduledAt.slice(11, 16) === alertTime
                        );
                        const deviceChecked = serverMatch?.status === "completed";
                        const isChecked = serverMatch ? deviceChecked : manualChecked;
                        const notDue = serverMatch ? Date.parse(serverMatch.scheduledAt) > Date.now() : false;
                        const label = alertTime
                          ? `${getTimeLabel(alertTime)}  ${alertTime}`
                          : '복용';

                        return (
                          <label
                            key={alertTime}
                            className={`flex items-center gap-3 min-h-[56px] px-1 rounded-xl cursor-pointer transition-colors select-none ${
                              isChecked ? 'bg-green-50' : 'hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={deviceChecked || notDue || savingOccurrenceId !== null}
                              onChange={(e) =>
                                handleTimeCheck(med.drug_name, alertTime, e.target.checked)
                              }
                              className="w-6 h-6 rounded accent-blue-700 cursor-pointer flex-shrink-0"
                              aria-label={`${med.drug_name_simple} ${label} 복약 체크`}
                            />
                            <span className={`text-[18px] font-medium ${
                              isChecked ? 'line-through text-gray-400' : 'text-gray-800'
                            }`}>
                              {label}
                            </span>
                            {isChecked && (
                              <span className="ml-auto text-sm font-semibold text-green-600">
                                {deviceChecked ? '서버 완료 ✓' : '수동 완료(로컬) ✓'}
                              </span>
                            )}
                            {!isChecked && notDue && (
                              <span className="ml-auto text-xs text-blue-600">복약 예정</span>
                            )}
                            {!isChecked && serverMatch && !notDue && (
                              <span className="ml-auto text-xs text-blue-700">
                                {savingOccurrenceId === serverMatch.occurrenceId ? '서버 저장 중...' : '서버 기록 대상'}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {todayDone && (
                <div className="bg-green-100 border-2 border-green-500 rounded-2xl p-4 text-center">
                  <p className="text-2xl font-black text-green-800">오늘 약을 모두 드셨어요! 🎉</p>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      <BottomNav />
    </div>
  );
}
