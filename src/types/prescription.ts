export type PillShape = 'round' | 'oval' | 'capsule' | 'tablet' | 'liquid' | 'powder' | 'ointment';

export type AlertType = 'medication' | 'missed' | 'refill';

export interface GuardianData {
  guardianChatId: string;
  alerts: AlertType[];
}

// 약품 하나의 정보
export interface Medication {
  drug_name: string;
  drug_name_simple: string;
  pill_color: string;   // 알약 색상 (CSS hex: "#FF6B6B")
  pill_shape: PillShape; // 알약 모양: round(원형) | capsule(캡슐) | tablet(타원형)
  dosage: string;
  frequency: number;
  timing: string;
  duration_days?: number;
  special_notes?: string;
  senior_friendly_instruction: string;
  alert_times: string[];
}

// 전체 처방전 분석 결과
export interface PrescriptionResult {
  patient_name?: string;
  hospital?: string;
  prescription_date?: string;
  medications: Medication[];
  general_warnings: string[];
  ocr_confidence: 'high' | 'medium' | 'low';
}

// 시간대별 복약 체크 상태
export interface MedicationCheckState {
  drugName: string;
  checks: Record<string, boolean>;
  // key   = alert_time (e.g. "07:30")
  // value = true if taken, false if not
}

// 하루 전체 복약 체크 기록
export interface DailyCheckRecord {
  date: string;                      // "YYYY-MM-DD"
  states: MedicationCheckState[];
}

// API 응답 형식
export interface AnalyzeResponse {
  status: 'success' | 'error';
  data?: PrescriptionResult;
  message: string;
  alerts_registered?: boolean;
}
