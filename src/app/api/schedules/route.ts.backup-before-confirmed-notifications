import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getScheduleIds, saveScheduleIds } from '@/lib/redis';
import { deleteSchedules } from '@/lib/qstash';

/**
 * GET /api/schedules?patientChatId=xxx
 * 환자의 활성 QStash 스케줄 ID 목록 반환
 */
export async function GET(request: NextRequest) {
  const patientChatId = request.nextUrl.searchParams.get('patientChatId')

  if (!patientChatId) {
    return NextResponse.json({ error: 'patientChatId가 필요합니다.' }, { status: 400 })
  }

  const scheduleIds = await getScheduleIds(patientChatId)
  return NextResponse.json({ patientChatId, scheduleIds, count: scheduleIds.length })
}

/**
 * DELETE /api/schedules
 * Body: { patientChatId: string }
 * 환자의 모든 활성 QStash 스케줄 삭제 + Redis 기록 초기화
 */
export async function DELETE(request: NextRequest) {
  let patientChatId: string

  try {
    const body = await request.json()
    patientChatId = body.patientChatId
    if (!patientChatId) throw new Error('patientChatId 없음')
  } catch {
    return NextResponse.json({ error: 'patientChatId가 필요합니다.' }, { status: 400 })
  }

  const scheduleIds = await getScheduleIds(patientChatId)

  if (scheduleIds.length === 0) {
    return NextResponse.json({ success: true, deleted: 0, message: '삭제할 스케줄이 없습니다.' })
  }

  await deleteSchedules(scheduleIds)
  // Redis 기록도 초기화
  await saveScheduleIds(patientChatId, [])

  console.log(`🗑️ [schedules] ${patientChatId} 스케줄 ${scheduleIds.length}개 삭제 완료`)
  return NextResponse.json({ success: true, deleted: scheduleIds.length })
}
