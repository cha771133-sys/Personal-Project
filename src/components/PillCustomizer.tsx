'use client';

import { useState, useEffect } from 'react';
import type { PillShape } from '@/types/prescription';

// ── 상수 ────────────────────────────────────────────────────
const STORAGE_PREFIX = 'yaksouk_pill_custom_';

export const PILL_COLORS: { value: string; label: string }[] = [
  { value: '#FF4444', label: '빨강' },
  { value: '#FF8C00', label: '주황' },
  { value: '#FFD700', label: '노랑' },
  { value: '#4CAF50', label: '초록' },
  { value: '#2196F3', label: '파랑' },
  { value: '#9C27B0', label: '보라' },
  { value: '#FFFFFF', label: '흰색' },
  { value: '#888888', label: '회색' },
  { value: '#795548', label: '갈색' },
  { value: '#FF69B4', label: '분홍' },
];

export const PILL_SHAPES: { value: PillShape; label: string; emoji: string }[] = [
  { value: 'round',    label: '원형',   emoji: '⬤' },
  { value: 'oval',     label: '타원형', emoji: '💊' },
  { value: 'capsule',  label: '캡슐',   emoji: '💊' },
  { value: 'tablet',   label: '사각형', emoji: '◼' },
  { value: 'liquid',   label: '물약',   emoji: '💧' },
  { value: 'powder',   label: '가루약', emoji: '🫙' },
  { value: 'ointment', label: '연고',   emoji: '🧴' },
];

// ── 타입 & 헬퍼 ─────────────────────────────────────────────
export interface PillCustom {
  color: string;
  shape: PillShape;
}

export function loadPillCustom(drugName: string): PillCustom | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${drugName}`);
    return raw ? (JSON.parse(raw) as PillCustom) : null;
  } catch {
    return null;
  }
}

export function savePillCustom(drugName: string, custom: PillCustom): void {
  localStorage.setItem(`${STORAGE_PREFIX}${drugName}`, JSON.stringify(custom));
}

// ── Props ────────────────────────────────────────────────────
interface PillCustomizerProps {
  drugName: string;
  initialColor: string;
  initialShape: PillShape;
  onSave: (custom: PillCustom) => void;
  onClose: () => void;
}

// ── 컴포넌트 ─────────────────────────────────────────────────
export default function PillCustomizer({
  drugName,
  initialColor,
  initialShape,
  onSave,
  onClose,
}: PillCustomizerProps) {
  const [color, setColor] = useState(initialColor);
  const [shape, setShape] = useState<PillShape>(initialShape);
  // 슬라이드업 애니메이션 트리거
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 280);
  };

  const handleSave = () => {
    const custom: PillCustom = { color, shape };
    savePillCustom(drugName, custom);
    onSave(custom);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* 반투명 오버레이 */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* 바텀 시트 */}
      <div
        className={`
          relative bg-white rounded-t-3xl w-full max-w-lg mx-auto
          px-5 pb-10 pt-5 space-y-6
          transform transition-transform duration-300 ease-out
          ${visible ? 'translate-y-0' : 'translate-y-full'}
        `}
      >
        {/* 드래그 핸들 */}
        <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto -mt-1 mb-1" />

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-gray-900">약 모양을 골라주세요</h2>
            <p className="text-sm text-gray-400 mt-0.5">{drugName}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 font-bold text-lg"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 모양 선택 */}
        <div>
          <p className="text-lg font-semibold text-gray-600 mb-3">모양</p>
          <div className="grid grid-cols-3 gap-3">
            {PILL_SHAPES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setShape(s.value)}
                className={`
                  flex flex-col items-center justify-center gap-1.5
                  rounded-2xl border-2 py-4 transition-all active:scale-95
                  min-h-[80px]
                  ${shape === s.value
                    ? 'border-blue-700 bg-blue-50'
                    : 'border-gray-200 bg-gray-50 hover:border-blue-300'
                  }
                `}
                aria-label={s.label}
                aria-pressed={shape === s.value}
              >
                <span className="text-3xl leading-none">{s.emoji}</span>
                <span className={`text-base font-bold ${shape === s.value ? 'text-blue-700' : 'text-gray-700'}`}>
                  {s.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 색깔 선택 */}
        <div>
          <p className="text-lg font-semibold text-gray-600 mb-3">약 색깔을 골라주세요</p>
          <div className="grid grid-cols-5 gap-4">
            {PILL_COLORS.map((c) => {
              const isSelected = color === c.value;
              const isWhite = c.value === '#FFFFFF';
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`
                    w-12 h-12 mx-auto rounded-full
                    flex items-center justify-center
                    transition-all duration-150 active:scale-95
                    ${isWhite ? 'border-2 border-gray-300' : 'border-2 border-transparent'}
                    ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2 scale-110' : 'hover:scale-105'}
                  `}
                  style={{ backgroundColor: c.value }}
                  aria-label={c.label}
                  aria-pressed={isSelected}
                >
                  {isSelected && (
                    <span
                      className="text-lg font-black leading-none"
                      style={{ color: isWhite ? '#555555' : '#ffffff' }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* 선택된 색상 미리보기 */}
          <div className="flex items-center gap-3 mt-4 px-2">
            <div
              className="w-8 h-8 rounded-full border-2 border-gray-200 flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-base text-gray-600">
              {PILL_COLORS.find(c => c.value === color)?.label ?? '커스텀'} 선택됨
            </span>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            className="w-full py-4 bg-blue-700 text-white text-xl font-black rounded-2xl hover:bg-blue-800 active:scale-95 transition-all"
          >
            확인
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="w-full py-4 bg-white text-gray-700 text-xl font-bold rounded-2xl border-2 border-gray-200 hover:bg-gray-50 active:scale-95 transition-all"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
