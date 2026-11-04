import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { redis, getScheduleIds, saveScheduleIds } from '@/lib/redis';
import { deleteSchedulesWithFailures } from '@/lib/qstash';

// CONFIRMED_NOTIFICATIONS_V1: protect enumeration and deletion of QStash jobs.
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.DEVICE_PUBLISH_TOKEN;
  const supplied = request.headers.get('authorization') ?? '';
  if (!expected || expected.length < 32 || !supplied.startsWith('Bearer ')) return false;
  const a = Buffer.from(supplied.slice(7), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/schedules?patientChatId=xxx
 * 환자의 활성 QStash 스케줄 ID 목록 반환
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
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
  if (!isAuthorized(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let patientChatId: string

  try {
    const body = await request.json()
    patientChatId = body.patientChatId
    if (!patientChatId) throw new Error('patientChatId 없음')
  } catch {
    return NextResponse.json({ error: 'patientChatId가 필요합니다.' }, { status: 400 })
  }

  const active = await redis.get<{ scheduleIds?: string[] }>(`notifications:active:${patientChatId}`)
  const scheduleIds = [...new Set([
    ...(Array.isArray(active?.scheduleIds) ? active.scheduleIds : []),
    ...await getScheduleIds(patientChatId),
  ])]
  const failed = await deleteSchedulesWithFailures(scheduleIds)
  if (failed.length > 0) {
    await saveScheduleIds(patientChatId, failed)
    return NextResponse.json({ error: 'QSTASH_DELETE_PARTIAL_FAILURE', failed: failed.length }, { status: 502 })
  }
  await saveScheduleIds(patientChatId, [])
  await redis.del(`notifications:active:${patientChatId}`)
  await redis.del(`notifications:retired:${patientChatId}`)

  console.log(`🗑️ [schedules] ${patientChatId} 스케줄 ${scheduleIds.length}개 삭제 완료`)
  return NextResponse.json({ success: true, deleted: scheduleIds.length })
}
