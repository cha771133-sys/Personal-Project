'use client';

import { useState, useEffect } from 'react';
import type { AlertType } from '@/types/prescription';

type AlertChecks = Record<AlertType, boolean>;

const DEFAULT_ALERTS: AlertChecks = {
  medication: true,
  missed:     true,
  refill:     true,
};

const ALERT_OPTIONS: { key: AlertType; label: string }[] = [
  { key: 'medication', label: '복약 알림' },
  { key: 'missed',     label: '미복약 알림' },
  { key: 'refill',     label: '처방 갱신 알림' },
];

type VerifyStatus = 'idle' | 'sending' | 'sent' | 'verified' | 'error'

export default function GuardianModeSwitch() {
  const [isOn, setIsOn]           = useState(false);
  const [chatId, setChatId]       = useState('');
  const [alerts, setAlerts]       = useState<AlertChecks>(DEFAULT_ALERTS);
  const [showToast, setShowToast] = useState(false);
  const [isSaving, setIsSaving]   = useState(false);
  const [saveError, setSaveError] = useState('');

  // 인증 흐름 상태
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle');
  const [tokenInput, setTokenInput]     = useState('');
  const [verifyError, setVerifyError]   = useState('');

  // localStorage 복원
  useEffect(() => {
    const savedMode    = localStorage.getItem('guardian_mode');
    const savedChatId  = localStorage.getItem('guardian_chat_id');
    const savedAlerts  = localStorage.getItem('guardian_alerts');
    const savedVerified = localStorage.getItem('guardian_chat_id_verified');

    if (savedMode === 'true') setIsOn(true);
    if (savedChatId) setChatId(savedChatId);
    if (savedAlerts) {
      try {
        // DEFAULT_ALERTS와 merge해 누락된 키가 undefined가 되는 것을 방지
        setAlerts({ ...DEFAULT_ALERTS, ...JSON.parse(savedAlerts) });
      } catch { /* ignore */ }
    }
    // 이전에 검증된 Chat ID가 동일하면 verified 상태 복원
    if (savedVerified && savedChatId && savedVerified === savedChatId) {
      setVerifyStatus('verified');
    }
  }, []);

  const handleToggle = () => {
    const next = !isOn;
    setIsOn(next);
    localStorage.setItem('guardian_mode', String(next));
  };

  // chatId가 바뀌면 인증 상태 초기화
  const handleChatIdChange = (value: string) => {
    setChatId(value);
    if (verifyStatus !== 'idle') {
      setVerifyStatus('idle');
      setTokenInput('');
      setVerifyError('');
    }
  };

  const handleSendVerification = async () => {
    if (!chatId.trim()) {
      setVerifyError('보호자 Chat ID를 먼저 입력해주세요.');
      return;
    }
    setVerifyError('');
    setVerifyStatus('sending');
    try {
      const res = await fetch('/api/telegram/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chatId.trim() }),
      });
      // 빈 바디나 HTML 에러 페이지가 반환될 경우 json() 자체가 throw될 수 있음
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* 파싱 실패는 무시하고 status로만 판단 */ }
      if (!res.ok) throw new Error((data.error as string) ?? '인증번호 발송에 실패했어요.');
      setVerifyStatus('sent');
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : '인증번호 발송에 실패했어요.');
      setVerifyStatus('error');
    }
  };

  const handleConfirmToken = async () => {
    if (!tokenInput.trim()) {
      setVerifyError('인증번호를 입력해주세요.');
      return;
    }
    setVerifyError('');
    setVerifyStatus('sending');
    try {
      const res = await fetch('/api/telegram/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chatId.trim(), token: tokenInput.trim() }),
      });
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* 파싱 실패는 무시하고 status로만 판단 */ }
      if (!res.ok) throw new Error((data.error as string) ?? '인증번호가 올바르지 않습니다.');
      setVerifyStatus('verified');
      localStorage.setItem('guardian_chat_id_verified', chatId.trim());
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : '인증번호가 올바르지 않습니다.');
      setVerifyStatus('sent'); // 재입력 허용
    }
  };

  const handleSave = async () => {
    if (!chatId.trim()) {
      setSaveError('보호자 Chat ID를 입력해주세요.');
      return;
    }
    if (verifyStatus !== 'verified') {
      setSaveError('보호자 Chat ID 인증을 먼저 완료해주세요.');
      return;
    }
    setSaveError('');
    setIsSaving(true);
    try {
      const alertKeys = (Object.entries(alerts) as [AlertType, boolean][])
        .filter(([, v]) => v)
        .map(([k]) => k);
      const res = await fetch('/api/guardian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guardianChatId: chatId.trim(),
          alerts: alertKeys,
        }),
      });
      if (!res.ok) throw new Error('서버 오류');

      localStorage.setItem('guardian_chat_id', chatId.trim());
      localStorage.setItem('guardian_alerts', JSON.stringify(alerts));
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
    } catch {
      setSaveError('저장 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAlert = (key: AlertType) => {
    setAlerts(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      className="rounded-2xl border-2 p-4 transition-colors duration-300"
      style={{
        borderColor: isOn ? 'var(--success)' : 'var(--border)',
        background:  isOn ? '#F0FDF4'         : 'var(--surface)',
      }}
    >
      {/* ── 헤더 (토글 스위치) ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">👤</span>
          <div>
            <p className="text-base font-bold" style={{ color: 'var(--text-main)' }}>
              보호자 모드
            </p>
            <p className="text-sm" style={{ color: 'var(--text-sub)' }}>
              보호자로 복약 현황을 확인하세요
            </p>
          </div>
        </div>

        {/* 토글 스위치 */}
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          onClick={handleToggle}
          className="relative w-14 h-7 rounded-full focus:outline-none focus-visible:ring-2 transition-colors duration-200"
          style={{
            background:   isOn ? 'var(--success)' : 'var(--border)',
            '--tw-ring-color': 'var(--primary)',
          } as React.CSSProperties}
          aria-label={isOn ? '보호자 모드 끄기' : '보호자 모드 켜기'}
        >
          <span
            className="toggle-thumb absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm"
            style={{ transform: isOn ? 'translateX(28px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {/* ── 펼쳐지는 설정 패널 ── */}
      <div
        className={`guardian-expand ${isOn ? 'guardian-expand-visible' : 'guardian-expand-hidden'}`}
      >
        <div
          className="space-y-4 pt-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          {/* 보호자 정보 입력 + 인증 흐름 */}
          <div className="space-y-2">
            <label
              htmlFor="guardian-chat-id"
              className="block font-semibold"
              style={{ color: 'var(--text-main)', fontSize: '18px' }}
            >
              📱 보호자 정보
            </label>

            {/* Chat ID 입력 + 인증번호 받기 버튼 */}
            <div className="flex gap-2">
              <input
                id="guardian-chat-id"
                type="text"
                value={chatId}
                onChange={(e) => handleChatIdChange(e.target.value)}
                placeholder="보호자 Chat ID 입력"
                className="flex-1 py-3 px-4 rounded-xl border-2 focus:outline-none transition-colors"
                style={{
                  color:       'var(--text-main)',
                  borderColor: verifyStatus === 'verified' ? 'var(--success)' : 'var(--border)',
                  background:  'var(--surface)',
                  fontSize:    '18px',
                }}
                onFocus={(e) => { if (verifyStatus !== 'verified') e.currentTarget.style.borderColor = 'var(--primary)' }}
                onBlur={(e)  => { if (verifyStatus !== 'verified') e.currentTarget.style.borderColor = 'var(--border)' }}
              />
              {verifyStatus !== 'verified' && (
                <button
                  type="button"
                  onClick={handleSendVerification}
                  disabled={verifyStatus === 'sending' || !chatId.trim()}
                  className="rounded-xl font-bold whitespace-nowrap active:scale-95 disabled:opacity-50 px-4"
                  style={{
                    minHeight:  '60px',
                    fontSize:   '18px',
                    background: 'var(--primary)',
                    color:      '#fff',
                  }}
                >
                  {verifyStatus === 'sending' ? '⏳' : '인증번호 받기'}
                </button>
              )}
              {verifyStatus === 'verified' && (
                <span
                  className="flex items-center px-4 rounded-xl font-bold"
                  style={{ background: '#F0FDF4', color: 'var(--success)', fontSize: '18px', minHeight: '60px' }}
                >
                  ✅ 인증완료
                </span>
              )}
            </div>

            {/* 인증번호 입력 (토큰 발송 후 표시) */}
            {(verifyStatus === 'sent' || verifyStatus === 'error') && (
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="6자리 인증번호"
                  className="flex-1 py-3 px-4 rounded-xl border-2 focus:outline-none transition-colors text-center tracking-widest"
                  style={{
                    color:       'var(--text-main)',
                    borderColor: 'var(--border)',
                    background:  'var(--surface)',
                    fontSize:    '22px',
                    minHeight:   '60px',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                <button
                  type="button"
                  onClick={handleConfirmToken}
                  disabled={tokenInput.length < 6}
                  className="rounded-xl font-bold px-5 active:scale-95 disabled:opacity-50"
                  style={{
                    minHeight:  '60px',
                    fontSize:   '18px',
                    background: 'var(--primary)',
                    color:      '#fff',
                  }}
                >
                  확인
                </button>
              </div>
            )}

            {/* 인증 오류 메시지 */}
            {verifyError && (
              <p className="font-medium text-red-600" style={{ fontSize: '16px' }}>{verifyError}</p>
            )}

            <p style={{ color: 'var(--text-sub)', fontSize: '16px' }}>
              텔레그램에서 @userinfobot 을 검색해 Chat ID를 확인하세요
            </p>
          </div>

          {/* 알림 선택 */}
          <div className="space-y-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
              받을 알림 선택
            </p>
            {ALERT_OPTIONS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-3 py-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={alerts[key]}
                  onChange={() => toggleAlert(key)}
                  className="w-5 h-5 rounded"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span className="text-base" style={{ color: 'var(--text-main)' }}>
                  {label}
                </span>
              </label>
            ))}
          </div>

          {/* 에러 메시지 */}
          {saveError && (
            <p className="text-sm text-red-600 font-medium">{saveError}</p>
          )}

          {/* 저장 버튼 — 인증 완료 후에만 활성화 */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || verifyStatus !== 'verified'}
            className="btn-primary w-full text-white font-bold rounded-xl active:scale-95 disabled:opacity-60"
            style={{
              background: 'var(--primary)',
              minHeight:  '60px',
              fontSize:   '18px',
            }}
          >
            {isSaving ? '⏳ 저장 중...' : '💾 보호자 설정 저장'}
          </button>
        </div>
      </div>

      {/* ── 토스트 메시지 ── */}
      {showToast && (
        <div
          className="mt-3 flex items-center gap-2 px-4 py-3 rounded-xl border"
          style={{
            background:   '#F0FDF4',
            borderColor:  'var(--success)',
          }}
        >
          <span className="text-lg">✅</span>
          <p className="text-base font-semibold" style={{ color: 'var(--text-main)' }}>
            저장되었습니다
          </p>
        </div>
      )}
    </div>
  );
}
