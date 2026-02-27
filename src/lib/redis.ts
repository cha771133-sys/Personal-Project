import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const SCHEDULE_TTL_SECONDS = 60 * 24 * 60 * 60 // 60일

/**
 * 환자의 활성 QStash 스케줄 ID 목록을 Redis에 저장
 * Key: schedules:{patientChatId}
 */
export async function saveScheduleIds(
  patientChatId: string,
  scheduleIds: string[]
): Promise<void> {
  await redis.set(
    `schedules:${patientChatId}`,
    JSON.stringify(scheduleIds),
    { ex: SCHEDULE_TTL_SECONDS }
  )
}

/**
 * 환자의 활성 QStash 스케줄 ID 목록 조회
 * 키가 없거나 파싱 실패 시 빈 배열 반환
 */
export async function getScheduleIds(patientChatId: string): Promise<string[]> {
  try {
    const raw = await redis.get<string>(`schedules:${patientChatId}`)
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
