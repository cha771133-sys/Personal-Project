import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

// GET: 봇에 최근 메시지를 보낸 Chat ID 목록 확인용 (진단)
export async function GET() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN 없음' });
  }

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates`,
    { signal: AbortSignal.timeout(8000) }
  );
  const data = await res.json();

  if (!data.ok) {
    return NextResponse.json({ error: '봇 토큰 오류', detail: data });
  }

  const chats = (data.result ?? []).map((u: { message?: { chat: { id: number; first_name?: string } } }) => ({
    chat_id: u.message?.chat?.id,
    name: u.message?.chat?.first_name,
  }));

  return NextResponse.json({
    guide: '아래 chat_id 중 본인 것을 .env.local의 TELEGRAM_CHAT_ID에 입력하세요',
    chats,
    raw_count: data.result?.length ?? 0,
  });
}

export async function POST(request: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return NextResponse.json(
      { status: 'error', message: '텔레그램 설정이 되어 있지 않아요. 관리자에게 문의해주세요.' },
      { status: 500 }
    );
  }

  let message: string;
  let targetChatId: string;
  try {
    const body = await request.json();
    message = body.message;
    if (!message || typeof message !== 'string') throw new Error('message 없음');
    // body.chatId(보호자 Chat ID) 우선, 없으면 env의 TELEGRAM_CHAT_ID fallback
    targetChatId = (body.chatId as string) || chatId;
  } catch {
    return NextResponse.json(
      { status: 'error', message: '전송할 내용이 없어요.' },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: message, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.ok) {
      console.error('텔레그램 전송 실패:', data);
      return NextResponse.json(
        { status: 'error', message: '텔레그램 전송에 실패했어요. 잠시 후 다시 시도해주세요.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ status: 'success', message: '텔레그램으로 알림을 보냈어요!' });

  } catch (e) {
    console.error('텔레그램 API 오류:', e);
    return NextResponse.json(
      { status: 'error', message: '인터넷 연결을 확인하고 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
