# 약 속 (Promise) - 다음 단계 가이드

## 📋 Phase 1: 기본 테스트 및 검증 (필수)

### 1-1. 현재 기능 테스트
- [ ] 브라우저에서 http://localhost:3000 접속
- [ ] 파일 업로드 기능 테스트
- [ ] 드래그앤드롭 기능 테스트
- [ ] 📸 사진 찍기 기능 테스트 (모바일)
- [ ] 실제 처방전 사진으로 AI 분석 테스트
- [ ] 결과 페이지 표시 확인
- [ ] 🔊 음성 안내 기능 테스트
- [ ] 글자 크기 조절 테스트 (가- / 기본 / 가+)

### 1-2. 다양한 처방전으로 정확도 테스트
- [ ] 병원 처방전 (여러 병원)
- [ ] 약국 약봉투
- [ ] 손글씨 처방전
- [ ] 흐릿한 사진
- [ ] 다양한 조명 조건

### 1-3. 결과 검증
- [ ] 약품명 정확도 확인
- [ ] 복용 시간 정확도 확인
- [ ] 시니어 친화 문구 적절성 확인
- [ ] JSON 파싱 에러 없는지 확인

---

## 🎨 Phase 2: UI/UX 개선

### 2-1. 디자인 개선
```bash
# 필요한 작업
```
- [ ] 로고 및 아이콘 추가
- [ ] 로딩 애니메이션 개선
- [ ] 에러 화면 디자인
- [ ] 빈 상태(Empty State) 디자인
- [ ] 다크 모드 지원 (선택사항)

### 2-2. 접근성 개선
- [ ] 키보드 네비게이션 테스트
- [ ] 스크린 리더 호환성 확인
- [ ] 색상 대비 개선 (WCAG 준수)
- [ ] Focus 상태 명확히 표시

### 2-3. 모바일 최적화
- [ ] 다양한 화면 크기 테스트
- [ ] 터치 인터랙션 개선
- [ ] 가로/세로 모드 대응
- [ ] iOS/Android 네이티브 카메라 연동

---

## 🔧 Phase 3: 기능 확장

### 3-1. 처방전 히스토리
```typescript
// 구현할 기능
- 처방전 분석 결과 저장 (localStorage 또는 Supabase)
- 히스토리 페이지 추가
- 이전 처방전 다시 보기
- 처방전 삭제 기능
```

### 3-2. 복약 알림 (n8n 연동)
```bash
# n8n 설치 (로컬)
npm install -g n8n

# n8n 실행
n8n start

# 또는 Docker
docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n
```

**워크플로우 구성:**
1. Webhook 트리거 설정
2. 텔레그램 봇 연동
3. 복약 시간에 알림 전송
4. 카카오톡 API 연동 (선택)

### 3-3. 식약처 API 연동 강화
```bash
# 식약처 API 키 발급
https://www.data.go.kr/
→ "의약품개요정보(e약은요)" 검색
→ 활용신청
```

**추가 기능:**
- 약품 상세 정보 표시
- 부작용 정보
- 복용 금기사항
- 약품 이미지

---

## 📱 Phase 4: PWA (Progressive Web App) 변환

### 4-1. PWA 설정
```bash
# 이미 Next.js에 포함되어 있음
# manifest.json만 추가하면 됨
```

### 4-2. 오프라인 지원
- Service Worker 등록
- 캐싱 전략 구현
- 오프라인 페이지

### 4-3. 설치 가능하게 만들기
- "홈 화면에 추가" 프롬프트
- 앱 아이콘 설정
- 스플래시 스크린

---

## 🗄️ Phase 5: 데이터베이스 연동 (Supabase)

### 5-1. Supabase 설정
```bash
npm install @supabase/supabase-js
```

### 5-2. 테이블 구조
```sql
-- users 테이블
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) UNIQUE,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- prescriptions 테이블
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  image_url TEXT,
  analysis_result JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- medications 테이블
CREATE TABLE medications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prescription_id UUID REFERENCES prescriptions(id),
  drug_name VARCHAR(200),
  drug_name_simple VARCHAR(100),
  dosage VARCHAR(100),
  alert_times TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 5-3. 인증 추가
- 전화번호 인증 (SMS)
- 카카오/네이버 소셜 로그인
- 가족 계정 공유

---

## 🚀 Phase 6: 배포 및 운영

### 6-1. Vercel 배포
```bash
# Vercel CLI 설치
npm install -g vercel

# 배포
vercel

# 프로덕션 배포
vercel --prod
```

### 6-2. 환경 변수 설정
```
Vercel Dashboard → Settings → Environment Variables
- GOOGLE_API_KEY
- MFDS_API_KEY
- N8N_WEBHOOK_URL
- SUPABASE_URL (추가 시)
- SUPABASE_ANON_KEY (추가 시)
```

### 6-3. 도메인 연결
- Vercel에서 커스텀 도메인 설정
- HTTPS 자동 적용

### 6-4. 모니터링
- Vercel Analytics 활성화
- 에러 트래킹 (Sentry)
- 사용자 피드백 수집

---

## 🎓 Phase 7: 고급 기능

### 7-1. AI 프롬프트 최적화
- 다양한 처방전 형식 학습
- Few-shot learning 적용
- 정확도 개선

### 7-2. 다국어 지원
- 영어, 중국어, 일본어 추가
- i18n 라이브러리 사용

### 7-3. 가족 공유 기능
- 가족 구성원 추가
- 약 복용 현황 공유
- 보호자 알림

### 7-4. 통계 및 리포트
- 복약 준수율 분석
- 월간 리포트
- 건강 인사이트

---

## 📊 우선순위 추천

### 🔴 긴급 (지금 바로)
1. ✅ 기본 기능 테스트
2. ✅ 실제 처방전으로 정확도 확인
3. ✅ 버그 수정

### 🟡 중요 (이번 주)
4. PWA 변환 (모바일 설치)
5. 처방전 히스토리 저장
6. 에러 처리 강화

### 🟢 선택 (다음 주 이후)
7. n8n 알림 연동
8. Supabase 데이터베이스
9. Vercel 배포
10. 식약처 API 연동

---

## 💰 예상 비용

### 무료 Tier로 충분한 것들
- ✅ Vercel 호스팅 (개인 프로젝트)
- ✅ Google Gemini API (무료 tier)
- ✅ Supabase (500MB까지)
- ✅ n8n (로컬 실행)

### 유료가 필요할 수 있는 것들
- 💰 SMS 인증 ($0.01/건)
- 💰 카카오톡 알림 (월 수백원)
- 💰 커스텀 도메인 (연 $12~)

---

## 📝 다음 단계 실행 순서

### 오늘 할 것
```bash
1. 브라우저에서 http://localhost:3000 테스트
2. 실제 처방전 사진으로 분석 테스트
3. 결과 정확도 확인
4. 버그나 개선사항 메모
```

### 내일 할 것
```bash
5. PWA manifest.json 추가
6. 처방전 히스토리 기능 추가 (localStorage)
7. 에러 처리 개선
```

### 이번 주 할 것
```bash
8. Vercel 배포
9. 실제 사용자 테스트
10. 피드백 반영
```

---

## 🆘 도움이 필요하면

각 단계에서 막히는 부분이 있으면 언제든 물어보세요:
- "PWA로 만들어줘"
- "히스토리 기능 추가해줘"
- "Vercel에 배포해줘"
- "n8n 연동해줘"

하나씩 차근차근 진행하겠습니다! 🚀
