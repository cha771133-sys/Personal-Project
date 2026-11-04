'use client';

import type { Medication, PrescriptionResult } from '@/types/prescription';

export interface PrescriptionHistory {
  id: string;
  savedAt: string;
  hospitalName: string;
  medications: Medication[];
  thumbnail?: string;
}

const STORAGE_KEY = 'yaksouk_history';

function generateId(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 8);
  return `${dateStr}-${random}`;
}

export function saveHistory(result: PrescriptionResult): string {
  const id = generateId();
  const entry: PrescriptionHistory = {
    id,
    savedAt: new Date().toISOString(),
    hospitalName: result.hospital || '병원 정보 없음',
    medications: result.medications,
  };

  const list = getHistoryList();
  // 동일 병원 + 같은 날짜 처방전 중복 방지 (10분 이내 재저장 무시)
  const recent = list[0];
  if (recent) {
    const diff = Date.now() - new Date(recent.savedAt).getTime();
    if (diff < 10 * 60 * 1000 && recent.hospitalName === entry.hospitalName) {
      return recent.id;
    }
  }

  list.unshift(entry);
  // 최대 30건 유지
  const trimmed = list.slice(0, 30);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return id;
}

// Update a history entry after the user reviews AI recognition.
export function replaceHistoryMedications(id: string, prescription: PrescriptionResult): void {
  if (typeof window === 'undefined') return;
  const items = getHistoryList();
  const index = items.findIndex(item => item.id === id);
  if (index === -1) throw new Error('History item not found');
  items[index] = {
    ...items[index],
    hospitalName: prescription.hospital || '병원 정보 없음',
    medications: prescription.medications,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function getHistoryList(): PrescriptionHistory[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PrescriptionHistory[];
    return parsed.sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  } catch {
    return [];
  }
}

export function getHistoryById(id: string): PrescriptionHistory | null {
  return getHistoryList().find((h) => h.id === id) ?? null;
}

export function deleteHistory(id: string): void {
  const updated = getHistoryList().filter((h) => h.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function clearAllHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function formatSavedAt(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
