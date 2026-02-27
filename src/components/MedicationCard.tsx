'use client';

import type { Medication } from '@/types/prescription';
import PillBadge from '@/components/PillBadge';

interface MedicationCardProps {
  medication: Medication;
  index: number;
  isAlarmOn: boolean;
  onToggleAlarm: () => void;
  onSpeak: (text: string) => void;
}

const CARD_COLORS = [
  'border-l-blue-700',
  'border-l-green-700',
  'border-l-orange-500',
  'border-l-purple-700',
];

export default function MedicationCard({
  medication,
  index,
  isAlarmOn,
  onToggleAlarm,
  onSpeak,
}: MedicationCardProps) {
  const colorClass = CARD_COLORS[index % CARD_COLORS.length];

  return (
    <div className={`bg-white rounded-2xl shadow-md border-l-8 ${colorClass} p-6 space-y-4`}>
      {/* 약품 이름 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex-shrink-0 w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center shadow-sm">
            <PillBadge
              color={medication.pill_color || '#C8C8C8'}
              shape={medication.pill_shape || 'tablet'}
              drugName={medication.drug_name_simple}
            />
          </div>
          <div className="min-w-0">
            <h3 className="text-2xl font-bold text-gray-900 leading-tight">
              {medication.drug_name_simple}
            </h3>
            <p className="text-sm text-gray-400 mt-0.5 truncate">{medication.drug_name}</p>
          </div>
        </div>

        {/* 음성 안내 버튼 */}
        <button
          type="button"
          onClick={() => onSpeak(medication.senior_friendly_instruction)}
          className="flex-shrink-0 w-12 h-12 bg-blue-700 text-white rounded-full hover:bg-blue-800 transition-colors flex items-center justify-center text-xl"
          aria-label="음성으로 듣기"
        >
          🔊
        </button>
      </div>

      {/* 시니어 안내 문구 */}
      <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4">
        <p className="text-lg font-medium text-gray-800 leading-relaxed">
          💡 {medication.senior_friendly_instruction}
        </p>
      </div>

      {/* 복용 정보 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 font-medium">복용량</p>
          <p className="text-base font-semibold text-gray-800 mt-0.5">{medication.dosage}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 font-medium">하루 횟수</p>
          <p className="text-base font-semibold text-gray-800 mt-0.5">{medication.frequency}번</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 font-medium">복용 시점</p>
          <p className="text-base font-semibold text-gray-800 mt-0.5">{medication.timing}</p>
        </div>
        {medication.duration_days && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400 font-medium">복용 기간</p>
            <p className="text-base font-semibold text-gray-800 mt-0.5">{medication.duration_days}일</p>
          </div>
        )}
      </div>

      {/* 알림 시간 + 토글 */}
      {medication.alert_times.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-blue-800">⏰ 알림:</span>
            {medication.alert_times.map((time, idx) => (
              <span
                key={idx}
                className="px-3 py-1 bg-blue-700 text-white text-sm font-bold rounded-full"
              >
                {time}
              </span>
            ))}
          </div>

          {/* 알림 토글 버튼 */}
          <button
            type="button"
            onClick={onToggleAlarm}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 ${
              isAlarmOn
                ? 'bg-blue-700 text-white'
                : 'bg-gray-200 text-gray-500'
            }`}
            aria-label={isAlarmOn ? '알림 끄기' : '알림 켜기'}
          >
            {isAlarmOn ? '🔔 ON' : '🔕 OFF'}
          </button>
        </div>
      )}

      {/* 특이사항 */}
      {medication.special_notes && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-base text-gray-700">
            <span className="font-semibold">특이사항:</span> {medication.special_notes}
          </p>
        </div>
      )}
    </div>
  );
}
