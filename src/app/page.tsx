'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import UploadZone from '@/components/UploadZone';
import BottomNav from '@/components/BottomNav';
import GuardianModeSwitch from '@/components/home/GuardianModeSwitch';
import FontSizeControl from '@/components/home/FontSizeControl';
import { useVoiceGuide } from '@/hooks/useVoiceGuide';
import type { AnalyzeResponse } from '@/types/prescription';

// 16px 베이스 기준: small=16px, base=18px, large=21px
const FONT_SCALE_MAP: Record<'small' | 'base' | 'large', string> = {
  small: '1',
  base:  '1.125',
  large: '1.3125',
};

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [fontSize, setFontSize]   = useState<'small' | 'base' | 'large'>('base');
  const { speak, stop, isSpeaking } = useVoiceGuide();

  // 저장된 글자 크기 복원
  useEffect(() => {
    const saved = localStorage.getItem('yaksouk_font_size') as 'small' | 'base' | 'large' | null;
    if (saved && saved in FONT_SCALE_MAP) {
      setFontSize(saved);
      document.documentElement.style.setProperty('--font-scale', FONT_SCALE_MAP[saved]);
    }
  }, []);

  const handleAnalyze = async (file: File) => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const result: AnalyzeResponse = await response.json();

      if (result.status === 'success' && result.data) {
        sessionStorage.setItem('yaksouk_result', JSON.stringify(result));
        router.push('/result');
      } else {
        alert(result.message);
      }
    } catch {
      alert('처방전 분석 중 문제가 생겼어요. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFontSizeChange = (size: 'small' | 'base' | 'large') => {
    setFontSize(size);
    document.documentElement.style.setProperty('--font-scale', FONT_SCALE_MAP[size]);
    localStorage.setItem('yaksouk_font_size', size);
  };

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--bg)' }}>
      <div className="max-w-2xl mx-auto px-4 space-y-5">

        {/* ── 헤더 ── */}
        <header className="flex items-center justify-between pt-10 pb-2">
          {/* 로고 */}
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow-md flex-shrink-0"
              style={{ background: 'var(--primary)' }}
            >
              💊
            </div>
            <span
              className="font-black tracking-tight"
              style={{ fontSize: '1.6rem', color: 'var(--text-main)' }}
            >
              약<span style={{ color: 'var(--primary)' }}>속</span>
            </span>
          </div>

          {/* 우측 컨트롤 */}
          <div className="flex items-center gap-2">
            <FontSizeControl fontSize={fontSize} onChange={handleFontSizeChange} />

            {/* 음성 토글 */}
            <button
              type="button"
              onClick={() =>
                isSpeaking
                  ? stop()
                  : speak('약속 앱에 오신 것을 환영합니다. 처방전 사진을 올려주세요.')
              }
              className="w-11 h-11 rounded-xl flex items-center justify-center text-lg transition-colors flex-shrink-0"
              style={{
                background:  isSpeaking ? 'var(--primary)' : 'var(--surface)',
                color:       isSpeaking ? '#fff'           : 'var(--text-sub)',
                border:      `1.5px solid ${isSpeaking ? 'var(--primary)' : 'var(--border)'}`,
              }}
              aria-label={isSpeaking ? '음성 끄기' : '음성 켜기'}
            >
              {isSpeaking ? '🔇' : '🔊'}
            </button>
          </div>
        </header>

        {/* ── 서브타이틀 ── */}
        <p
          className="text-center text-base"
          style={{ color: 'var(--text-sub)' }}
        >
          처방전 사진 한 장으로 복약 안내를 받아보세요
        </p>

        {/* ── 보호자 모드 스위치 ── */}
        <GuardianModeSwitch />

        {/* ── 처방전 업로드 ── */}
        <UploadZone onAnalyze={handleAnalyze} isLoading={isLoading} />

      </div>

      <BottomNav />

      {/* ── 로딩 오버레이 ── */}
      {isLoading && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(79, 110, 247, 0.82)' }}
        >
          <div
            className="rounded-2xl p-10 text-center space-y-4 shadow-2xl mx-4"
            style={{ background: 'var(--surface)', maxWidth: '360px', width: '100%' }}
          >
            <div
              className="animate-spin rounded-full h-16 w-16 mx-auto"
              style={{
                border: '4px solid var(--primary-soft)',
                borderTopColor: 'var(--primary)',
              }}
            />
            <p
              className="font-bold"
              style={{ fontSize: '1.2rem', color: 'var(--text-main)' }}
            >
              처방전을 읽고 있어요 😊
            </p>
            <p className="text-base" style={{ color: 'var(--text-sub)' }}>
              잠깐만 기다려주세요...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
