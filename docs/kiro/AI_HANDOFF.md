# AI / 개발자 인수인계

이 파일을 **먼저** 읽으세요. 이 코드베이스에는 사람을 헷갈리게 하는 함정이 있었고,
그중 몇 개는 아직 구조적으로 남아 있습니다.

## 1. 실제로 화면에 그려지는 파일만 고치세요

`src/App.tsx` 의 라우트에서 출발해 따라가세요.

```
/            → HomePage → 역할에 따라 분기
                ├ gomsin  → features/home/WidgetDashboard.tsx
                │             └ lib/widgets.tsx (위젯 레지스트리)
                │                 └ components/widgets/TodayLogWidget.tsx  ← 실제 작성기
                └ soldier → features/home/SoldierDashboard.tsx
                              └ components/widgets/TodayLogWidget.tsx     ← 같은 작성기
/record        → pages/RecordPage.tsx        (읽기 전용 타임라인 + 달력)
/schedule      → pages/SchedulePage.tsx
/service       → pages/ServicePage.tsx
/us            → pages/UsPage.tsx
/my            → pages/MyPage.tsx
/settings      → pages/SettingsPage.tsx
/trips         → pages/TripsPage.tsx, /trips/:id → TripDetailPage.tsx
/legal/:doc    → pages/LegalPage.tsx
/auth/callback → pages/AuthCallbackPage.tsx
/onboarding    → pages/OnboardingPage.tsx    (setupComplete=false 이면 모든 경로가 여기로)
```

> ⚠️ **과거의 함정:** `features/home/GomshinHome.tsx` 와 `SoldierHome.tsx` 는 완전한
> 홈 화면처럼 보였지만 **어디서도 import되지 않는 죽은 코드**였습니다. 여기에
> 사진 업로드를 구현해도 사용자는 아무 변화를 볼 수 없습니다.
> 두 파일은 이번에 **삭제**했습니다. 다시 만들지 마세요.

## 2. 구조적으로 알아야 할 제약

### 2-1. 미디어 업로드는 반드시 2단계

Storage 정책(`007_storage_policies.sql`)이 경로를
`{coupleId}/{recordId}/{uuid}.{ext}` 로 요구하고, **INSERT 시점에 그 recordId를 가진
`daily_records` 행이 이미 존재하고 본인 소유여야** 통과합니다.

따라서 순서가 고정입니다:

```
1) saveRecordToDB(record)         ← 행을 먼저 만든다
2) uploadRecordMedia(file, ...)   ← 그 다음에 업로드
3) saveRecordToDB(record + 첨부)  ← 첨부 메타데이터로 행을 갱신
```

`store.tsx` 의 `addRecordWithMedia` 가 이 순서를 구현하고,
`store.test.tsx` 가 **순서 자체를 검증**합니다. 순서를 바꾸면 테스트가 깨집니다.

### 2-2. 서명 URL은 클라이언트에서 직접 만듭니다

과거 `getMediaUrl()` 은 `create-media-signed-url` 이라는 Edge Function을 호출했지만
**그 함수는 이 저장소에 존재하지 않습니다.** 그래서 모든 첨부가 `null` 이 되었습니다.

지금은 `resolveAttachmentUrls()` 가 사용자 본인 토큰으로 `createSignedUrls` 를
호출합니다. Storage의 SELECT 정책이 이미 커플 멤버십과 비공개 여부를 검사하므로
서비스 롤을 경유할 이유가 없고, 없는 함수에 의존하지도 않습니다.
**서비스 롤 키를 프런트엔드에 넣지 마세요.**

### 2-3. 개인정보 규칙은 한 곳에만

`src/lib/privacy.ts` 가 유일한 출처입니다.

- `isOwnRecord` — `userId` 우선, 없으면(데모/오프라인) `authorRole` 로 판단
- `emotionFlowForStorage` — 저장 전 `author_only` 감정 제거
- `visibleRecordsForViewer` — 필터 + 정화를 한 번에

화면에서 `record.authorRole === profile.role` 같은 비교를 새로 쓰지 마세요.
역할 전환 후에 틀립니다. 반드시 위 헬퍼를 쓰세요.

### 2-4. 계정 삭제는 상대방을 건드리면 안 됩니다

`supabase/functions/delete-account/index.ts` 상단 주석에 이유가 적혀 있습니다. 요약:

- 상대방의 `couple_members.status` 를 `disconnected` 로 **절대 바꾸지 마세요.**
  `get_my_active_couple_id()` 가 NULL이 되어 상대방이 자기 기록조차 못 읽습니다.
- `events`/`trips` 의 `created_by` 는 `auth.users` 에 CASCADE입니다. 공유 항목은
  삭제 전에 남은 상대방에게 **소유권을 이전**해야 사라지지 않습니다.
- `briefings` 는 `couple_id` 가 아니라 `recipient_id` 로만 지우세요.

### 2-5. `setState` 업데이터 안에서 네트워크 호출 금지

React StrictMode가 업데이터를 두 번 호출하므로 요청이 2번 나갑니다.
`store.tsx` 는 `stateRef.current` 로 이전 상태를 읽고 업데이터 밖에서 씁니다.

### 2-6. 다크 모드는 팔레트 변수로 처리합니다

Tailwind v4는 `bg-white/60` 을
`color-mix(in oklab, var(--color-white) 60%, transparent)` 로 컴파일합니다.
그래서 클래스명을 나열하는 `!important` 방식은 불투명도 변형을 잡지 못했습니다.

지금은 `styles/index.css` 의 `[data-theme='dark']` 에서 `--color-gray-*`,
`--color-amber-*` 등 팔레트 변수를 재매핑합니다.
**`--color-white` 는 일부러 건드리지 않았습니다** — `text-white`(코랄 버튼 글씨)와
선택된 달력 칸의 흰 점에 쓰이기 때문입니다. 배경으로 흰색이 필요하면
`bg-card` 를 쓰세요.

### 2-7. 네이티브 OAuth

구글은 임베디드 WebView에서 로그인 페이지를 거부합니다. 그래서
`isNativePlatform()` 이면 `skipBrowserRedirect` 로 URL만 받아 시스템 브라우저
(Custom Tab)를 열고, `lib/deepLinks.ts` 의 `appUrlOpen` 리스너가 PKCE 교환을
수행합니다. Custom Tab은 별도 컨텍스트라 `detectSessionInUrl` 이 보지 못합니다.

스킴 `gomsinlog` 는 3곳이 일치해야 합니다: `capacitor.config.ts`,
`src/lib/platform.ts`, Android 매니페스트 intent-filter.
(`platform.test.ts` 가 앞의 두 곳 일치를 검사합니다.)

## 3. 검증 명령

```bash
npm install
npm run verify     # typecheck + lint + test + build
```

개별 실행:
```bash
npm run typecheck
npm run lint
npm test
npm run build
```

현재 상태: 테스트 **104개 통과**, TypeScript 오류 0, ESLint 오류 0(경고 11),
프로덕션 빌드 성공.

경고 11개는 모두 `react-refresh/only-export-components` 이며 동작에 영향이 없습니다.

## 4. 아직 하지 않은 것 (사용자 승인 필요)

| 작업 | 문서 |
| --- | --- |
| 원격 Supabase SQL 실행 (마이그레이션 013) | `SUPABASE_DEPLOYMENT_CHECKLIST.md` |
| Edge Function 실제 배포 | 같음 |
| GitHub push / master 병합 | — |
| 실제 데이터 삭제 테스트 | `MANUAL_TWO_ACCOUNT_TEST.md` §8 |
| Google Play 제출 | `PLAY_STORE_ROADMAP.md` |

**실제 Supabase 서버에 대한 검증은 전혀 수행되지 않았습니다.** 코드 논리는 테스트로
검증했지만, 실환경 동작은 `MANUAL_TWO_ACCOUNT_TEST.md` 를 사람이 수행해야 확인됩니다.

## 5. 하지 말아야 할 것

- 채팅 기능 추가 (제품 결정상 제외)
- `.env` / `service_role` 키를 Git에 커밋
- 데이터 없이 그럴듯한 숫자를 보여주는 위젯 추가
  (과거 45% 복무율, D-45 기념일, 고정 식단이 모두 가짜였습니다)
- 동작하지 않는 버튼을 "준비 중" 토스트로 남기기
  → 구현하거나 제거하세요
- `docs/` 의 오래된 문서를 최신 상태로 신뢰하기
  (`release-readiness-audit.md` 등은 이번 작업 이전 기준입니다)
