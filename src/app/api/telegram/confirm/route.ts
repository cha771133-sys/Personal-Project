import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

const VERIFIED_TTL_SECONDS = 30 * 24 * 60 * 60 // 30일

export async function POST(req: NextRequest) {
  let chatId: string, token: string
  try {
    const body = await req.json()
    chatId = body.chatId
    token = body.token
    if (!chatId || typeof chatId !== 'string') throw new Error('chatId 없음')
    if (!token || typeof token !== 'string') throw new Error('token 없음')
  } catch {
    return NextResponse.json({ error: 'chatId와 token이 필요합니다' }, { status: 400 })
  }

  const stored = await redis.get(`verify:${chatId}`)

  // Upstash는 숫자처럼 생긴 문자열을 JSON.parse하여 number로 반환할 수 있음
  // String()으로 정규화해 타입 불일치 비교 오류를 방지
  if (stored === null || stored === undefined || String(stored) !== token.trim()) {
    return NextResponse.json(
      { verified: false, error: '인증번호가 올바르지 않습니다' },
      { status: 401 }
    )
  }

  // 인증 성공: 검증 토큰 삭제 후 verified 플래그 저장 (30일 유효)
  await Promise.all([
    redis.del(`verify:${chatId}`),
    redis.set(`verified:${chatId}`, 'true', { ex: VERIFIED_TTL_SECONDS }),
  ])

  return NextResponse.json({ verified: true })
}
