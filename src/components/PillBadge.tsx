'use client';

import { useState, useEffect } from 'react';
import type { PillShape } from '@/types/prescription';
import PillCustomizer, { loadPillCustom, type PillCustom } from './PillCustomizer';

interface PillBadgeProps {
  color: string;
  shape: PillShape;
  drugName?: string;
  /** 'sm' = 알람 패널용 소형, 'md' = 기본 카드용 (default) */
  size?: 'sm' | 'md';
}

// ── 유틸 ─────────────────────────────────────────────────────
function getLightColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighter = (v: number) => Math.min(255, v + 60);
  return `rgb(${lighter(r)}, ${lighter(g)}, ${lighter(b)})`;
}

const SIZES: Record<'sm' | 'md', Record<PillShape, [number, number]>> = {
  sm: {
    round:   [28, 28],
    oval:    [38, 22],
    capsule: [38, 16],
    tablet:  [32, 20],
    liquid:  [24, 28],
    powder:  [28, 28],
  },
  md: {
    round:   [56, 56],
    oval:    [64, 36],
    capsule: [64, 28],
    tablet:  [52, 32],
    liquid:  [48, 56],
    powder:  [56, 56],
  },
};

// ── 알약 그래픽 ───────────────────────────────────────────────
interface PillGraphicProps {
  color: string;
  shape: PillShape;
  w: number;
  h: number;
}

function PillGraphic({ color, shape, w, h }: PillGraphicProps) {
  const lightColor = getLightColor(color);

  if (shape === 'round') {
    return (
      <div
        className="relative flex-shrink-0"
        style={{ width: w, height: h }}
        aria-label="원형 알약"
      >
        <div
          className="w-full h-full rounded-full shadow-md"
          style={{
            background: `radial-gradient(circle at 35% 35%, ${lightColor}, ${color})`,
            boxShadow: `0 4px 8px ${color}80, inset 0 -2px 4px ${color}60`,
          }}
        />
        <div
          className="absolute top-1/2 left-[15%] right-[15%] h-[2px] -translate-y-1/2 rounded-full opacity-30"
          style={{ backgroundColor: '#fff' }}
        />
      </div>
    );
  }

  if (shape === 'oval') {
    return (
      <div
        className="relative flex-shrink-0"
        style={{ width: w, height: h }}
        aria-label="타원형 알약"
      >
        <div
          className="w-full h-full shadow-md"
          style={{
            borderRadius: '50% / 40%',
            background: `linear-gradient(145deg, ${lightColor} 0%, ${color} 60%, ${color}CC 100%)`,
            boxShadow: `0 3px 8px ${color}70, inset 0 1px 2px ${lightColor}`,
          }}
        />
        <div
          className="absolute top-1/2 left-[20%] right-[20%] h-[1.5px] -translate-y-1/2 rounded-full opacity-25"
          style={{ backgroundColor: '#000' }}
        />
        <div
          className="absolute top-[15%] left-[15%] w-[30%] h-[35%] opacity-30 rounded-full"
          style={{ backgroundColor: '#ffffff' }}
        />
      </div>
    );
  }

  if (shape === 'capsule') {
    return (
      <div
        className="relative flex-shrink-0"
        style={{ width: w, height: h }}
        aria-label="캡슐 알약"
      >
        <div
          className="w-full h-full rounded-full shadow-md overflow-hidden flex"
          style={{ boxShadow: `0 3px 8px ${color}60` }}
        >
          <div
            className="w-1/2 h-full"
            style={{ background: `linear-gradient(135deg, ${lightColor}, ${color})` }}
          />
          <div
            className="w-1/2 h-full"
            style={{ background: `linear-gradient(135deg, #f0f0f0, #d0d0d0)` }}
          />
        </div>
        <div
          className="absolute top-[15%] left-[10%] w-[35%] h-[30%] rounded-full opacity-40"
          style={{ backgroundColor: '#ffffff' }}
        />
      </div>
    );
  }

  if (shape === 'tablet') {
    return (
      <div
        className="relative flex-shrink-0"
        style={{ width: w, height: h }}
        aria-label="사각형 알약"
      >
        <div
          className="w-full h-full shadow-md"
          style={{
            borderRadius: '10px',
            background: `linear-gradient(145deg, ${lightColor} 0%, ${color} 60%, ${color}CC 100%)`,
            boxShadow: `0 3px 8px ${color}70, inset 0 1px 2px ${lightColor}`,
          }}
        />
        <div
          className="absolute top-1/2 left-[15%] right-[15%] h-[1.5px] -translate-y-1/2 rounded-full opacity-25"
          style={{ backgroundColor: '#000' }}
        />
        <div
          className="absolute top-[15%] left-[10%] w-[25%] h-[40%] opacity-30 rounded-md"
          style={{ backgroundColor: '#ffffff' }}
        />
      </div>
    );
  }

  if (shape === 'liquid') {
    const uid = color.replace('#', '');
    return (
      <div
        className="relative flex-shrink-0 flex flex-col items-center"
        aria-label="물약"
      >
        <svg
          width={w}
          height={h}
          viewBox="0 0 48 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`liq-${uid}`} x1="12" y1="12" x2="36" y2="52" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={lightColor} />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
            <filter id={`liq-shadow-${uid}`} x="-20%" y="-10%" width="140%" height="130%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor={color} floodOpacity="0.4" />
            </filter>
          </defs>
          {/* 물방울 경로 */}
          <path
            d="M24 2 C24 2, 6 22, 6 36 C6 46.493 14.507 54 24 54 C33.493 54 42 46.493 42 36 C42 22, 24 2, 24 2Z"
            fill={`url(#liq-${uid})`}
            filter={`url(#liq-shadow-${uid})`}
          />
          {/* 광택 */}
          <ellipse cx="18" cy="30" rx="4" ry="8" fill="white" opacity="0.35" transform="rotate(-20 18 30)" />
          <ellipse cx="16" cy="22" rx="2" ry="3" fill="white" opacity="0.5" transform="rotate(-20 16 22)" />
        </svg>
        <span className="text-xs font-bold text-gray-500 -mt-0.5">물약</span>
      </div>
    );
  }

  // powder (가루약)
  const uid2 = color.replace('#', '');
  const dots: [number, number, number][] = [
    [24, 18, 5], [16, 26, 4], [32, 26, 4],
    [10, 34, 3], [24, 32, 5], [38, 34, 3],
    [16, 41, 4], [32, 41, 4], [24, 48, 3],
  ];
  return (
    <div
      className="relative flex-shrink-0 flex flex-col items-center"
      aria-label="가루약"
    >
      <svg
        width={w}
        height={h}
        viewBox="0 0 48 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`pwd-shadow-${uid2}`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor={color} floodOpacity="0.3" />
          </filter>
        </defs>
        {dots.map(([cx, cy, r], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill={color}
            opacity={0.6 + i * 0.04}
            filter={`url(#pwd-shadow-${uid2})`}
          />
        ))}
        <circle cx={24} cy={32} r={4} fill={lightColor} opacity={0.5} />
      </svg>
      <span className="text-xs font-bold text-gray-500 -mt-0.5">가루약</span>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function PillBadge({ color, shape, drugName, size = 'md' }: PillBadgeProps) {
  const [custom, setCustom] = useState<PillCustom | null>(null);
  const [showCustomizer, setShowCustomizer] = useState(false);

  // localStorage에서 저장된 커스텀 설정 로드
  useEffect(() => {
    if (drugName) {
      const saved = loadPillCustom(drugName);
      if (saved) setCustom(saved);
    }
  }, [drugName]);

  const activeColor = custom?.color ?? color;
  const activeShape = custom?.shape ?? shape;
  const [w, h] = SIZES[size][activeShape];

  // md 크기 + drugName 있을 때만 편집 가능
  const isEditable = !!drugName && size === 'md';

  return (
    <>
      <div
        className={`relative inline-flex flex-col items-center ${isEditable ? 'cursor-pointer group' : ''}`}
        onClick={isEditable ? () => setShowCustomizer(true) : undefined}
        role={isEditable ? 'button' : undefined}
        tabIndex={isEditable ? 0 : undefined}
        onKeyDown={isEditable ? (e) => e.key === 'Enter' && setShowCustomizer(true) : undefined}
        aria-label={isEditable ? `${drugName} 모양 수정` : undefined}
      >
        <PillGraphic color={activeColor} shape={activeShape} w={w} h={h} />

        {/* ✏️ 수정 아이콘 - 호버 시 표시 */}
        {isEditable && (
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full shadow-md border border-gray-200 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            ✏️
          </div>
        )}
      </div>

      {/* 커스터마이저 모달 */}
      {showCustomizer && drugName && (
        <PillCustomizer
          drugName={drugName}
          initialColor={activeColor}
          initialShape={activeShape}
          onSave={(saved) => {
            setCustom(saved);
            setShowCustomizer(false);
          }}
          onClose={() => setShowCustomizer(false)}
        />
      )}
    </>
  );
}
