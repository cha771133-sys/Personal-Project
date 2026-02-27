import { Client } from '@upstash/qstash'
import type { AlertType } from '@/types/prescription'

const qstash = new Client({ token: process.env.QSTASH_TOKEN! })

export interface NotifyPayload {
  patientChatId: string
  patientName?: string
  guardianChatId?: string
  drugName: string
  dose: string
  scheduleTime: string  // "07:30"
  alertType: AlertType  // 보호자 알림 조건 필터링에 사용
}

/**
 * QStash에 cron 스케줄 등록 — 매일 지정 시각에 /api/notify를 호출
 * 브라우저가 닫혀 있어도 서버 사이드에서 독립적으로 실행됨
 * @returns 등록된 QStash schedule ID (Redis 저장 후 재분석 시 삭제에 사용)
 */
export async function scheduleNotification(
  scheduleTime: string,
  payload: NotifyPayload,
  baseUrl: string
): Promise<string> {
  const [hour, minute] = scheduleTime.split(':').map(Number)
  const cron = `${minute} ${hour} * * *`

  const result = await qstash.schedules.create({
    destination: `${baseUrl}/api/notify`,
    cron,
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })

  return result.scheduleId
}

/**
 * QStash 스케줄 일괄 삭제
 * Promise.allSettled 사용 — 일부 실패해도 전체를 중단하지 않음
 */
export async function deleteSchedules(scheduleIds: string[]): Promise<void> {
  if (scheduleIds.length === 0) return

  const results = await Promise.allSettled(
    scheduleIds.map((id) => qstash.schedules.delete(id))
  )

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`QStash 스케줄 삭제 실패 [${scheduleIds[i]}]:`, result.reason)
    }
  })
}
