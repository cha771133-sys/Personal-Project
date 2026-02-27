# 약속 (YakSok) — 프로젝트 명세서

> 처방전 사진 한 장으로 복약 안내부터 반복 알림까지 — 시니어를 위한 스마트 복약 도우미

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **서비스명** | 약속 (YakSok) |
| **목적** | 처방전 사진을 AI로 분석해 복약 정보를 쉽게 안내하고, 텔레그램 알림으로 복약 시간을 챙겨주는 시니어 친화 웹앱 |
| **주요 사용자** | 복약 관리가 필요한 어르신 + 돌봄 보호자 |
| **스택** | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Upstash Redis, QStash, Telegram Bot API, Google Gemini AI |

---

## 2. 핵심 기능

| # | 기능 | 설명 |
|---|------|------|
| 1 | **처방전 AI 분석** | 처방전 사진을 Gemini 2.5 Flash로 분석 → 약품명, 복용량, 복용 시간 추출 |
| 2 | **시니어 친화 안내** | 어려운 약품명을 쉬운 말로 변환 ("아스피린프로텍트정" → "혈전예방약") |
| 3 | **텔레그램 즉시 알림** | 분석 완료 즉시 텔레그램으로 복약 정보 전송 |
| 4 | **QStash 반복 알림** | 매일 복용 시간마다 cron으로 자동 알림 (브라우저 꺼도 동작) |
| 5 | **브라우저 푸시 알림** | Service Worker 기반 브라우저 알림 |
| 6 | **보호자 모드** | 보호자 Chat ID 등록 시 환자 복약 현황 동시 수신 |
| 7 | **처방전 기록** | 분석 이력 localStorage 저장 및 조회 |
| 8 | **복약 달력** | 날짜별 복약 체크리스트 |
| 9 | **음성 안내** | Web Speech API TTS로 약 정보 읽어주기 |
| 10 | **글자 크기 조절** | small / base / large 3단계 폰트 사이즈 |

---

## 3. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                        Client (Browser)                       │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ 홈 페이지 │  │  결과 페이지  │  │ 달력 / 기록 / 보호자  │   │
│  │(업로드)   │  │(약품 카드)    │  │        설정          │   │
│  └────┬─────┘  └──────┬───────┘  └──────────────────────┘   │
│       │               │                                       │
└───────┼───────────────┼───────────────────────────────────────┘
        │               │
        ▼               ▼
┌───────────────────────────────────────────────────────────────┐
│                   Next.js API Routes (Server)                  │
│                                                               │
│  POST /api/analyze ──► Gemini 2.5 Flash (처방전 분석)         │
│       │                                                       │
│       ├──► Telegram Bot API  (즉시 알림 전송)                  │
│       ├──► Upstash Redis     (보호자 정보 조회)                │
│       └──► QStash            (cron 스케줄 등록)               │
│                    │                                          │
│  POST /api/notify ◄┘  (매일 복용 시간마다 QStash가 호출)       │
│       └──► Telegram Bot API  (환자 + 보호자 알림 발송)         │
│                                                               │
│  POST /api/guardian  ──► Upstash Redis (보호자 정보 저장)     │
│  GET  /api/guardian  ──► Upstash Redis (보호자 정보 조회)     │
│  POST /api/telegram  ──► Telegram Bot API (메시지 전송)       │
│  GET  /api/pill-info ──► 식약처 낱알식별 API (약품 정보)       │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│  External Services        │
│  · Google Gemini AI       │
│  · Telegram Bot API       │
│  · Upstash Redis          │
│  · Upstash QStash         │
│  · 식약처 API (MFDS)      │
│  · ngrok (로컬 터널)       │
└──────────────────────────┘
```

---

## 4. 전체 워크플로우

### 4-1. 처방전 분석 → 알림 등록 플로우

```
사용자
  │
  ▼
① 처방전 사진 업로드 (UploadZone)
  │
  ▼
② POST /api/analyze
  │  ├─ [파일 검증] 10MB 이하, image/* 타입 확인
  │  ├─ [Gemini 호출] gemini-2.5-flash 모델로 이미지 분석
  │  │     → 약품명(쉬운말), 복용량, 복용시간, pill 색상/모양 추출
  │  ├─ [배열 정규화] alert_times, general_warnings 안전 변환
  │  ├─ [중복 제거] drug_name_simple 동일명 자동 구분
  │  ├─ [식약처 검증] 약품명 추가 정보 보강 (선택)
  │  ├─ [텔레그램 즉시 전송] 환자에게 복약 정보 메시지 발송
  │  ├─ [Redis 조회] guardian:{patientChatId} 에서 보호자 정보 로드
  │  └─ [QStash 등록] 약별 alert_times마다 cron 스케줄 생성
  │        └─ endpoint: NEXT_PUBLIC_BASE_URL/api/notify
  │
  ▼
③ 결과 페이지 (/result)
     ├─ 약품 카드 리스트 / 카드 슬라이드 뷰
     ├─ 음성 안내 (TTS)
     ├─ 알림 ON/OFF 토글
     ├─ 텔레그램 5분 전 알림 예약 버튼
     ├─ 브라우저 푸시 알림 버튼
     └─ 처방전 기록 자동 저장 (localStorage)
```

### 4-2. QStash 반복 알림 플로우

```
QStash (매일 cron 실행)
  │
  ▼
POST /api/notify  ← QStash 서명 검증 (프로덕션에서만)
  │  payload: { patientChatId, guardianChatId, drugName, dose, scheduleTime }
  │
  ├─ 환자에게 텔레그램 전송
  │    "💊 복약 시간이에요! 약: 혈압약, 1정, 08:00"
  │
  └─ 보호자에게 텔레그램 전송 (guardianChatId 있을 때)
       "👤 보호자 알림: 08:00 복약 알림 발송됨"
```

### 4-3. 보호자 등록 플로우

```
사용자 (홈 화면)
  │
  ▼
① 보호자 모드 토글 ON
  │
  ▼
② 환자 Chat ID 입력 + 보호자 Chat ID 입력 + 받을 알림 선택
  │
  ▼
③ "보호자 설정 저장" 클릭
  │
  ├─ POST /api/guardian → Redis 저장 (guardian:{patientChatId}, TTL 30일)
  └─ localStorage 동기 저장 (재접속 시 복원)
  │
  ▼
④ 이후 /api/analyze 호출 시 Redis에서 보호자 조회 → QStash에 guardianChatId 포함 등록
```

---

## 5. 파일 구조

```
src/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts      # 처방전 분석 (Gemini + 알림 등록)
│   │   ├── guardian/route.ts     # 보호자 정보 CRUD (Redis)
│   │   ├── notify/route.ts       # QStash 웹훅 수신 → 텔레그램 발송
│   │   ├── pill-info/route.ts    # 식약처 낱알식별 API 프록시
│   │   └── telegram/route.ts    # 텔레그램 메시지 전송
│   ├── calendar/page.tsx         # 복약 달력 (체크리스트)
│   ├── history/page.tsx          # 처방전 기록
│   ├── result/page.tsx           # 분석 결과
│   ├── globals.css               # CSS 변수 (테마, 애니메이션)
│   ├── layout.tsx                # 루트 레이아웃
│   └── page.tsx                  # 홈 (업로드)
├── components/
│   ├── home/
│   │   ├── FontSizeControl.tsx   # 글자 크기 조절
│   │   └── GuardianModeSwitch.tsx # 보호자 모드 설정
│   ├── BottomNav.tsx             # 하단 탭 네비게이션
│   ├── MedicationCard.tsx        # 약품 카드
│   ├── PillBadge.tsx             # 알약 시각화 뱃지
│   ├── PillCustomizer.tsx        # 알약 커스터마이저 모달
│   ├── SwRegister.tsx            # Service Worker 등록
│   └── UploadZone.tsx            # 처방전 업로드
├── hooks/
│   ├── useNotification.ts        # 브라우저 알림 스케줄링
│   └── useVoiceGuide.ts          # TTS 음성 안내
├── lib/
│   ├── historyStorage.ts         # 처방전 기록 (localStorage)
│   ├── qstash.ts                 # QStash 클라이언트
│   └── redis.ts                  # Upstash Redis 클라이언트
└── types/
    └── prescription.ts           # 타입 정의
```

---

## 6. 외부 서비스 & 환경변수

| 환경변수 | 서비스 | 용도 |
|---------|--------|------|
| `GOOGLE_API_KEY` | Google Gemini AI | 처방전 이미지 분석 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API | 알림 메시지 발송 |
| `TELEGRAM_CHAT_ID` | Telegram | 환자 기본 Chat ID |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis | 보호자 정보 저장 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis | 인증 토큰 |
| `QSTASH_URL` | Upstash QStash | 스케줄 알림 등록 |
| `QSTASH_TOKEN` | Upstash QStash | 인증 토큰 |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash QStash | 웹훅 서명 검증 |
| `QSTASH_NEXT_SIGNING_KEY` | Upstash QStash | 웹훅 서명 검증 (교체용) |
| `NEXT_PUBLIC_BASE_URL` | — | QStash 웹훅 엔드포인트 URL |
| `MFDS_API_KEY` | 식약처 API | 약품 낱알 정보 조회 (선택) |
| `N8N_WEBHOOK_URL` | n8n | 자동화 워크플로우 연동 (선택) |

---

## 7. 주요 데이터 모델

### Medication
```typescript
{
  drug_name: string               // 정확한 약품명
  drug_name_simple: string        // 시니어 친화 쉬운 이름
  pill_color: string              // CSS hex 색상
  pill_shape: 'round' | 'capsule' | 'tablet'
  dosage: string                  // 복용량 (예: "1정")
  frequency: number               // 1일 복용 횟수
  timing: string                  // 아침/저녁 등
  duration_days: number           // 복약 기간(일)
  special_notes: string           // 특이사항
  senior_friendly_instruction: string  // 쉬운 설명
  alert_times: string[]           // 알림 시간 배열 ["07:30", "18:30"]
}
```

### GuardianData (Redis)
```typescript
{
  guardianChatId: string   // 보호자 텔레그램 Chat ID
  alerts: string[]         // 받을 알림 종류
}
// Redis Key: guardian:{patientChatId}  TTL: 30일
```

### NotifyPayload (QStash)
```typescript
{
  patientChatId: string
  guardianChatId?: string
  drugName: string
  dose: string
  scheduleTime: string     // "08:00"
}
```

---

## 8. 로컬 개발 환경 설정

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local에 각 API 키 입력

# 3. ngrok 터널 실행 (QStash 웹훅용)
& "C:\Users\{user}\AppData\Roaming\npm\node_modules\ngrok\bin\ngrok.exe" http 3000
# → NEXT_PUBLIC_BASE_URL을 ngrok URL로 업데이트

# 4. 개발 서버 실행
npm run dev
# → http://localhost:3000
```

---

## 9. 알려진 제약 / TODO

| 항목 | 상태 | 비고 |
|------|------|------|
| QStash 로컬 테스트 | 제한 | ngrok 필요 (localhost 미지원) |
| 보호자 알림 조건부 발송 | 미구현 | alerts 필드 실제 분기 로직 필요 |
| 식약처 API | 선택적 | API 키 없으면 자동 스킵 |
| 다중 환자 지원 | 미구현 | 현재 단일 TELEGRAM_CHAT_ID 고정 |
| 인증 / 로그인 | 없음 | Telegram Chat ID가 식별자 역할 |
| 테스트 코드 | 없음 | 추후 추가 필요 |
