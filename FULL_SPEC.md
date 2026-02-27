# 약속 (YakSok) — 종합 프로젝트 명세서 & 워크플로우

> **목적**: 이 문서는 프로젝트의 전체 설계, 기능, 기술 스택, 워크플로우를 정리한 최종 명세서입니다.
> AI 피드백 요청 / 코드 리뷰 / 온보딩용으로 활용할 수 있습니다.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **서비스명** | 약속 (YakSok) |
| **슬로건** | 처방전 사진 한 장으로 복약 안내부터 반복 알림까지 |
| **목적** | 처방전 이미지를 AI로 분석해 시니어가 이해하기 쉬운 복약 정보를 제공하고, 텔레그램 + QStash로 매일 복약 시간 알림을 자동화하는 스마트 복약 도우미 |
| **주요 사용자** | 복약 관리가 필요한 어르신(시니어) + 돌봄 보호자 |
| **개발 기간** | 단기 부트캠프 프로젝트 (MVP 완성) |

---

## 2. 기술 스택 (Tech Stack)

| 레이어 | 기술 | 버전/비고 |
|--------|------|-----------|
| **Frontend Framework** | Next.js (App Router) | 16.x, Turbopack |
| **Language** | TypeScript | 5.x |
| **Styling** | Tailwind CSS | v4 |
| **AI 분석** | Google Gemini AI | gemini-2.5-flash |
| **알림 스케줄링** | Upstash QStash | cron 기반 반복 알림 |
| **상태 저장 (서버)** | Upstash Redis | 보호자 정보 (TTL 30일) |
| **알림 채널** | Telegram Bot API | 환자 + 보호자 동시 전송 |
| **브라우저 알림** | Web Push API + Service Worker | 오프라인 지원 |
| **음성 안내** | Web Speech API (TTS) | 한국어, 자동 재생 |
| **로컬 저장** | localStorage | 처방전 기록, 보호자 설정 |
| **식약처 API** | 공공데이터 낱알식별 API | 선택적 약품 정보 보강 |
| **로컬 터널** | ngrok | QStash 웹훅 로컬 테스트용 |

---

## 3. 핵심 기능 명세

### 3-1. 처방전 AI 분석
- 사용자가 처방전 사진을 업로드 (파일 선택 / 드래그앤드롭 / 카메라 촬영)
- `POST /api/analyze` 에서 Google Gemini 2.5 Flash로 이미지 분석
- 추출 항목: 약품명(정확), 약품명(쉬운말), 알약 색상/모양, 복용량, 복용 횟수, 복용 시간, 주의사항, 시니어 친화 설명
- 동일한 `drug_name_simple`이 있을 때 자동으로 구분자 추가 (중복 제거)
- `alert_times`, `general_warnings` 배열 안전 정규화 (string 입력 방어 처리)

### 3-2. 시니어 친화 UI
- 최소 버튼 크기 60px, 최소 폰트 18px
- 글자 크기 3단계 조절 (small / base / large) — `FontSizeControl` 컴포넌트
- 쉬운 말 변환: "아스피린프로텍트정" → "혈전예방약"
- 에러 메시지도 쉬운 한국어로 표시

### 3-3. 음성 안내 (TTS)
- Web Speech API 활용, 한국어(ko-KR), 속도 0.85, 피치 1.1
- 결과 페이지 진입 시 자동 재생 옵션
- 개별 약품 카드에서 수동 재생 가능
- SSR 환경(서버) 대응 처리

### 3-4. 텔레그램 즉시 알림
- 처방전 분석 완료 즉시 환자 Chat ID로 텔레그램 메시지 전송
- `POST /api/telegram` 을 통한 메시지 발송
- 보호자 Chat ID가 등록된 경우 동시 수신

### 3-5. QStash 반복 알림 (핵심)
- 분석 시 약별 `alert_times`마다 QStash cron 스케줄 자동 등록
- 매일 해당 시간에 `POST /api/notify` 호출 → 텔레그램 발송
- 브라우저가 꺼져도 서버 사이드에서 동작
- 프로덕션 환경에서 QStash 서명 검증 적용

### 3-6. 보호자 모드
- 홈 화면에서 보호자 모드 토글 ON
- 환자 Chat ID + 보호자 Chat ID + 받을 알림 종류 입력
- `POST /api/guardian` → Upstash Redis 저장 (`guardian:{patientChatId}`, TTL 30일)
- 이후 분석 시 Redis에서 보호자 정보 조회 → QStash에 `guardianChatId` 포함 등록
- `localStorage`에도 동기 저장 (재접속 시 복원)

### 3-7. 브라우저 푸시 알림
- Service Worker (`public/sw.js`) 등록 — `SwRegister` 컴포넌트
- `useNotification` 훅으로 알림 권한 요청 및 스케줄 관리

### 3-8. 처방전 기록
- `lib/historyStorage.ts` — localStorage 기반 분석 이력 CRUD
- `/history` 페이지에서 과거 처방전 목록 조회

### 3-9. 복약 달력
- `/calendar` 페이지 — 날짜별 복약 체크리스트

### 3-10. 약품 시각화
- `PillBadge` — 알약 색상 & 모양 시각적 표현
- `PillCustomizer` — 알약 색상/모양 사용자 직접 수정 모달

---

## 4. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  홈 (업로드)  │  │  결과 페이지  │  │ 달력 / 기록 / 보호자  │  │
│  │  page.tsx    │  │  result/     │  │  calendar/ history/  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │
│         │                 │                                     │
│  [UploadZone]      [MedicationCard]  [FontSizeControl]         │
│  [GuardianModeSwitch]               [PillBadge / PillCustomizer]│
│  [BottomNav]  [SwRegister]                                      │
└─────────────┬───────────────────────────────────────────────────┘
              │  HTTP Request
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Next.js API Routes (Server)                    │
│                                                                 │
│  POST /api/analyze ──► Gemini 2.5 Flash (처방전 분석)           │
│       │                                                         │
│       ├──► Telegram Bot API  (즉시 알림)                         │
│       ├──► Upstash Redis     (보호자 정보 조회)                   │
│       └──► QStash            (cron 스케줄 등록)                  │
│                    │                                            │
│  POST /api/notify ◄┘  (매일 복용 시간마다 QStash가 자동 호출)    │
│       └──► Telegram Bot API  (환자 + 보호자 알림 발송)           │
│                                                                 │
│  POST /api/guardian  ──► Upstash Redis (보호자 저장)            │
│  GET  /api/guardian  ──► Upstash Redis (보호자 조회)            │
│  POST /api/telegram  ──► Telegram Bot API (메시지 전송)         │
│  GET  /api/pill-info ──► 식약처 낱알식별 API (약품 정보)         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────┐
│         External Services            │
│  · Google Gemini AI (이미지 분석)    │
│  · Telegram Bot API (알림 채널)      │
│  · Upstash Redis (보호자 데이터)     │
│  · Upstash QStash (cron 스케줄러)   │
│  · 식약처 MFDS API (약품 DB)         │
│  · ngrok (로컬 웹훅 터널)            │
└──────────────────────────────────────┘
```

---

## 5. 전체 워크플로우

### 워크플로우 A — 처방전 분석 → 알림 등록

```
사용자 (홈 화면)
  │
  │ 1. 처방전 사진 업로드 (파일선택 / 드래그앤드롭 / 카메라)
  ▼
UploadZone 컴포넌트
  │ 파일 선택 → 이미지 미리보기 표시
  │ "분석하기" 버튼 클릭
  ▼
POST /api/analyze
  │
  ├─ [Step 1] 파일 검증
  │      └─ 10MB 이하, image/* MIME 타입 확인
  │
  ├─ [Step 2] Gemini 2.5 Flash 호출
  │      └─ 이미지 → JSON 구조화 응답 추출
  │            · drug_name (정확한 약품명)
  │            · drug_name_simple (쉬운 이름)
  │            · pill_color, pill_shape
  │            · dosage, frequency, timing, duration_days
  │            · special_notes, senior_friendly_instruction
  │            · alert_times: string[]  ← 핵심
  │
  ├─ [Step 3] 데이터 정규화
  │      └─ alert_times / general_warnings 배열 안전 변환
  │      └─ drug_name_simple 중복 시 자동 구분 처리
  │
  ├─ [Step 4] 식약처 API 보강 (선택적)
  │      └─ MFDS_API_KEY 있을 때만 실행
  │
  ├─ [Step 5] 텔레그램 즉시 전송
  │      └─ 환자 Chat ID로 복약 정보 메시지 발송
  │
  ├─ [Step 6] Redis에서 보호자 조회
  │      └─ Key: guardian:{patientChatId}
  │
  └─ [Step 7] QStash cron 등록
         └─ 각 약품의 각 alert_time마다 스케줄 생성
               · endpoint: {BASE_URL}/api/notify
               · cron: "30 7 * * *"  (예: 매일 07:30)
               · payload: { patientChatId, guardianChatId?, drugName, dose, scheduleTime }
  │
  ▼ (200 응답: medications[], generalWarnings[])
  │
결과 페이지 (/result)
  ├─ 약품 카드 리스트 렌더링 (MedicationCard)
  ├─ 알약 시각화 (PillBadge, pill_color/pill_shape)
  ├─ 음성 안내 자동 시작 (useVoiceGuide)
  ├─ 알림 ON/OFF 토글
  ├─ 브라우저 푸시 알림 버튼 (useNotification)
  └─ localStorage에 처방전 기록 자동 저장 (historyStorage)
```

---

### 워크플로우 B — QStash 반복 알림 (서버 사이드 자동화)

```
Upstash QStash 스케줄러
  │
  │ 매일 등록된 cron 시간에 자동 실행
  ▼
POST /api/notify
  │
  ├─ [Step 1] QStash 서명 검증
  │      └─ QSTASH_CURRENT_SIGNING_KEY 로 서명 확인
  │      └─ 개발 환경에서는 스킵 (NODE_ENV !== 'production')
  │
  ├─ [Step 2] payload 파싱
  │      └─ { patientChatId, guardianChatId?, drugName, dose, scheduleTime }
  │
  ├─ [Step 3] 환자에게 텔레그램 전송
  │      └─ "💊 복약 시간이에요!\n약: 혈압약 | 용량: 1정 | 시간: 08:00"
  │
  └─ [Step 4] 보호자에게 텔레그램 전송 (guardianChatId 있을 때)
         └─ "👤 [보호자 알림] 08:00 복약 알림이 어르신께 발송되었습니다."
```

---

### 워크플로우 C — 보호자 등록

```
사용자 (홈 화면 하단)
  │
  │ 1. "보호자 모드" 토글 ON
  ▼
GuardianModeSwitch 컴포넌트
  │
  │ 2. 입력 폼 노출
  │      · 환자 텔레그램 Chat ID
  │      · 보호자 텔레그램 Chat ID
  │      · 받을 알림 종류 체크박스
  │
  │ 3. "보호자 설정 저장" 클릭
  ▼
POST /api/guardian
  ├─ Upstash Redis 저장
  │      Key: guardian:{patientChatId}
  │      Value: { guardianChatId, alerts: string[] }
  │      TTL: 30일 (자동 만료)
  └─ localStorage 동기 저장 (재접속 복원용)
  │
  ▼
이후 /api/analyze 호출 시
  └─ Redis 조회 → QStash에 guardianChatId 자동 포함
```

---

### 워크플로우 D — 음성 안내 (TTS)

```
결과 페이지 진입
  │
  ▼
useVoiceGuide 훅 초기화
  ├─ window.speechSynthesis 존재 확인 (SSR 방어)
  ├─ 한국어 음성 선택 (ko-KR)
  ├─ 속도 0.85 / 피치 1.1 설정
  └─ autoPlay: true 이면 자동 재생 시작
  │
  ▼
재생 순서:
  1. 총 약품 수 안내
  2. 각 약품: "{쉬운이름}. {용량}, {복용 시간}에 드세요. {주의사항}"
  3. 마지막: "오늘도 건강하게 지내세요!"
```

---

## 6. 파일 구조 (Full)

```
promise/
├── public/
│   └── sw.js                          # Service Worker (브라우저 푸시 알림)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze/route.ts       # 처방전 분석 (Gemini + 텔레그램 + QStash)
│   │   │   ├── guardian/route.ts      # 보호자 정보 CRUD (Upstash Redis)
│   │   │   ├── notify/route.ts        # QStash 웹훅 수신 → 텔레그램 발송
│   │   │   ├── pill-info/route.ts     # 식약처 낱알식별 API 프록시
│   │   │   └── telegram/route.ts      # 텔레그램 메시지 전송 유틸
│   │   ├── calendar/page.tsx          # 복약 달력 (날짜별 체크리스트)
│   │   ├── history/page.tsx           # 처방전 분석 기록
│   │   ├── result/page.tsx            # 분석 결과 (약품 카드 목록)
│   │   ├── globals.css                # 전역 CSS 변수 (테마, 애니메이션)
│   │   ├── layout.tsx                 # 루트 레이아웃
│   │   └── page.tsx                   # 홈 (처방전 업로드)
│   ├── components/
│   │   ├── home/
│   │   │   ├── FontSizeControl.tsx    # 글자 크기 3단계 조절
│   │   │   └── GuardianModeSwitch.tsx # 보호자 모드 설정 폼
│   │   ├── BottomNav.tsx              # 하단 탭 네비게이션
│   │   ├── MedicationCard.tsx         # 약품 정보 카드 (음성 재생 포함)
│   │   ├── PillBadge.tsx              # 알약 색상/모양 시각화
│   │   ├── PillCustomizer.tsx         # 알약 커스터마이저 모달
│   │   ├── SwRegister.tsx             # Service Worker 등록
│   │   └── UploadZone.tsx             # 처방전 업로드 (파일/카메라/드래그)
│   ├── hooks/
│   │   ├── useNotification.ts         # 브라우저 알림 권한 요청 및 스케줄
│   │   └── useVoiceGuide.ts           # TTS 음성 안내 훅
│   ├── lib/
│   │   ├── historyStorage.ts          # localStorage 기반 처방전 기록 CRUD
│   │   ├── qstash.ts                  # Upstash QStash 클라이언트 래퍼
│   │   └── redis.ts                   # Upstash Redis 클라이언트 래퍼
│   └── types/
│       └── prescription.ts            # 전체 TypeScript 타입 정의
├── .env.example                        # 환경변수 템플릿
├── .env.local                          # 실제 환경변수 (git 제외)
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 7. 데이터 모델

### Medication (핵심 타입)
```typescript
interface Medication {
  drug_name: string                    // 정확한 약품명 (예: "아스피린프로텍트정100mg")
  drug_name_simple: string             // 시니어 친화 이름 (예: "혈전예방약")
  pill_color: string                   // CSS hex 색상 (예: "#FF6B6B")
  pill_shape: 'round' | 'capsule' | 'tablet'
  dosage: string                       // 복용량 (예: "1정")
  frequency: number                    // 1일 복용 횟수
  timing: string                       // 복용 시점 (예: "아침 식후")
  duration_days: number                // 복약 기간(일)
  special_notes: string                // 특이사항 (예: "공복 복용 금지")
  senior_friendly_instruction: string  // 쉬운 복용 설명
  alert_times: string[]                // 알림 시간 (예: ["07:30", "18:30"])
}
```

### AnalyzeResponse (API 응답)
```typescript
interface AnalyzeResponse {
  medications: Medication[]
  generalWarnings: string[]            // 전체 주의사항
  patientName?: string
  prescriptionDate?: string
}
```

### GuardianData (Redis 저장 구조)
```typescript
interface GuardianData {
  guardianChatId: string               // 보호자 텔레그램 Chat ID
  alerts: string[]                     // 받을 알림 종류 (예: ["medication", "missed"])
}
// Redis Key: guardian:{patientChatId}
// TTL: 30일 자동 만료
```

### NotifyPayload (QStash → /api/notify 페이로드)
```typescript
interface NotifyPayload {
  patientChatId: string
  guardianChatId?: string
  drugName: string
  dose: string
  scheduleTime: string                 // "08:00"
}
```

### PrescriptionHistory (localStorage)
```typescript
interface PrescriptionHistory {
  id: string                           // uuid
  date: string                         // ISO 날짜
  medications: Medication[]
  generalWarnings: string[]
  imagePreview?: string                // base64 썸네일 (선택)
}
```

---

## 8. API 엔드포인트 명세

### POST /api/analyze
| 항목 | 내용 |
|------|------|
| **Request** | `multipart/form-data` — `image: File` (최대 10MB) |
| **Response** | `{ medications: Medication[], generalWarnings: string[] }` |
| **사이드이펙트** | 텔레그램 즉시 전송, QStash cron 등록 |
| **에러** | 400 (파일 없음/크기 초과), 500 (Gemini 분석 실패) |

### POST /api/notify
| 항목 | 내용 |
|------|------|
| **Caller** | Upstash QStash (자동 호출, 수동 불가) |
| **Request** | `{ patientChatId, guardianChatId?, drugName, dose, scheduleTime }` |
| **Response** | `{ success: true }` |
| **보안** | QStash 서명 검증 (프로덕션) |

### GET/POST /api/guardian
| 항목 | 내용 |
|------|------|
| **GET** | Query: `?patientChatId=xxx` → `{ guardianChatId, alerts }` |
| **POST** | Body: `{ patientChatId, guardianChatId, alerts }` → 저장 |

### POST /api/telegram
| 항목 | 내용 |
|------|------|
| **Request** | `{ chatId: string, message: string }` |
| **Response** | `{ success: true }` |

### GET /api/pill-info
| 항목 | 내용 |
|------|------|
| **Request** | Query: `?drugName=아스피린` |
| **Response** | 식약처 낱알식별 API 원본 응답 |
| **조건** | `MFDS_API_KEY` 없으면 404 반환 |

---

## 9. 환경변수 목록

| 변수명 | 서비스 | 필수 여부 | 용도 |
|--------|--------|-----------|------|
| `GOOGLE_API_KEY` | Google Gemini | **필수** | 처방전 이미지 분석 |
| `TELEGRAM_BOT_TOKEN` | Telegram | **필수** | 알림 메시지 발송 |
| `TELEGRAM_CHAT_ID` | Telegram | **필수** | 환자 기본 Chat ID |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis | **필수** | 보호자 정보 저장 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis | **필수** | Redis 인증 |
| `QSTASH_URL` | Upstash QStash | **필수** | 스케줄 알림 등록 |
| `QSTASH_TOKEN` | Upstash QStash | **필수** | QStash 인증 |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash QStash | **필수** | 웹훅 서명 검증 |
| `QSTASH_NEXT_SIGNING_KEY` | Upstash QStash | **필수** | 웹훅 서명 키 교체용 |
| `NEXT_PUBLIC_BASE_URL` | — | **필수** | QStash 웹훅 콜백 URL |
| `MFDS_API_KEY` | 식약처 공공API | 선택 | 약품 낱알 정보 보강 |
| `N8N_WEBHOOK_URL` | n8n | 선택 | 자동화 워크플로우 연동 |

---

## 10. 로컬 개발 환경 설정

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local에 각 API 키 입력

# 3. ngrok 터널 실행 (QStash 웹훅 테스트용)
ngrok http 3000
# → 발급된 URL을 NEXT_PUBLIC_BASE_URL에 입력

# 4. 개발 서버 실행
npm run dev
# → http://localhost:3000
```

---

## 11. 현재 구현 상태 (MVP 완성도)

| 기능 | 상태 | 비고 |
|------|------|------|
| 처방전 AI 분석 (Gemini) | ✅ 완료 | gemini-2.5-flash |
| 시니어 친화 UI | ✅ 완료 | 폰트 크기 조절 포함 |
| 음성 안내 (TTS) | ✅ 완료 | 자동 재생 + 수동 재생 |
| 텔레그램 즉시 알림 | ✅ 완료 | 환자 + 보호자 동시 전송 |
| QStash 반복 알림 | ✅ 완료 | ngrok 필요 (로컬) |
| 보호자 모드 (Redis) | ✅ 완료 | TTL 30일 자동 만료 |
| 브라우저 푸시 알림 | ✅ 완료 | Service Worker 기반 |
| 처방전 기록 | ✅ 완료 | localStorage |
| 복약 달력 | ✅ 완료 | 날짜별 체크리스트 |
| 알약 시각화 (PillBadge) | ✅ 완료 | 색상/모양 커스터마이저 |
| 식약처 API 연동 | ✅ 완료 | 선택적 (API 키 없으면 스킵) |
| QStash 서명 검증 | ✅ 완료 | 프로덕션에서만 활성화 |
| 인증 / 로그인 | ❌ 미구현 | Telegram Chat ID가 식별자 |
| 다중 환자 지원 | ❌ 미구현 | 현재 단일 Chat ID |
| 보호자 알림 조건부 분기 | ⚠️ 부분 | alerts 필드 실제 분기 로직 미구현 |
| 테스트 코드 | ❌ 미구현 | 추후 추가 필요 |
| Vercel 배포 | ⚠️ 대기 | 로컬 개발 환경 완료 |

---

## 12. 알려진 제약 및 개선 포인트

1. **보안**: `.env.local`에 실제 API 키 포함 — 배포 시 Vercel 환경변수로 이전 필수
2. **인증 없음**: Telegram Chat ID를 식별자로만 사용 — 탈취 시 알림 조작 가능
3. **다중 환자 미지원**: 현재 단일 `TELEGRAM_CHAT_ID` 고정 — 멀티테넌시 필요
4. **QStash 스케줄 삭제 미구현**: 복약 완료/취소 시 등록된 cron 삭제 기능 없음
5. **보호자 알림 조건 미구현**: `alerts` 배열 저장은 되나 실제 분기 로직 미적용
6. **테스트 코드 없음**: 핵심 분석 로직(`/api/analyze`) 단위 테스트 필요
7. **오프라인 처방전**: Service Worker가 있으나 실제 오프라인 캐싱 전략 미정의
8. **이미지 저장 없음**: 처방전 원본 이미지를 서버에 저장하지 않아 재분석 불가

---

## 13. 향후 로드맵 (Post-MVP)

### 단기 (1~2주)
- [ ] Vercel 배포 + 커스텀 도메인 연결
- [ ] QStash 스케줄 취소/수정 API 구현
- [ ] 보호자 알림 조건부 분기 로직 완성
- [ ] 기본 에러 토스트 UI 통일

### 중기 (1개월)
- [ ] Supabase Auth 연동 (소셜 로그인 또는 OTP)
- [ ] 다중 환자 프로필 지원
- [ ] 처방전 이미지 Supabase Storage 저장
- [ ] 복약 달력 완성 (체크 시 Redis 상태 업데이트)

### 장기
- [ ] 카카오톡 알림 채널 추가
- [ ] 약국/병원 연동 (OCR 없이 처방전 자동 수신)
- [ ] 복약 순응도 리포트 (보호자용 대시보드)
- [ ] 모바일 앱 (React Native / PWA 고도화)

---

*이 문서는 2026년 2월 기준 YakSok 프로젝트의 MVP 완성 시점을 기준으로 작성되었습니다.*
