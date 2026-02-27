# 약속 (Promise) 💊

시니어(60대 이상)를 위한 AI 복약 관리 시스템

처방전 사진 한 장으로 복약 알림을 자동 등록하고,
**브라우저를 닫아도** 환자·보호자에게 텔레그램 알림이 발송되는 서비스입니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 📸 **처방전 OCR** | Gemini Vision API로 처방전 자동 인식 및 약품 정보 추출 |
| 💊 **복약 카드** | 어르신이 이해하기 쉬운 언어 + 약 색상/모양 시각화 |
| 🔊 **음성 안내** | Web Speech API 기반 복약 정보 읽기 |
| 📲 **텔레그램 즉시 알림** | 분석 완료 즉시 환자에게 복약 등록 알림 발송 |
| ⏰ **서버 사이드 스케줄 알림** | QStash cron으로 매일 복약 시각에 자동 알림 (브라우저 종료 무관) |
| 👤 **보호자 알림** | 보호자 Chat ID 등록 시 환자와 동시에 텔레그램 발송 |
| 🔍 **약품 검증** | 식약처 공공 API로 약품 정보 교차 확인 |

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS v4 |
| AI | Google Gemini 2.5 Flash (Vision) |
| 알림 | Telegram Bot API |
| 스케줄링 | Upstash QStash (서버 사이드 cron) |
| 저장소 | Upstash Redis (보호자 정보 저장) |
| 약품 검증 | 식품의약품안전처 공공 API |

---

## 시스템 아키텍처

```
[홈 화면]
보호자 모드 ON → Chat ID 입력
→ POST /api/guardian → Upstash Redis 저장 (30일 TTL)

[처방전 분석]
→ POST /api/analyze
→ Gemini OCR 분석
→ 텔레그램 즉시 알림 발송
→ 약별 복약 시간마다 QStash cron 등록

[매일 복약 시각 — 브라우저 없어도 동작]
QStash → POST /api/notify
→ 환자 텔레그램 발송
→ 보호자 텔레그램 발송 (등록된 경우)
```

---

## 프로젝트 구조

```
promise/
├── .env.local                        # 환경 변수 (git 제외)
├── .env.example                      # 환경 변수 템플릿
├── src/
│   ├── app/
│   │   ├── page.tsx                  # 홈 (처방전 업로드)
│   │   ├── result/
│   │   │   └── page.tsx              # 분석 결과 화면
│   │   └── api/
│   │       ├── analyze/
│   │       │   └── route.ts          # Gemini OCR + QStash 스케줄 등록
│   │       ├── notify/
│   │       │   └── route.ts          # QStash가 호출하는 알림 발송 엔드포인트
│   │       └── guardian/
│   │           └── route.ts          # 보호자 Chat ID 저장/조회
│   ├── lib/
│   │   ├── redis.ts                  # Upstash Redis 클라이언트
│   │   ├── qstash.ts                 # QStash 스케줄 등록 헬퍼
│   │   └── historyStorage.ts         # 로컬 히스토리 저장
│   ├── components/
│   │   ├── UploadZone.tsx            # 사진 업로드 UI
│   │   └── MedicationCard.tsx        # 약품 결과 카드
│   ├── hooks/
│   │   └── useVoiceGuide.ts          # 음성 안내 훅
│   └── types/
│       └── prescription.ts           # 공통 타입 정의
└── public/
    └── sw.js                         # Service Worker (PWA)
```

---

## 환경 변수

### 전체 목록

```env
# Google Gemini AI
GOOGLE_API_KEY=

# 식약처 공공 API
MFDS_API_KEY=

# n8n 웹훅 (선택)
N8N_WEBHOOK_URL=

# 텔레그램 봇
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Upstash QStash
QSTASH_URL=
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# 배포 URL (QStash가 호출할 엔드포인트 기준)
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### API 키 발급 가이드

#### Google Gemini API Key
1. https://aistudio.google.com 접속
2. **Get API Key** → 새 키 생성
3. `.env.local`에 `GOOGLE_API_KEY` 입력

#### 식약처 공공 API Key
1. https://www.data.go.kr 접속
2. "의약품개요정보(e약은요)" API 신청
3. `.env.local`에 `MFDS_API_KEY` 입력

#### 텔레그램 봇
1. 텔레그램 → `@BotFather` → `/newbot` → 토큰 발급
2. `@userinfobot` 에서 본인 Chat ID 확인
3. `.env.local`에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 입력

#### Upstash Redis + QStash
1. https://console.upstash.com 접속 → 회원가입
2. **Redis** 탭 → 데이터베이스 생성 → REST URL & Token 복사
3. **QStash** 탭 → Token, Signing Keys 복사
4. `.env.local`에 각각 입력

---

## 설치 및 실행

```bash
# 패키지 설치
npm install

# 개발 서버 실행
npm run dev
# → http://localhost:3000

# 프로덕션 빌드
npm run build && npm start
```

---

## API 엔드포인트 명세

### `POST /api/analyze`
처방전 이미지를 분석하고 QStash 스케줄을 등록합니다.

**Request** — `multipart/form-data`
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `image` | File | ✅ | 처방전 이미지 (최대 10MB) |
| `phone_number` | string | - | 환자 전화번호 |

**Response**
```json
{
  "status": "success",
  "data": { /* PrescriptionResult */ },
  "message": "처방전 분석이 완료됐어요!",
  "alerts_registered": true
}
```

---

### `POST /api/notify`
QStash가 매일 복약 시각에 호출하는 텔레그램 발송 엔드포인트.
QStash 서명 검증 후 환자·보호자에게 메시지 발송.

**Request Header**
```
upstash-signature: <QStash 서명값>
```

**Request Body**
```json
{
  "patientChatId": "8773271434",
  "guardianChatId": "optional",
  "drugName": "혈당 조절약",
  "dose": "1정",
  "scheduleTime": "07:30"
}
```

---

### `POST /api/guardian`
보호자 Chat ID를 Redis에 저장합니다 (30일 TTL).

**Request Body**
```json
{
  "patientChatId": "8773271434",
  "guardianChatId": "보호자_chat_id",
  "alerts": ["07:30", "18:30"]
}
```

---

### `GET /api/guardian?patientChatId=xxx`
저장된 보호자 정보를 조회합니다.

**Response**
```json
{
  "data": {
    "guardianChatId": "보호자_chat_id",
    "alerts": ["07:30", "18:30"]
  }
}
```

---

## 로컬 테스트 방법

QStash는 외부 URL만 호출 가능하므로, 로컬에서는 `/api/notify`에 직접 POST 요청으로 확인합니다.

```bash
curl -X POST http://localhost:3000/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "patientChatId": "본인_TELEGRAM_CHAT_ID",
    "drugName": "혈당 조절약",
    "dose": "1정",
    "scheduleTime": "07:30"
  }'
```

> 로컬 테스트 시 서명 검증이 실패하므로, `src/app/api/notify/route.ts`의 `isValid` 체크를 임시로 우회하거나 Vercel에 배포 후 테스트하세요.

---

## Vercel 배포 시 주의사항

1. Vercel 대시보드 → **Environment Variables**에 `.env.local` 내용 전부 입력
2. `NEXT_PUBLIC_BASE_URL`을 실제 배포 URL로 변경
   ```
   NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app
   ```
3. QStash 무료 한도: **월 500 메시지** (하루 3회 × 30일 = 90개, 약 5명 동시 사용 가능)

---

## 시니어 UX 가이드라인

- ✅ 버튼 최소 높이 60px (py-4 이상)
- ✅ 폰트 최소 크기 18px (text-lg)
- ✅ 쉬운 한국어 에러 메시지
- ✅ 모든 버튼에 `aria-label` 추가
- ✅ 로딩 중 진행 상태 텍스트 표시
- ✅ 음성 안내 기능

---

## 라이선스

MIT License — Cursor Bootcamp Project
