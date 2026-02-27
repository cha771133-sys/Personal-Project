import 'server-only'
import { randomInt } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

const VERIFY_TTL_SECONDS = 5 * 60 // 5분

export async function POST(req: NextRequest) {
  let chatId: string
  try {
    const body = await req.json()
    chatId = body.chatId
    if (!chatId || typeof chatId !== 'string') throw new Error('chatId 없음')
  } catch {
    return NextResponse.json({ error: 'chatId가 필요합니다' }, { status: 400 })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN 미설정' }, { status: 500 })
  }

  // node:crypto의 randomInt 사용 (Web Crypto API에는 randomInt 없음)
  const token = String(randomInt(0, 1_000_000)).padStart(6, '0')

  // Redis에 먼저 저장: Telegram 타임아웃이 발생해도 키는 유효하게 유지
  await redis.set(`verify:${chatId}`, token, { ex: VERIFY_TTL_SECONDS })

  let telegramOk = false
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `인증번호: ${token} (5분 이내 입력해주세요)`,
      }),
    })
    const data = await res.json()
    telegramOk = res.ok && data.ok
    if (!telegramOk) {
      console.error('텔레그램 발송 실패:', JSON.stringify(data))
    }
  } catch (e) {
    // 네트워크 오류 또는 타임아웃: Redis 키는 그대로 두어 사용자가 수동 재시도 가능
    console.error('텔레그램 fetch 오류:', e)
  }

  if (!telegramOk) {
    // Redis 키를 삭제하지 않음 — 재발송 버튼 클릭 시 덮어씌워지고,
    // 만약 메시지가 실제로 전달됐다면 사용자가 코드를 입력할 수 있음
    return NextResponse.json(
      { error: '텔레그램 메시지 발송에 실패했습니다. Chat ID를 확인하거나 잠시 후 재시도해주세요.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ success: true })
}
