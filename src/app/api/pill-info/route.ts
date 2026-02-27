import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

export interface PillInfoResult {
  shape: string;
  color: string;
}

const MFDS_ENDPOINT =
  'http://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService01/getMdcinGrnIdntfcInfoList01';

// GET /api/pill-info?itemName=약품명
export async function GET(request: NextRequest) {
  const itemName = request.nextUrl.searchParams.get('itemName');
  if (!itemName) {
    return NextResponse.json({ error: 'itemName 파라미터가 필요합니다.' }, { status: 400 });
  }

  const apiKey = process.env.MFDS_API_KEY;
  if (!apiKey || apiKey.includes('식약처')) {
    return NextResponse.json({ error: 'MFDS_API_KEY 미설정' }, { status: 503 });
  }

  try {
    const url = new URL(MFDS_ENDPOINT);
    url.searchParams.set('item_name', itemName);
    url.searchParams.set('ServiceKey', apiKey);
    url.searchParams.set('type', 'json');
    url.searchParams.set('numOfRows', '1');
    url.searchParams.set('pageNo', '1');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return NextResponse.json({ error: `MFDS API ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const item = data?.body?.items?.[0];

    if (!item) {
      return NextResponse.json(null); // 정보 없음 - 조용히 null 반환
    }

    const result: PillInfoResult = {
      shape: item.DRUG_SHAPE ?? '',
      color: item.COLOR_CLASS1 ?? '',
    };

    return NextResponse.json(result);
  } catch (e) {
    console.error('[pill-info] 낱알식별 API 오류:', e);
    return NextResponse.json(null); // 실패해도 null로 조용히 처리
  }
}
