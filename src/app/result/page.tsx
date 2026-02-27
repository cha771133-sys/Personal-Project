'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MedicationCard from '@/components/MedicationCard';
import BottomNav from '@/components/BottomNav';
import { useVoiceGuide } from '@/hooks/useVoiceGuide';
import { useNotification } from '@/hooks/useNotification';
import { saveHistory } from '@/lib/historyStorage';
import type { AnalyzeResponse, Medication } from '@/types/prescription';

type TelegramState = 'idle' | 'sending' | 'done' | 'error';
type ResultViewMode = 'list' | 'card';

const RESULT_VIEW_KEY = 'yaksouk_result_view';

/** Gemini 응답이 배열이 아닌 타입으로 올 때를 대비한 안전 변환 */
const toArray = (val: unknown): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'string') return val.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return [];
};

export default function ResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 약품별 알람 ON/OFF 상태 (기본값: 전체 ON)
  const [alarmEnabled, setAlarmEnabled] = useState<Record<string, boolean>>({});
  const [browserAlarmSet, setBrowserAlarmSet] = useState(false);
  const [isSetting, setIsSetting] = useState(false);

  // 텔레그램 상태
  const [telegramState, setTelegramState] = useState<TelegramState>('idle');
  const [scheduledCount, setScheduledCount] = useState(0);

  // 약 목록 뷰 모드
  const [resultView, setResultView] = useState<ResultViewMode>('list');
  const [cardIndex, setCardIndex] = useState(0);

  const { speak } = useVoiceGuide();
  const notification = useNotification();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // 뷰 모드 복원
    const savedView = localStorage.getItem(RESULT_VIEW_KEY) as ResultViewMode | null;
    if (savedView === 'list' || savedView === 'card') {
      setResultView(savedView);
    }

    const storedResult = sessionStorage.getItem('yaksouk_result');
    if (!storedResult) { router.push('/'); return; }

    try {
      const parsed: AnalyzeResponse = JSON.parse(storedResult);
      setResult(parsed);
      setIsLoading(false);

      if (parsed.data?.medications?.length) {
        // 히스토리 자동 저장 (처음 로드 시 1회)
        saveHistory(parsed.data);

        // 모든 약 알람 기본 ON
        const initial: Record<string, boolean> = {};
        parsed.data.medications.forEach(m => { initial[m.drug_name_simple] = true; });
        setAlarmEnabled(initial);

        // 첫 약 음성 안내
        const first = parsed.data.medications[0];
        const summary = `총 ${parsed.data.medications.length}가지 약을 분석했어요. 첫 번째 약은 ${first.drug_name_simple}이에요. ${first.senior_friendly_instruction}`;
        setTimeout(() => speak(summary), 800);
      }
    } catch {
      router.push('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 개별 약 알람 토글
  const toggleAlarm = (drugName: string) => {
    setAlarmEnabled(prev => ({ ...prev, [drugName]: !prev[drugName] }));
    // 브라우저 알람이 이미 설정된 경우 초기화 (재설정 유도)
    if (browserAlarmSet) {
      notification.cancelAllAlerts();
      setBrowserAlarmSet(false);
    }
  };

  const handleResultViewChange = (mode: ResultViewMode) => {
    setResultView(mode);
    setCardIndex(0);
    localStorage.setItem(RESULT_VIEW_KEY, mode);
  };

  // 브라우저 푸시 알람 설정 (ON 상태인 약만)
  const handleBrowserAlarm = async () => {
    if (!result?.data) return;
    setIsSetting(true);
    try {
      const selectedMeds = result.data.medications.filter(
        m => alarmEnabled[m.drug_name_simple] !== false
      );
      const count = await notification.registerMedicationAlerts(selectedMeds);
      if (count > 0) setBrowserAlarmSet(true);
    } finally {
      setIsSetting(false);
    }
  };

  // 예약 확인 메시지 즉시 발송 (약별 개별 발송은 QStash cron이 담당)
  const handleTelegram = async () => {
    if (!result?.data) return;
    setTelegramState('sending');
    try {
      const scheduleLines: string[] = [];

      for (const med of result.data.medications) {
        for (const time of toArray(med.alert_times)) {
          const [h, m] = time.split(':').map(Number);
          const rH = m >= 5 ? h : (h - 1 < 0 ? 23 : h - 1);
          const rM = m >= 5 ? m - 5 : 60 + m - 5;
          const rStr = `${String(rH).padStart(2, '0')}:${String(rM).padStart(2, '0')}`;
          scheduleLines.push(`• ${med.drug_name_simple} — ${rStr} 알림 (${time} 복용)`);
        }
      }

      const now = new Date();
      const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const confirmMsg =
        `✅ 복약 알림 예약이 완료됐어요!\n\n` +
        `📅 예약 시각: ${nowStr}\n\n` +
        `예약된 알림 목록:\n${scheduleLines.join('\n')}\n\n` +
        `복용 5분 전에 알림을 보내드릴게요 💊`;

      const res = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: confirmMsg }),
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message);

      setScheduledCount(scheduleLines.length);
      setTelegramState('done');
      setTimeout(() => setTelegramState('idle'), 5000);
    } catch (e) {
      console.error('텔레그램 예약 실패:', e);
      setTelegramState('error');
      setTimeout(() => setTelegramState('idle'), 4000);
    }
  };

  // ── 로딩 ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-700 border-t-transparent mx-auto" />
          <p className="text-xl text-gray-700 font-semibold">결과를 불러오는 중이에요...</p>
        </div>
      </div>
    );
  }

  if (!result?.data) return null;

  const { data } = result;
  const enabledCount = Object.values(alarmEnabled).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-[#f5f5f0] pb-28">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── 1. 상단 헤더 ─────────────────────────────── */}
        <div className="bg-green-100 border-2 border-green-500 rounded-2xl p-5 text-center space-y-1">
          <h1 className="text-3xl font-bold text-green-800">✅ 분석이 완료됐어요!</h1>
          {data.prescription_date && (
            <p className="text-lg text-green-700">📅 처방일: {data.prescription_date}</p>
          )}
          {data.patient_name && (
            <p className="text-lg text-green-700">👤 {data.patient_name}</p>
          )}
          {data.hospital && (
            <p className="text-lg text-green-700">🏥 {data.hospital}</p>
          )}
        </div>

        {/* ── 2. 약품 카드 목록 ─────────────────────────── */}
        <div className="space-y-4">
          {/* 헤더 + 뷰 모드 토글 */}
          <div className="flex items-center justify-between px-1">
            <h2 className="text-2xl font-bold text-gray-800">
              처방된 약 <span className="text-blue-700">{data.medications.length}종</span>
            </h2>
            <div className="flex gap-1 bg-gray-200 rounded-xl p-1">
              <button
                type="button"
                onClick={() => handleResultViewChange('list')}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  resultView === 'list'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                aria-label="리스트 뷰"
                aria-pressed={resultView === 'list'}
              >
                리스트
              </button>
              <button
                type="button"
                onClick={() => handleResultViewChange('card')}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  resultView === 'card'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                aria-label="카드 뷰"
                aria-pressed={resultView === 'card'}
              >
                카드
              </button>
            </div>
          </div>

          {resultView === 'list' ? (
            /* ── 리스트 뷰: 기존 방식 그대로 ── */
            <>
              {data.medications.map((medication: Medication, index: number) => (
                <MedicationCard
                  key={index}
                  medication={medication}
                  index={index}
                  isAlarmOn={alarmEnabled[medication.drug_name_simple] !== false}
                  onToggleAlarm={() => toggleAlarm(medication.drug_name_simple)}
                  onSpeak={speak}
                />
              ))}
            </>
          ) : (
            /* ── 카드 슬라이드 뷰 ── */
            <div className="space-y-3">
              {/* n / total 인디케이터 */}
              <div className="text-center text-base font-semibold text-gray-400">
                {cardIndex + 1} / {data.medications.length}
              </div>

              {/* 카드 본문 (기존 MedicationCard 재사용) */}
              <MedicationCard
                key={cardIndex}
                medication={data.medications[cardIndex]}
                index={cardIndex}
                isAlarmOn={alarmEnabled[data.medications[cardIndex].drug_name_simple] !== false}
                onToggleAlarm={() => toggleAlarm(data.medications[cardIndex].drug_name_simple)}
                onSpeak={speak}
              />

              {/* 좌우 이동 버튼 */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCardIndex(i => Math.max(0, i - 1))}
                  disabled={cardIndex === 0}
                  className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-700 font-bold text-lg disabled:opacity-30 hover:bg-gray-200 transition-all active:scale-95"
                  aria-label="이전 약"
                >
                  ← 이전
                </button>
                <button
                  type="button"
                  onClick={() => setCardIndex(i => Math.min(data.medications.length - 1, i + 1))}
                  disabled={cardIndex === data.medications.length - 1}
                  className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-700 font-bold text-lg disabled:opacity-30 hover:bg-gray-200 transition-all active:scale-95"
                  aria-label="다음 약"
                >
                  다음 →
                </button>
              </div>

              {/* 점 인디케이터 */}
              {data.medications.length > 1 && (
                <div className="flex justify-center gap-2 pt-1">
                  {data.medications.map((_: Medication, i: number) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCardIndex(i)}
                      className={`rounded-full transition-all ${
                        i === cardIndex
                          ? 'w-5 h-2.5 bg-blue-700'
                          : 'w-2.5 h-2.5 bg-gray-300 hover:bg-gray-400'
                      }`}
                      aria-label={`${i + 1}번째 약`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 전체 주의사항 ──────────────────────────────── */}
        {toArray(data.general_warnings).length > 0 && (
          <div className="bg-orange-50 border-2 border-orange-400 rounded-2xl p-5 space-y-3">
            <h2 className="text-xl font-bold text-orange-800">⚠️ 전체 주의사항</h2>
            <ul className="list-disc list-inside space-y-2">
              {toArray(data.general_warnings).map((warning, i) => (
                <li key={i} className="text-lg text-gray-800">{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── 3. 하단 통합 알림 설정 ──────────────────────── */}
        <div className="bg-white border-2 border-gray-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">📳</span>
            <h2 className="text-xl font-bold text-gray-800">알림 설정</h2>
            {enabledCount < data.medications.length && (
              <span className="ml-auto text-sm text-gray-400">
                {enabledCount}/{data.medications.length}개 선택됨
              </span>
            )}
          </div>

          {/* 텔레그램 버튼 */}
          <button
            type="button"
            onClick={handleTelegram}
            disabled={telegramState === 'sending' || telegramState === 'done'}
            className={`w-full py-4 px-6 text-lg font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-60 ${
              telegramState === 'done'
                ? 'bg-green-500 text-white'
                : telegramState === 'error'
                  ? 'bg-red-100 border-2 border-red-400 text-red-700'
                  : 'bg-[#229ED9] hover:bg-[#1a8bbf] text-white shadow-md'
            }`}
          >
            {telegramState === 'sending' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span> 예약 중...
              </span>
            ) : telegramState === 'done' ? (
              `✅ ${scheduledCount}개 알림 예약 완료! (5분 전 전송)`
            ) : telegramState === 'error' ? (
              '⚠️ 예약 실패. 다시 시도해주세요.'
            ) : (
              '💬 텔레그램으로 전체 알림 받기'
            )}
          </button>

          {/* 브라우저 알림 버튼 */}
          {notification.isSupported && notification.permission !== 'denied' && (
            <button
              type="button"
              onClick={handleBrowserAlarm}
              disabled={isSetting || browserAlarmSet}
              className={`w-full py-4 px-6 text-lg font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-60 ${
                browserAlarmSet
                  ? 'bg-green-100 border-2 border-green-500 text-green-800'
                  : 'bg-blue-700 hover:bg-blue-800 text-white shadow-md'
              }`}
            >
              {isSetting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span> 권한 요청 중...
                </span>
              ) : browserAlarmSet ? (
                `✅ 브라우저 알림 설정 완료 (${enabledCount}개)`
              ) : (
                '🔔 브라우저 알림 켜기'
              )}
            </button>
          )}

          {notification.permission === 'denied' && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              🔕 알림이 차단됐어요. 브라우저 설정에서 알림을 허용해주세요.
            </div>
          )}

          {/* 처방전 기록 보기 버튼 */}
          <button
            type="button"
            onClick={() => router.push('/history')}
            className="w-full py-4 px-6 bg-green-600 text-white text-lg font-bold rounded-2xl hover:bg-green-700 transition-colors active:scale-95"
          >
            📋 처방전 기록 보기
          </button>

          {/* 다시 찍기 버튼 */}
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem('yaksouk_result');
              notification.cancelAllAlerts();
              router.push('/');
            }}
            className="w-full py-4 px-6 bg-gray-100 text-gray-700 text-lg font-bold rounded-2xl hover:bg-gray-200 transition-colors border border-gray-200"
          >
            🔄 처방전 다시 찍기
          </button>
        </div>

      </div>

      <BottomNav />
    </div>
  );
}
