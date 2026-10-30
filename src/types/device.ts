
import type { PillShape } from "./prescription";

// 특정 날짜와 시간의 복약 일정 1건
export interface DeviceMedication {
  occurrenceId: string;
  medicationId: string;

  name: string;
  dose: string;
  scheduledAt: string;

  instruction?: string;
  pillColor?: string;
  pillShape?: PillShape;

  status: "pending" | "completed";
  completedAt?: string;
}

// Redis에 저장할 데이터
export interface DeviceMedicationStore {
  scheduleVersion: number;
  medications: DeviceMedication[];
}

// ESP32에 전송할 최종 JSON
export interface DeviceMedicationResponse
  extends DeviceMedicationStore {
  schemaVersion: 1;
  deviceId: string;
  timezone: "Asia/Seoul";
  generatedAt: string;
}
