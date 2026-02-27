import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import type { GuardianData } from '@/types/prescription'

const GUARDIAN_TTL = 60 * 60 * 24 * 30  // 30일

// 보호자 Chat ID 저장
// 클라이언트에서 NEXT_PUBLIC_ 없이 env에 접근 불가 → patientChatId는 항상 서버 env 사용
export async function POST(req: NextRequest) {
  const body = await req.json()
  const guardianChatId: string = body.guardianChatId
  const alerts = (body.alerts ?? []) as GuardianData['alerts']
  const patientChatId: string = process.env.TELEGRAM_CHAT_ID || ''

  if (!guardianChatId || !patientChatId) {
    return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })
  }

  await redis.set<GuardianData>(
    `guardian:${patientChatId}`,
    { guardianChatId, alerts },
    { ex: GUARDIAN_TTL }
  )

  return NextResponse.json({ success: true })
}

// 보호자 정보 조회 - patientChatId는 항상 서버 env 사용
export async function GET(req: NextRequest) {
  const patientChatId =
    req.nextUrl.searchParams.get('patientChatId') || process.env.TELEGRAM_CHAT_ID || ''

  if (!patientChatId) {
    return NextResponse.json({ error: 'patientChatId 필요' }, { status: 400 })
  }

  const data = await redis.get<GuardianData>(`guardian:${patientChatId}`)
  return NextResponse.json({ data })
}
