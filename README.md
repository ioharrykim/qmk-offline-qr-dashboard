# Qmarket Offline QR Dashboard

Next.js 14(App Router) 기반 오프라인 마케팅 QR 생성/이력/리포트 대시보드입니다.

## 실행

```bash
npm install
npm run dev
```

- 브라우저: [http://localhost:3000](http://localhost:3000)

## 환경변수 핵심

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (권장)
- `AIRBRIDGE_APP_NAME`
- `AIRBRIDGE_API_TOKEN`
- `AIRBRIDGE_TRACKING_LINK_API_TOKEN`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `ACCESS_GATE_CODE` (선택: 코드 입장 게이트 활성화)
- `ACCESS_GATE_TTL_DAYS` (선택: 코드 인증 유지일, 기본 30)
- `ADMIN_CLEAR_KEY` (선택: 최근 생성 이력 초기화 버튼 관리자 키)

### GOOGLE_PRIVATE_KEY 주의

`.env.local`에는 raw 줄바꿈이 아닌 `\n` 이스케이프 형태로 넣어야 합니다.

예:

```env
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## 코드 입장 게이트(간편 보안)

- `ACCESS_GATE_CODE`가 비어있으면 게이트 비활성화
- `ACCESS_GATE_CODE`를 설정하면 `/enter`에서 코드 입력 후 접근 가능
- 미들웨어가 페이지/API 요청을 보호합니다 (`/api/access` 제외)
- 인증 쿠키 유지기간은 `ACCESS_GATE_TTL_DAYS`로 조정 가능 (기본 30일)

## 배포 권장

- Vercel 배포 후 환경변수는 Vercel Project Settings에 동일하게 등록
- 팀 공유 시 `ACCESS_GATE_CODE`를 설정해 링크 유출 리스크를 낮추세요
- 필요 시 코드 주기적 변경(주간/월간) 권장
