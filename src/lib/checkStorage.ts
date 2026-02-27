import type { DailyCheckRecord, MedicationCheckState } from '@/types/prescription';

const KEY = (date: string) => `checks:${date}`;

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export function loadChecks(date: string): MedicationCheckState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY(date));
    if (!raw) return [];
    const record: DailyCheckRecord = JSON.parse(raw);
    return record.states ?? [];
  } catch {
    return [];
  }
}

export function saveChecks(date: string, states: MedicationCheckState[]): void {
  if (typeof window === 'undefined') return;
  const record: DailyCheckRecord = { date, states };
  localStorage.setItem(KEY(date), JSON.stringify(record));
}

// 특정 약의 특정 시간 체크 상태를 토글하고 전체 states를 반환
export function toggleCheck(
  states: MedicationCheckState[],
  drugName: string,
  alertTime: string,
  checked: boolean
): MedicationCheckState[] {
  const existing = states.find(s => s.drugName === drugName);
  if (existing) {
    return states.map(s =>
      s.drugName === drugName
        ? { ...s, checks: { ...s.checks, [alertTime]: checked } }
        : s
    );
  }
  // 해당 약이 없으면 새로 추가
  return [...states, { drugName, checks: { [alertTime]: checked } }];
}
