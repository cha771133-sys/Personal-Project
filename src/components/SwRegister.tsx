'use client';

import { useEffect } from 'react';

export default function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // SW 등록 성공 시 알림 전송에 사용하기 위해 전역에 저장
          (window as Window & { _swRegistration?: ServiceWorkerRegistration })._swRegistration = reg;
        })
        .catch(() => { /* SW 미지원 환경에서는 기본 Notification API 사용 */ });
    }
  }, []);

  return null;
}
