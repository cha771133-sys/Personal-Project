'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Medication } from '@/types/prescription';

export type NotificationPermission = 'default' | 'granted' | 'denied';

interface ScheduledAlert {
  id: string;
  drugName: string;
  time: string;       // "07:30"
  timeoutId?: number;
}

const STORAGE_KEY = 'yaksouk_alerts';

export function useNotification() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [scheduledAlerts, setScheduledAlerts] = useState<ScheduledAlert[]>([]);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsSupported('Notification' in window);
    if ('Notification' in window) {
      setPermission(Notification.permission as NotificationPermission);
    }
    // 저장된 알림 복원
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setScheduledAlerts(JSON.parse(saved));
      } catch { /* ignore */ }
    }
  }, []);

  // 알림 권한 요청
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermission);
    return result === 'granted';
  }, []);

  // 알림 즉시 발송 (테스트용)
  const sendNow = useCallback((title: string, body: string) => {
    if (Notification.permission !== 'granted') return;
    const swReg = (window as Window & { _swRegistration?: ServiceWorkerRegistration })._swRegistration;
    if (swReg) {
      swReg.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'yaksouk',
      });
    } else {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }, []);

  // 특정 시간에 알림 예약
  const scheduleAlert = useCallback((drugName: string, time: string): ScheduledAlert | null => {
    if (Notification.permission !== 'granted') return null;

    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(hours, minutes, 0, 0);

    // 이미 지난 시간이면 내일로
    if (scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }

    const delay = scheduled.getTime() - now.getTime();
    const id = `${drugName}-${time}`;

    const timeoutId = window.setTimeout(() => {
      sendNow(
        `💊 복약 알림`,
        `${drugName} 드실 시간이에요! (${time})`
      );
      // 내일 같은 시간 다시 예약 (반복)
      scheduleAlert(drugName, time);
    }, delay);

    const alert: ScheduledAlert = { id, drugName, time, timeoutId };
    return alert;
  }, [sendNow]);

  // 처방전 전체 약품의 알림 일괄 등록
  const registerMedicationAlerts = useCallback(async (medications: Medication[]): Promise<number> => {
    const granted = Notification.permission === 'granted' || await requestPermission();
    if (!granted) return 0;

    const newAlerts: ScheduledAlert[] = [];

    for (const med of medications) {
      for (const time of med.alert_times) {
        const alert = scheduleAlert(med.drug_name_simple, time);
        if (alert) newAlerts.push(alert);
      }
    }

    setScheduledAlerts(prev => {
      const merged = [...prev, ...newAlerts];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(
        merged.map(({ id, drugName, time }) => ({ id, drugName, time }))
      ));
      return merged;
    });

    return newAlerts.length;
  }, [requestPermission, scheduleAlert]);

  // 알림 전체 취소
  const cancelAllAlerts = useCallback(() => {
    scheduledAlerts.forEach(alert => {
      if (alert.timeoutId) window.clearTimeout(alert.timeoutId);
    });
    setScheduledAlerts([]);
    localStorage.removeItem(STORAGE_KEY);
  }, [scheduledAlerts]);

  return {
    isSupported,
    permission,
    scheduledAlerts,
    requestPermission,
    registerMedicationAlerts,
    cancelAllAlerts,
    sendNow,
  };
}
