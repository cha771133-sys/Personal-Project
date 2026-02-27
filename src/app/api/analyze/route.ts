import 'server-only';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import type { AnalyzeResponse, PrescriptionResult } from '@/types/prescription';
import { scheduleNotification, deleteSchedules } from '@/lib/qstash';
import { redis, saveScheduleIds, getScheduleIds } from '@/lib/redis';
import type { GuardianData } from '@/types/prescription';

// GET: API 키 및 사용 가능한 모델 목록 진단
export async function GET() {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey || apiKey === 'test-mode') {
    return NextResponse.json({ error: 'GOOGLE_API_KEY 미설정. .env.local을 확인하세요.', key: apiKey?.slice(0, 10) });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: '키 인증 실패', status: res.status, detail: data }, { status: 200 });
    }

    const modelNames = (data.models ?? []).map((m: { name: string }) => m.name);
    return NextResponse.json({ ok: true, models: modelNames, total: modelNames.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}

// v1beta 명시적 설정
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

const GEMINI_PROMPT = `당신은 처방전과 약 봉투를 분석하는 전문가입니다.
이미지를 보고 아래 정보를 추출해주세요:

1. 약 이름을 어르신이 이해하기 쉬운 말로 변환 (예: "아스피린프로텍트정" → "혈전예방약")
   - drug_name_simple은 반드시 medications 배열 내에서 서로 다른 고유한 값이어야 합니다.
   - 같은 계열 약이 여러 개인 경우 구분자를 추가하세요 (예: "당뇨 조절약 A", "당뇨 조절약 B" 또는 복용 시점 포함 "아침 당뇨약", "저녁 당뇨약")
2. 복용 시간 추정 기준: 아침 07:30 / 점심 12:30 / 저녁 18:30 / 취침 21:30
3. 복용 방법을 한국어로 쉽게 설명
4. 알약의 실제 색상과 모양을 추정해서 반환:
   - pill_color: 약의 대표 색상을 CSS hex 코드로 반환 (예: "#E85D75")
     * 당뇨약 계열 → 분홍/살구 계열 (#E8A0A0 ~ #F4C4C4)
     * 콜레스테롤약 → 흰색/크림 계열 (#F5F0E0 ~ #EDE0C0)
     * 혈압약 → 연파랑/보라 계열 (#A0B8E8 ~ #C4A0E8)
     * 소화제 → 연두/초록 계열 (#A8D8A0 ~ #C4E8B0)
     * 진통제 → 노랑/주황 계열 (#F0D080 ~ #F0B060)
     * 항생제 → 노랑/갈색 계열 (#E8D080 ~ #D4A840)
     * 비타민 → 주황/노랑 계열 (#F0A840 ~ #F0D060)
     * 처방전에 색상 정보 있으면 그것 우선 사용
   - pill_shape: round(원형정제) | capsule(캡슐) | tablet(타원형정제)
     * 기본값: tablet

처방전 이미지가 아니면 { "error": "처방전 이미지가 아닙니다" } 를 반환하세요.

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없음):
{
  "patient_name": "환자명",
  "hospital": "병원명",
  "prescription_date": "처방일자",
  "medications": [
    {
      "drug_name": "정확한 약품명",
      "drug_name_simple": "쉬운 약품명",
      "pill_color": "#E8A0A0",
      "pill_shape": "tablet",
      "dosage": "복용량",
      "frequency": 1,
      "timing": "아침/점심/저녁/취침",
      "duration_days": 14,
      "special_notes": "특이사항",
      "senior_friendly_instruction": "어르신을 위한 쉬운 설명",
      "alert_times": ["07:30"]
    }
  ],
  "general_warnings": ["주의사항"],
  "ocr_confidence": "high"
}`;

const MOCK_DATA: PrescriptionResult = {
  patient_name: '김복근',
  hospital: '내과의원',
  prescription_date: '2026-02-26',
  medications: [
    {
      drug_name: '자누메트정50/1000mg(내복)',
      drug_name_simple: '당뇨 조절약',
      pill_color: '#E8907A',  // 살구/연한 빨강 - 자누메트 실제 색상
      pill_shape: 'tablet',
      dosage: '1정',
      frequency: 2,
      timing: '아침/저녁',
      duration_days: 14,
      special_notes: '식후 복용',
      senior_friendly_instruction: '아침, 저녁 식사 후에 1알씩 드세요. 혈당(혈액 속 당분)을 조절해주는 약이에요.',
      alert_times: ['07:30', '18:30'],
    },
    {
      drug_name: '글루타존정(내복)',
      drug_name_simple: '혈당 낮추는 약',
      pill_color: '#E8C87A',  // 연한 노랑 - 글루타존 계열
      pill_shape: 'round',
      dosage: '1정',
      frequency: 1,
      timing: '아침',
      duration_days: 14,
      special_notes: '식후 복용',
      senior_friendly_instruction: '아침 식사 후에 1알 드세요. 혈당을 낮춰주는 약이에요.',
      alert_times: ['07:30'],
    },
    {
      drug_name: '글루코바이정100mg(내복)',
      drug_name_simple: '식후 혈당 조절약',
      pill_color: '#D4C4A8',  // 크림/베이지 - 글루코바이 실제 색상
      pill_shape: 'tablet',
      dosage: '1정',
      frequency: 2,
      timing: '아침/저녁',
      duration_days: 14,
      special_notes: '식사 직전 또는 식사 중 복용',
      senior_friendly_instruction: '밥 드시기 바로 전, 또는 밥 먹는 중에 1알 드세요. 식사 후 혈당이 너무 올라가지 않게 도와줘요.',
      alert_times: ['07:30', '18:30'],
    },
    {
      drug_name: '리피논정10mg(내복)',
      drug_name_simple: '콜레스테롤 낮추는 약',
      pill_color: '#A8C4E0',  // 연한 파랑 - 리피논 계열
      pill_shape: 'capsule',
      dosage: '1정',
      frequency: 1,
      timing: '저녁',
      duration_days: 14,
      special_notes: '',
      senior_friendly_instruction: '저녁 식사 후에 1알 드세요. 혈관에 기름때가 끼지 않도록 도와주는 약이에요.',
      alert_times: ['18:30'],
    },
  ],
  general_warnings: [
    '술을 드시면 안 됩니다.',
    '약을 드신 후 속이 불편하시면 병원에 연락하세요.',
    '임의로 약을 끊지 마세요.',
  ],
  ocr_confidence: 'high',
};

async function verifyMedication(drugName: string): Promise<{ verified: boolean; additional_info?: string }> {
  const apiKey = process.env.MFDS_API_KEY;
  if (!apiKey || apiKey.includes('식약처')) return { verified: false };

  try {
    const url = new URL('https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList');
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('itemName', drugName);
    url.searchParams.set('type', 'json');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error('식약처 API 오류:', res.status, res.statusText);
      return { verified: false };
    }

    const data = await res.json();
    const item = data.body?.items?.[0];
    return item
      ? { verified: true, additional_info: item.efcyQesitm || '' }
      : { verified: false };
  } catch (e) {
    console.error('식약처 API 요청 실패 (drugName:', drugName, '):', e);
    return { verified: false };
  }
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error(`텔레그램 전송 실패 [${chatId}]:`, data);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`텔레그램 전송 오류 [${chatId}]:`, e);
    return false;
  }
}

async function sendTelegramAlert(
  prescription: PrescriptionResult,
  patientChatId: string,
  guardianChatId?: string
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !patientChatId) return false;

  const count = prescription.medications.length;
  const patientName = prescription.patient_name || '환자'
  const timeSummary = [...new Set(
    prescription.medications.flatMap(m => m.alert_times ?? [])
  )].sort().join(', ')

  // 환자에게 발송
  const patientMsg =
    `✅ <b>처방전 등록 완료!</b>\n\n` +
    `총 ${count}개 약이 등록되었어요.\n` +
    `복약 시간: ${timeSummary || '미정'}\n` +
    `매일 복약 시간마다 알림을 보내드릴게요 😊`

  const patientSent = await sendTelegramMessage(botToken, patientChatId, patientMsg)
  console.log('✅ 환자 텔레그램 전송:', patientSent)

  // 보호자에게 발송 (guardianChatId가 있을 때만)
  if (guardianChatId) {
    const guardianMsg =
      `👤 <b>보호자 알림</b>\n\n` +
      `${patientName}님의 처방전이 새로 등록됐어요.\n` +
      `총 ${count}개 약 / 복약 시간: ${timeSummary || '미정'}\n\n` +
      `매일 복약 시간마다 알림을 보내드릴게요.`
    const guardianSent = await sendTelegramMessage(botToken, guardianChatId, guardianMsg)
    console.log('✅ 보호자 텔레그램 전송:', guardianSent)
  }

  return patientSent
}

async function sendToN8N(prescription: PrescriptionResult, phone?: string): Promise<boolean> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.includes('localhost')) return false;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prescription, phone, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e) {
    console.error('n8n 웹훅 전송 실패:', e);
    return false;
  }
}

export async function POST(request: NextRequest) {
  console.log('=== [처방전 분석 시작] ===');

  // ── 1. FormData 파싱 ──────────────────────────────────────
  let file: File;
  let phone: string | undefined;
  const patientChatId = process.env.TELEGRAM_CHAT_ID || '';
  if (!patientChatId) {
    console.error('❌ TELEGRAM_CHAT_ID 환경변수가 설정되지 않았습니다.');
  }
  try {
    const formData = await request.formData();
    const rawFile = formData.get('image');
    phone = formData.get('phone_number')?.toString() ?? undefined;

    if (!rawFile || !(rawFile instanceof File)) {
      return NextResponse.json<AnalyzeResponse>(
        { status: 'error', message: '사진을 선택해주세요.' },
        { status: 400 }
      );
    }
    file = rawFile;
  } catch (e) {
    console.error('FormData 파싱 오류:', e);
    return NextResponse.json<AnalyzeResponse>(
      { status: 'error', message: '사진 업로드 중 문제가 생겼어요. 다시 시도해주세요.' },
      { status: 400 }
    );
  }

  console.log('파일:', file.name, file.type, `${(file.size / 1024).toFixed(1)}KB`);

  // ── 2. 파일 검증 ─────────────────────────────────────────
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json<AnalyzeResponse>(
      { status: 'error', message: '사진 크기가 너무 커요. 10MB 이하로 올려주세요.' },
      { status: 400 }
    );
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json<AnalyzeResponse>(
      { status: 'error', message: '이미지 파일만 올릴 수 있어요.' },
      { status: 400 }
    );
  }

  // ── 3. API 키 검증 → 테스트 모드
  const apiKey = process.env.GOOGLE_API_KEY;
  console.log('🔑 GOOGLE_API_KEY 상태:', apiKey ? `설정됨 (${apiKey.slice(0, 8)}...)` : '미설정(undefined)');
  const isTestMode = !apiKey || apiKey === 'test-mode' || apiKey.trim() === '' || apiKey === 'your_key_here';
  console.log('🧪 테스트 모드 여부:', isTestMode);

  if (isTestMode) {
    console.warn('⚠️ 테스트 모드: GOOGLE_API_KEY가 설정되지 않아 Mock 데이터를 반환합니다.');
    console.warn('   → https://aistudio.google.com 에서 API 키를 발급 후 .env.local에 입력하세요.');
    return NextResponse.json<AnalyzeResponse>({
      status: 'success',
      data: MOCK_DATA,
      message: '처방전 분석이 완료됐어요! (테스트 모드)',
      alerts_registered: false,
    });
  }

  // ── 4. 이미지 → Base64 변환 ──────────────────────────────
  const bytes = await file.arrayBuffer();
  const base64Data = Buffer.from(bytes).toString('base64');
  // mimeType 안전 처리 (image/jpeg, image/png, image/webp, image/gif 만 허용)
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
  type AllowedMime = typeof allowedMimes[number];
  const mimeType: AllowedMime = allowedMimes.includes(file.type as AllowedMime)
    ? (file.type as AllowedMime)
    : 'image/jpeg';

  console.log('Base64 길이:', base64Data.length, '| mimeType:', mimeType);

  // ── 5. Gemini API 호출 ───────────────────────────────────
  try {
    console.log('🚀 Gemini 호출 시작 | 모델: gemini-2.5-flash | 이미지 크기:', `${(file.size / 1024).toFixed(1)}KB`);

    const model = genAI.getGenerativeModel(
      { model: 'gemini-2.5-flash' },
      { apiVersion: 'v1beta' }
    );

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Data,      // base64 문자열
          mimeType: mimeType,    // 반드시 포함
        },
      },
      GEMINI_PROMPT,
    ]);

    const responseText = result.response.text();
    console.log('✅ Gemini 응답 수신 | 길이:', responseText.length);
    console.log('📄 Gemini 응답 원문:', responseText);

    // ── 6. JSON 파싱 ────────────────────────────────────────
    let jsonText = responseText.trim();
    // 마크다운 코드블록 제거
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    // 앞뒤 불필요한 텍스트 제거: 첫 { 부터 마지막 } 까지만 추출
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonText = jsonMatch[0];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error('JSON 파싱 실패. 오류:', parseErr);
      console.error('JSON 파싱 실패. 원본 응답:', responseText.slice(0, 800));
      return NextResponse.json<AnalyzeResponse>(
        {
          status: 'error',
          message: '처방전을 읽는 중 문제가 생겼어요. 더 선명한 사진으로 다시 시도해주세요.',
        },
        { status: 422 }
      );
    }

    if (parsed.error) {
      return NextResponse.json<AnalyzeResponse>(
        { status: 'error', message: String(parsed.error) },
        { status: 400 }
      );
    }

    const prescriptionData = parsed as unknown as PrescriptionResult;

    // ── 6-1. 배열 필드 정규화 (Gemini가 문자열·null 등으로 반환 시 대비) ───
    const toArr = (val: unknown): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val as string[];
      if (typeof val === 'string') return val.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean);
      return [];
    };

    prescriptionData.general_warnings = toArr(prescriptionData.general_warnings);
    prescriptionData.medications = (prescriptionData.medications ?? []).map(med => ({
      ...med,
      alert_times: toArr(med.alert_times),
    }));

    // ── 6-2. drug_name_simple 중복 제거 (AI가 동일명 반환 시 안전망) ───
    const seen = new Map<string, number>();
    for (const med of prescriptionData.medications) {
      const original = med.drug_name_simple;
      const count = seen.get(original) ?? 0;
      if (count > 0) {
        med.drug_name_simple = `${original} ${count + 1}`;
      }
      seen.set(original, count + 1);
    }

    // ── 7. 식약처 검증 (선택) ────────────────────────────────
    for (const med of prescriptionData.medications) {
      const v = await verifyMedication(med.drug_name);
      if (v.verified && v.additional_info) {
        med.senior_friendly_instruction += ` (${v.additional_info})`;
      }
    }

    // ── 8. QStash cron 등록 (매일 반복 알림) ──────────────────
    console.log('보호자 조회 키:', `guardian:${patientChatId}`)
    const guardianData = await redis.get<GuardianData>(`guardian:${patientChatId}`).catch(() => null)
    console.log('보호자 조회 결과:', guardianData)

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://your-app.vercel.app'
    let alertsRegistered = false

    try {
      // 8-1. 기존 스케줄 삭제 — 재업로드 시 중복 알림 방지
      const existingIds = await getScheduleIds(patientChatId)
      if (existingIds.length > 0) {
        console.log(`🗑️ 기존 QStash 스케줄 ${existingIds.length}개 삭제 중...`)
        await deleteSchedules(existingIds)
      }

      // 8-2. 신규 스케줄 등록 후 ID 수집
      const newScheduleIds: string[] = []
      for (const med of prescriptionData.medications) {
        for (const time of med.alert_times ?? []) {
          console.log('QStash payload:', { patientChatId, guardianChatId: guardianData?.guardianChatId })
          const scheduleId = await scheduleNotification(
            time,
            {
              patientChatId,
              patientName: prescriptionData.patient_name,
              guardianChatId: guardianData?.guardianChatId,
              drugName: med.drug_name_simple,
              dose: med.dosage,
              scheduleTime: time,
              alertType: 'medication',
            },
            baseUrl
          )
          newScheduleIds.push(scheduleId)
        }
      }

      // 8-3. 새 스케줄 ID를 Redis에 저장 (다음 재분석 시 삭제용)
      await saveScheduleIds(patientChatId, newScheduleIds)

      alertsRegistered = true
      console.log(`✅ QStash 스케줄 ${newScheduleIds.length}개 등록 완료`)
    } catch (e) {
      console.error('QStash 스케줄 등록 실패 (알림은 계속 진행):', e)
    }

    // ── 9. 루프 완료 후 요약 텔레그램 1회 발송 (환자 + 보호자) ────
    const telegramSent = await sendTelegramAlert(
      prescriptionData,
      patientChatId,
      guardianData?.guardianChatId
    )

    console.log('텔레그램 전송:', telegramSent, '| QStash 등록:', alertsRegistered);

    return NextResponse.json<AnalyzeResponse>({
      status: 'success',
      data: prescriptionData,
      message: '처방전 분석이 완료됐어요!',
      alerts_registered: alertsRegistered,
    });

  } catch (error: unknown) {
    // ── 에러 상세 정보 클라이언트에 전달 ───────────────────
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Gemini 오류:', errMsg);

    // 에러 종류별 시니어 친화 메시지
    let userMessage = 'AI 분석 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.';
    let debugInfo = errMsg;

    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('401')) {
      userMessage = 'API 키가 올바르지 않아요.';
      debugInfo = 'API_KEY_INVALID';
    } else if (errMsg.includes('404')) {
      userMessage = 'AI 모델을 찾을 수 없어요. 관리자에게 문의해주세요.';
      debugInfo = errMsg.match(/\[.*?\]/)?.[0] ?? '404 Not Found';
    } else if (errMsg.includes('429')) {
      userMessage = '요청이 너무 많아요. 잠시 후 다시 시도해주세요.';
      debugInfo = '429 Rate Limit';
    } else if (errMsg.includes('SAFETY')) {
      userMessage = '이미지를 분석할 수 없어요. 다른 사진을 올려주세요.';
      debugInfo = 'SAFETY_BLOCK';
    }

    return NextResponse.json<AnalyzeResponse>(
      {
        status: 'error',
        message: `${userMessage} [${debugInfo}]`,
      },
      { status: 500 }
    );
  }
}
