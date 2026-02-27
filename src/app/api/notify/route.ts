import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import { redis } from '@/lib/redis'
import type { NotifyPayload } from '@/lib/qstash'
import type { AlertType, GuardianData } from '@/types/prescription'

// 구형 alert 키(GuardianModeSwitch 저장값) → 새 AlertType 변환 맵
// 출처: GuardianModeSwitch.tsx의 GuardianAlerts 인터페이스 키 이름 기준
const LEGACY_ALERT_KEY_MAP: Record<string, AlertType> = {
  medicationDone:  'medication',
  missedDose:      'missed',
  newPrescription: 'refill',    // 실제 저장값은 'refillNeeded'가 아닌 'newPrescription'
}

/**
 * 구형/신형 alert 배열을 모두 AlertType[]으로 정규화
 * - undefined/빈 배열: 기존 레코드 보호를 위해 ['medication'] 반환
 * - 구형 키: LEGACY_ALERT_KEY_MAP으로 변환, 이미 신형이면 그대로 통과
 */
function normalizeAlerts(alerts: string[] | undefined): AlertType[] {
  if (!alerts || alerts.length === 0) return ['medication']
  return alerts.map((a) => LEGACY_ALERT_KEY_MAP[a] ?? (a as AlertType))
}

const IDEMPOTENCY_TTL = 90000 // 25시간 — 같은 날 중복 발송 차단

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
})

async function sendTelegram(chatId: string, text: string, label = ''): Promise<void> {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    console.error(`❌ 텔레그램 발송 실패 [${label || chatId}]:`, JSON.stringify(data))
  } else {
    console.log(`✅ 텔레그램 발송 성공 [${label || chatId}]`)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('upstash-signature') ?? ''

  // 명시적 플래그로만 서명 검증 우회 (SKIP_QSTASH_SIGNATURE=true, 로컬 개발 전용)
  const shouldVerify = process.env.SKIP_QSTASH_SIGNATURE !== 'true'
  if (shouldVerify) {
    const isValid = await receiver.verify({ body, signature }).catch(() => false)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  const payload: NotifyPayload = JSON.parse(body)
  const { guardianChatId, patientName, drugName, dose, scheduleTime } = payload
  // payload에 patientChatId가 없으면 env var로 fallback
  const patientChatId = payload.patientChatId || process.env.TELEGRAM_CHAT_ID || ''
  if (!patientChatId) {
    console.error('❌ TELEGRAM_CHAT_ID 환경변수가 설정되지 않았습니다.')
  }

  // ── 멱등성 체크: 오늘 이미 발송했으면 중복 차단 ──────────────
  const today = new Date().toISOString().slice(0, 10)
  const idempotencyKey = `notify:${patientChatId}:${drugName}:${scheduleTime}:${today}`

  const alreadySent = await redis.get(idempotencyKey).catch(() => null)
  if (alreadySent) {
    console.log(`⏭️ 중복 발송 차단: ${idempotencyKey}`)
    return NextResponse.json({ skipped: true, reason: 'duplicate' })
  }

  // ── 텔레그램 발송 ───────────────────────────────────────────
  console.log(`📤 환자 발송 시도: chatId=${patientChatId}`)
  await sendTelegram(
    patientChatId,
    `💊 <b>복약 시간이에요!</b>\n\n약 이름: ${drugName}\n복용량: ${dose}\n시간: ${scheduleTime}\n\n약 드시는 거 잊지 마세요 😊`,
    '환자'
  )

  if (guardianChatId) {
    // Redis에서 현재 보호자 알림 설정 조회 (설정 변경 시 즉시 반영)
    const guardianData = await redis.get<GuardianData>(`guardian:${patientChatId}`).catch(() => null)
    const normalized = normalizeAlerts(guardianData?.alerts)
    const alertType: AlertType = payload.alertType ?? 'medication'
    const shouldNotify = normalized.includes(alertType)

    if (shouldNotify) {
      console.log(`📤 보호자 발송 시도: chatId=${guardianChatId}`)
      const nameLabel = patientName ? `${patientName}님의` : '환자의'
      await sendTelegram(
        guardianChatId,
        `👤 <b>보호자 알림</b>\n\n${nameLabel} 복약 시간이에요.\n약: ${drugName} ${dose} ${scheduleTime}`,
        '보호자'
      )
    } else {
      console.warn(
        `[notify] 보호자 알림 스킵 — ` +
        `raw alerts: ${JSON.stringify(guardianData?.alerts)}, ` +
        `normalized: ${JSON.stringify(normalized)}, ` +
        `required: ${alertType}`
      )
    }
  } else {
    console.warn('⚠️ guardianChatId 없음 — 보호자 발송 스킵')
  }

  // ── 발송 완료 기록 (TTL: 25시간) ────────────────────────────
  await redis.set(idempotencyKey, '1', { ex: IDEMPOTENCY_TTL }).catch(() => null)

  return NextResponse.json({ success: true })
}
