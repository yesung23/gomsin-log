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

### 2-3-1. 감정 흐름(EmoFlow) 분석은 순수 파생값입니다

`src/lib/emotionFlowAnalysis.ts` 는 **확정된 감정 항목만** 입력으로 받는 순수 함수입니다.

- 입력은 `EmotionFlowItem[]` 이며 `source === 'user_confirmed'` 인 항목만 사용합니다.
  일기 본문(`log`)은 인자로 받지도 않고, `matchedText` 는 읽지도 않습니다.
  → 외부 AI 호출도, 일기 본문 전송도 구조적으로 불가능합니다.
- 결과는 **어디에도 저장하지 않습니다.** 새 컬럼도 `DailyRecord` 필드도 없고,
  작성 화면과 상세 모달이 렌더할 때마다 다시 계산합니다.
- 저장 경로는 여전히 `privacy.ts` 하나뿐입니다. `emotionFlowForStorage()` 가
  `author_only` 항목과 `matchedText` 를 모두 제거합니다.
- `EmotionFlowInsightCard` 는 이미 정화된 레코드를 받으므로 파트너 화면에는
  공유 항목만 나타납니다.
- 요약문은 고정된 한국어 문장 표에서만 나오며 진단성 어휘를 쓰지 않습니다
  (`NON_DIAGNOSTIC_BANNED_TERMS` 로 테스트에서 강제).

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

### 2-8. 일정·여행·주기 데이터 경계

마이그레이션 `014_feature_privacy_and_collaboration.sql` 과 클라이언트의 방어적
필터가 함께 동작하지만, **최종 권한 경계는 RLS**입니다.

- `events`: 비공개는 작성자만, 공유는 현재 활성 커플만 읽습니다. 식별자
  (`id`, `couple_id`, `created_by`)는 DB 트리거로 변경할 수 없습니다.
- `trips`/`trip_items`/`trip_checklists`: 현재 활성 커플 양쪽이 공동 편집합니다.
  일정 날짜는 여행 기간 안이어야 하고, 순서 변경은 `reorder_trip_items` RPC 한
  트랜잭션에서 처리합니다.
- `cycle_entries`/`cycle_settings`: 소유자만 접근하며 Realtime publication과 전역
  store/localStorage에 넣지 않습니다.
- `cycle_support_signals`: 사용자가 직접 고른 당일 비의료 신호와 선택 메시지만
  파트너에게 보입니다. 최대 24시간, 즉시 철회 가능하며 원본 주기 데이터와 FK가 없습니다.
- `collaboration_invalidations`: 제목·메시지 없이 `couple_id`, slice, 시간만 담아
  공유→비공개/철회 후 상대 화면이 RLS 기준으로 다시 조회하도록 합니다.
- 연결 해제·계정 전환·라우트 전환 시 로컬 공유 상태를 먼저 비우고, 오래 걸린 이전
  요청의 결과는 identity/workspace generation으로 버립니다.

### 2-9. 서버 오류 문구는 `serverErrors.ts` 한 곳에서만 만듭니다

예전에는 호출 지점마다 실패 문구를 직접 지었고, 결과는 두 가지 모두 틀렸습니다.

- RLS 거부(`42501`)나 만료된 JWT(`PGRST301`)를 "인터넷 연결을 확인하세요" 로 표시 →
  사용자는 성공할 수 없는 재시도를 반복했습니다.
- 실제로 오프라인인 기기에는 DB 스타일 문구가 나왔습니다.

지금은 `src/lib/serverErrors.ts` 의 `classifyServerError(error, { online })` 가
`auth_expired | forbidden | not_found | offline | server | unknown` 중 하나로 분류하고
한국어 문구까지 함께 돌려줍니다.

**규칙: `offline` 이 아닌 종류의 문구는 "인터넷 연결" 을 언급할 수 없습니다.**
`serverErrors.test.ts` 가 이 규칙을 강제하므로, 새 문구를 호출 지점에서 직접 만들지
말고 이 모듈에 추가하세요.

데이터 모듈은 불리언이 아니라 **이유를 담은 결과 유니온**을 돌려줍니다
(`records.ts` 의 `RecordWriteResult`, `cycle.ts` 의 `CycleEntryWriteResult` 등).
불리언은 원인을 버리기 때문에 호출 지점이 추측할 수밖에 없었고, 항상 "연결을
확인하세요" 로 추측했습니다.

`auth_expired` 는 `store.tsx` 의 `handleAuthExpired()` 한 곳에서만 처리합니다:
`refreshSession()` 을 **정확히 한 번** 시도하고, 실패하면 로그아웃 후
"세션이 만료되었어요. 다시 로그인해 주세요." 를 보여줍니다.

### 2-10. 커플 생애주기는 서버가 결정하고, `unknown` 은 절대 덮어쓰지 않습니다

저장되는 모양(`CoupleStatus` = `pending | active | disconnected`)은 그대로입니다.
바뀐 것은 **화면이 읽는 파생 상태**입니다. `src/lib/coupleLifecycle.ts` 의
`CoupleLifecycle` = `personal | pending | connected | disconnected | unknown`.

- 출처는 마이그레이션 016의 `get_my_couple_state()` RPC 하나입니다
  (`fetchMyCoupleState()`). 013이 `invitation_codes` 읽기를 회수했기 때문에,
  클라이언트는 이 RPC 없이는 pending 과 personal 을 **구분할 방법이 없습니다.**
- `mergeCoupleState(local, remote)` 의 계약: **`unknown` 응답은 `local` 을 그대로
  돌려줍니다.** 하이드레이션 실패(`FULL_STATE_UNAVAILABLE`)는 `unknown` 으로
  가며 절대 `personal` 이 되지 않습니다. `DeletionStatus` 의 3상태 규율과 같은
  이유입니다 — 모르는 것을 "없다" 로 바꾸면 사용자 데이터가 사라진 것처럼 보입니다.
- `disconnected` 는 **알려진 공간이 있었다는 적극적 증거**(로컬 `coupleId`)를
  요구합니다. `status: 'disconnected'` 는 `sync.ts` 가 멤버십 없는 계정에 쓰는
  기본값이라 증거가 아닙니다. 이것을 근거로 삼았을 때 신규 사용자에게 존재한 적
  없는 공간이 "해제되었다" 고 표시됐습니다.
- 평문 초대 코드는 생성자 기기에만 있습니다(서버는 해시만 저장). 원격 couple id 가
  같고 파트너가 아직 합류하지 않았다면 새로고침 후에도 보존됩니다. 잃어버렸을 때의
  복구 경로는 `regenerateCoupleInvitation()` 입니다.

### 2-11. 기존 기록의 미디어 교체는 별도 액션입니다

`updateRecord` 를 넓히지 않고 `updateRecordMedia(id, { addFiles, removePaths })` 를
따로 뒀습니다. `store.test.tsx` 가 `addRecordWithMedia` 의
저장→업로드→갱신 순서를 고정하고 있어서, 그 계약을 건드리지 않고 재사용하는 쪽이
안전합니다.

순서가 고정입니다: 게이트 → 소유권 확인 → 새 파일 업로드 → 행 갱신 →
**그 다음에야** 옛 오브젝트 삭제. 행 갱신이 실패하면 방금 올린 오브젝트를 지우고
행은 건드리지 않습니다(고아 파일도, 거짓 성공도 없습니다).

### 2-12. 오프라인은 사전 차단이지 실패한 쓰기가 아닙니다

`navigator.onLine === false` 이면 쓰기 컨트롤을 **미리** 비활성화하고
"오프라인이라 지금은 읽기만 가능해요. 연결되면 다시 시도해 주세요." 를 보여줍니다.
요청을 보내고 오해를 낳는 오류를 받는 대신입니다. 단일 출처는
`src/lib/useOnlineStatus.ts` 이며, 읽기와 캐시된 내용은 계속 보입니다.

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
npm run test:e2e   # Playwright, 실제 프로덕션 번들 + 목 백엔드
```

`npm run verify` 에는 `test:e2e` 가 들어 있지 않습니다. CI는 별도 job으로 돌리므로,
화면 구조(DOM·레이아웃·히트 테스트)를 건드렸다면 로컬에서도 따로 실행하세요.
브라우저가 없으면 `npx playwright install chromium` 이 먼저 필요합니다.

현재 상태: TypeScript 오류 0, ESLint 오류·경고 0, 프로덕션 빌드 성공,
Playwright 실브라우저 매트릭스 통과.

**테스트 총개수는 여기에 적지 않습니다.** 이 자리에 있던 "625개 / 47개 파일" 은
그 뒤로 병합된 작업들 때문에 오래전에 틀린 값이 되었고, 문서의 숫자는 스스로
갱신되지 않습니다. 실제 수는 `npm test` 마지막 줄에서 읽으세요. 그리고 그 값은
반드시 **지금 바꾸고 있는 브랜치에서** 측정하세요 — `master` 의 숫자는 이 계열의
숫자가 아닙니다.

`lint` 은 `eslint . --max-warnings 0` 입니다. 경고 1개에도 게이트가 실패합니다.
예전에는 `eslint .` 여서 경고가 있어도 종료 코드가 0이었고, 위의 "경고 0" 이라는
문장만이 유일한 강제 수단이었으며 실제로 2개까지 새어 들어와 있었습니다
(`src/lib/lintGateStrictness.test.ts` 참고).

Edge Function 게이트는 별도입니다:
```bash
npm run check:edge   # deno check (supabase/functions/delete-account/**)
npm run test:edge    # deno test
```

Vite가 정적/동적 import가 섞인 모듈 2개(`events.ts`, `@capacitor/browser`)에 대해
비차단 chunk 경고를 출력하지만 기능·타입·lint 실패는 아닙니다.

## 4. 아직 하지 않은 것 (사용자 승인 필요)

| 작업 | 상태 | 문서 |
| --- | --- | --- |
| 마이그레이션 013 · 014 · 015 원격 적용 | **완료** (테스트 프로젝트, PostgREST 리로드까지) | `SUPABASE_DEPLOYMENT_CHECKLIST.md` |
| 마이그레이션 **016 원격 적용** | **미적용** — 사람이 SQL Editor 에서 실행해야 합니다 | 같음 §2-6 |
| `delete-account` 재배포 (`_shared` 새 구조) | 미완료 — 배포본 구조가 저장소와 같아졌으므로 다시 올려야 합니다 | 같음 §5-0 |
| `ALLOWED_ORIGINS` 프로덕션 도메인 추가 | 미완료 (현재 localhost/127.0.0.1 만) | 같음 |
| 2계정 사람 E2E | 미완료 | `MANUAL_TWO_ACCOUNT_TEST.md` §9 |
| master 병합 | 범위 밖 (하드닝된 DB와 비호환, 의도적으로 다루지 않음) | — |
| Google Play 제출 | 미완료 | `PLAY_STORE_ROADMAP.md` |

**실제 Supabase 서버에 대한 검증은 여전히 수행되지 않았습니다.** 로컬 게이트와
Playwright 매트릭스는 모두 **목(mock) 기반**입니다: `page.route` 로
`https://example.supabase.co` 를 가로채고 세션을 localStorage 에 심습니다. 실제
2계정 · Storage · RLS · Edge 런타임 동작은 `MANUAL_TWO_ACCOUNT_TEST.md` 를 사람이
수행해야 확인됩니다. **목 검증을 실환경 검증으로 보고하지 마세요.**

### 4.1 시각 검증에서 발견했지만 고치지 않은 항목 (디자인 판단 필요)

실제 브라우저(headless Chromium, 390/412/430 × 라이트/다크 × 곰신/군화)에서 측정했고,
재현은 되지만 **디자인 결정이 필요해서 의도적으로 바꾸지 않은** 항목입니다.

| 항목 | 측정값 | 왜 안 고쳤는지 |
| --- | --- | --- |
| `--coral` 을 본문 텍스트/버튼 배경으로 쓸 때의 명도비 | 라이트 2.01~2.09:1, 다크 2.29~2.54:1 (AA 4.5:1 미달) | 브랜드 토큰이고 약 100곳에서 쓰입니다. 토큰을 바꾸면 앱 전체 색이 바뀌므로 디자인 결정 사항입니다. |
| 44px 미만 컨트롤 잔존 | 달력 날짜 셀 42×42, 월 이동 화살표 34×34·40×40, 작성기 칩 60~88×34, 닫기 37×24 | 여러 컴포넌트에 걸친 의도적인 밀도 선택입니다. 일괄 확대는 리디자인입니다. **단, 홈 작성기의 저장 버튼(56×32)과 비공개 토글은 예외로 44px 로 올렸습니다** — 앱 전체의 주요 저장 동작이고, 파트너와 공유할지를 결정하는 컨트롤이라 밀도보다 오작동 비용이 큽니다. |
| 오프라인 배너와 기록 화면 플로팅 CTA 겹침 | 배너 746..784, CTA 706..764 → 18px 겹침 (탭바 높이 70px, 배너 오프셋 60px) | 기존부터 있던 겹침이고, 배너를 위로 올리면 겹침이 36px로 **더 커집니다**. 하단 영역 구성(배너·CTA·탭바)을 함께 정하는 디자인 결정이 필요합니다. 배너가 탭바에 **가려지던** 문제만 z-index로 고쳤습니다. |
| 설정 목록 버튼 2개의 포커스 링 비가시 | `내 기록 JSON으로 내보내기`, `내 작성 기록 전체 삭제` — 포커스 시 픽셀 변화 0.00% | `outline: solid 2px` 는 적용되어 있으나 페인트되지 않습니다. 같은 섹션의 다른 버튼은 정상이라 원인이 확정되지 않았습니다. 추측으로 고치지 않았습니다. |

측정 방법: 탭 가림은 각 컨트롤 중심점에 `document.elementFromPoint`, 명도비는 canvas로
실제 렌더 sRGB를 얻어 WCAG 공식 적용(`oklch()` 문자열 파싱은 틀린 값을 냅니다).

## 5. 하지 말아야 할 것

- 채팅 기능 추가 (제품 결정상 제외)
- `.env` / `service_role` 키를 Git에 커밋
- 데이터 없이 그럴듯한 숫자를 보여주는 위젯 추가
  (과거 45% 복무율, D-45 기념일, 고정 식단이 모두 가짜였습니다)
- 동작하지 않는 버튼을 "준비 중" 토스트로 남기기
  → 구현하거나 제거하세요
- `docs/` 의 오래된 문서를 최신 상태로 신뢰하기
  (`release-readiness-audit.md` 등은 이번 작업 이전 기준입니다)
