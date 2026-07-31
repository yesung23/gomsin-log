# 릴리스 감사 2026-07-31

브랜치: `kiro/release-hardening-2026-07-31` (기준 `master` = `bf6ba0b`)

## 요약

| 항목 | 시작 | 현재 |
| --- | --- | --- |
| 자동 테스트 | 16개 | **152개 / 21개 파일** |
| TypeScript 오류 | 0 | 0 |
| ESLint 오류 | 0 (경고 10) | **0 (경고 0)** |
| 프로덕션 빌드 | 성공 | 성공 |
| 실제 Supabase 검증 | 없음 | **없음 (사용자 승인 필요)** |

현재 ESLint 오류·경고는 0개입니다. Vite의 정적/동적 import 혼용 경고 2개는
기존 비차단 chunk 경고입니다.

## 공유 일정·여행·주기 확장 감사 (추가)

기준 커밋 `b9c069d` 이후 다음 기능과 보안 경계를 추가했습니다.

| 영역 | 완료 내용 |
| --- | --- |
| 일정 | 월간 달력, 6개 유형, 다일 범위, D-Day, 전체 CRUD, 작성자 전용 비공개, 활성 커플 공유 |
| 여행 | 여행/날짜별 일정/수동 장소/메모/http(s) 링크/체크리스트 CRUD, 양쪽 공동 편집, 기간 기록 보기 |
| 주기 | 시작·종료·증상·메모·설정 CRUD, 개인 달력, 단순 다음 시작일 예상 |
| 최소 공유 | 별도 support signal, 명시적 opt-in, 당일·최대 24시간, 80자 선택 메시지, 즉시 철회 |
| 권한 회수 | 연결 해제·계정/라우트 전환 fail-closed, membership Realtime + foreground/online 재검증 |
| DB 정합성 | event identity 불변, trip item 날짜 잠금, atomic reorder, 비민감 collaboration invalidation |

최종 semantic review는 **APPROVED / PASS**였고 BLOCKER/HIGH 코드 결함은 없습니다.
후속 MEDIUM 2건(같은 날 새 커플 support signal 충돌, 동일 여행 child 조회 순서)도
각각 커플 범위 unique index와 요청 generation으로 추가 수정했습니다.

### 의도적으로 구현하지 않은 범위

지도·장소검색 API, 예약, AI, 결제, 광고, 위치추적, 채팅, 의료진단,
임신/가임기 판단은 구현하지 않았습니다.

### 원격 검증 경계

마이그레이션 `014_feature_privacy_and_collaboration.sql`은 SQL 문자열 contract와
클라이언트 자동 테스트만 통과했습니다. 원격 staging/production에는 적용하지 않았고,
실제 Supabase RLS·Realtime·두 트랜잭션 동시성 E2E도 실행하지 않았습니다.
반드시 `SUPABASE_DEPLOYMENT_CHECKLIST.md` 순서로 staging 적용 후
`MANUAL_TWO_ACCOUNT_TEST.md`를 통과해야 출시할 수 있습니다.

---

## 1. 문서 관련 사전 정보 정정

작업 지시에 아래 문서를 읽으라고 되어 있었으나, **이 저장소에는 존재하지
않았습니다.**

```
docs/kiro/AI_HANDOFF.md
docs/kiro/HANDOVER_2026-07-30.md
docs/kiro/RELEASE_AUDIT_2026-07-31.md
docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md
docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md
docs/kiro/PLAY_STORE_ROADMAP.md
supabase/migrations/README.md
```

`docs/kiro/` 디렉터리 자체가 없었고, `kiro/release-hardening-2026-07-31` 브랜치도
없었습니다(`master` 에 커밋 1개만 존재). 따라서 **읽은 척하지 않고**, 코드를 직접
감사해서 아래 결과를 만들었으며, 위 문서들은 이번에 새로 작성했습니다.

---

## 2. 발견하고 수정한 결함

심각도: **P0** = 출시 차단, **P1** = 출시 전 수정 필요

### P0 — 개인정보 / 데이터 손실

| # | 문제 | 위치 | 수정 |
| --- | --- | --- | --- |
| 1 | **계정 삭제가 상대방의 멤버십까지 `disconnected` 로 바꿈.** `get_my_active_couple_id()` 가 NULL을 반환하게 되어 상대방이 **자기 기록조차 읽고 쓸 수 없게** 됨 | `delete-account/index.ts` | 상대방은 `active` 유지. 떠나는 사람 행은 CASCADE로 자동 삭제 |
| 2 | **계정 삭제가 공유 일정·여행을 파괴.** `events.created_by`/`trips.created_by` 가 `ON DELETE CASCADE` | 같음 | 공유 항목은 남은 상대방에게 소유권 이전, 개인(비공개) 일정만 삭제 |
| 3 | **계정 삭제가 상대방의 브리핑을 삭제** (`couple_id` 기준) | 같음 | `recipient_id` 기준으로만 삭제 |
| 4 | **비공개로 표시된 감정 항목이 공유 기록에 함께 저장되어 상대방에게 전달됨.** 규칙 엔진이 민감 감정군을 공유 기록에서도 `author_only` 로 표시하는데 아무도 그 플래그를 적용하지 않았음 | `emotionRuleEngine.ts:218`, `records.ts` | 새 `lib/privacy.ts` 가 저장 전 필터링 + 읽기 시 방어적 제거 |
| 5 | **계정 전환 시 이전 계정의 기록이 그대로 보임** | `store.tsx` | 계정 변경을 감지해 초기 상태에서 다시 시작 |
| 6 | **초대코드 무차별 대입 방어 없음.** 숫자 6자리(100만) × 24시간 유효 | `009` RPC | 마이그레이션 013: 10분 5회 / 24시간 20회 제한 (미적용) |
| 7 | 초대코드를 `Math.random()` 으로 생성 (예측 가능) | `supabase.ts` | `crypto.getRandomValues` + 거부 샘플링 |

### P0 — 기능 없음

| # | 문제 | 위치 | 수정 |
| --- | --- | --- | --- |
| 8 | **사진·영상·음성 업로드가 전혀 동작하지 않음.** 실제 라우트의 작성기는 첨부를 "준비 중" 토스트로 거부. `getMediaUrl()` 은 이 저장소에 **없는** Edge Function(`create-media-signed-url`)을 호출해 모든 첨부가 `null` 로 해석됨 | `TodayLogWidget.tsx`, `records.ts` | 2단계 업로드 구현 + 클라이언트 토큰으로 직접 서명(기존 Storage 정책이 이미 권한을 강제) |
| 9 | **군화(soldier)는 아무 기록도 작성할 수 없었음.** 해당 홈 화면이 읽기 전용 | `SoldierDashboard.tsx` | 동일한 작성기 렌더링 |
| 10 | **`/service` 라우트가 등록되지 않음.** `ServicePage.tsx` 는 도달 불가 죽은 코드인데 `DDayWidget` 은 그곳으로 이동 시도 → 홈으로 튕김 | `App.tsx` | 라우트 등록 + 실제 데이터로 재작성 |
| 11 | **로딩 화면에 영구히 갇힐 수 있음.** `isReady` 가 무제한 네트워크 호출 뒤에 있었음 | `store.tsx` | `finally` + 12초 타임아웃 |
| 12 | **OAuth 콜백 경쟁 조건.** PKCE 교환이 비동기인데 `getSession()` 을 한 번만 확인해 자주 실패로 오판 | `AuthCallbackPage.tsx` | 명시적 `exchangeCodeForSession` + `onAuthStateChange` 대기 |

### P1

| # | 문제 | 수정 |
| --- | --- | --- |
| 13 | 온보딩이 가짜 데이터 주입 (`몽룡`, `123456`, `2024-02-14`) | 제거, 실제 상대 이름 조회 |
| 14 | 프로필 저장이 실패해도 온보딩 완료로 처리 → 다음 로그인에 다시 온보딩 | 서버 저장 성공 후에만 완료 처리 |
| 15 | 기념일이 로컬에만 저장되어 다음 로그인에 초기화 | `couples.anniversary_date` 에 저장 |
| 16 | StrictMode에서 DB 쓰기가 2번 발생 (`setState` 안에서 네트워크 호출) | 업데이터 밖으로 이동 |
| 17 | 실시간 알림 1건마다 전체 재동기화(5~6 쿼리 + 첨부별 서명) ×3 채널 | 해당 슬라이스만 갱신, 디바운스 |
| 18 | 상대방 대기 폴링이 10초마다 영구 반복 (탭이 숨겨져도, 계속 실패해도) | 포그라운드 한정 + 백오프 + 종료 |
| 19 | 하드코딩 위젯 8종이 실제 데이터처럼 표시 (45%, D-45, D-12, 고정 식단 등) | 실제 계산값 또는 명시적 빈 상태 |
| 20 | 동작하지 않는 버튼 다수 (알림 벨, 설정 "준비 중" 7개, 기록 바로가기) | 실제 구현 또는 제거 |
| 21 | 다크 모드가 여러 화면에서 깨짐 (`bg-white/60` 등 불투명도 변형은 기존 `!important` 대응이 잡지 못함) | Tailwind v4 팔레트 변수 재매핑 |
| 22 | `text-destructive` 등이 정의되지 않아 렌더되지 않음 | 토큰 정의 추가 |
| 23 | 데모 모드가 새로고침에 사라짐 | `INITIAL_SESSION` 에서 유지 |
| 24 | 데모 첨부의 `blob:` URL을 저장 → 새로고침 시 깨진 이미지 | 저장 시 제거 |
| 25 | 만료되는 서명 URL을 DB에 저장 | 경로만 저장 |
| 26 | `/schedule` 라우트에 진입 경로가 전혀 없었음 | "우리" 화면에 추가 |
| 27 | `SchedulePage` 가 `demo-couple-id` 등 가짜 ID로 삽입 시도 → `created_by = auth.uid()` 위반 | 사전 차단 + 안내 |
| 28 | 로그아웃이 캐시를 지운 직후 저장 이펙트가 되살림 | 퍼지 플래그 |
| 29 | 첨부 MIME 허용목록에 영상 없음 | 영상·추가 오디오 포함, 용량 상한 |
| 30 | 계정 삭제 중 Storage 페이지네이션이 offset을 올려서 항목 누락 | 매번 처음부터 재조회 |

### 삭제한 죽은 코드

- `features/home/GomshinHome.tsx`, `features/home/SoldierHome.tsx` — 도달 불가한
  홈 화면 중복본. **이 파일만 고치면 미디어 기능이 완성된 것처럼 보이지만 사용자가
  볼 수 있는 것은 아무것도 바뀌지 않습니다.**
- `lib/aiEmotion.ts`, `lib/emotionDictionary.ts` — 어디서도 import되지 않음

---

## 3. 테스트

초기 하드닝 단계에서 104개(시작 16개)까지 추가했고, 공유 일정·여행·주기 확장 후
최종 **152개 / 21개 파일**입니다. 초기 단계에서 새로 추가한 주요 테스트:

| 파일 | 개수 | 검증 대상 |
| --- | --- | --- |
| `lib/privacy.test.ts` | 19 | 본인/상대, 공개/비공개, `author_only` 제거, 역할 전환 모호성, 데모 기록 |
| `lib/milestones.test.ts` | 22 | 기념일 선택, 복무율 경계(0%/100%/범위 밖), 일정 조회, 추억 매칭 |
| `lib/store.test.tsx` | 11 | 스플래시 교착, 계정 전환 격리, 데모 유지, 토큰 갱신 무시, **2단계 업로드 순서**, 업로드 실패 시 본문 보존, 커플 미연결 거부, `blob:` 미저장 |
| `lib/records.test.ts` | 11 | MIME 허용목록, 용량 상한, Storage 경로 규격 |
| `lib/invitation.test.ts` | 8 | 코드 생성 분포, `Math.random` 미사용, 해시 정규화, 입력 검증 |
| `features/home/homeComposer.test.tsx` | 7 | **양쪽 역할 모두 작성기 존재**, `authorRole` 기록, 첨부 수락/거부/제거 |
| `lib/platform.test.ts` | 6 | 웹/네이티브 리다이렉트 선택, 스킴 일치 |
| `lib/async.test.ts` | 4 | 타임아웃 폴백, 중복 resolve 방지 |

`isReady` 교착 수정은 **버그를 일부러 되살려 테스트가 실제로 실패하는지 확인**했습니다
(변이 테스트). 통과만 하는 무의미한 테스트가 아닙니다.

---

## 4. 남은 위험

### 검증하지 못한 것 (가장 중요)

**실제 Supabase 서버에 대해 아무것도 실행하지 않았습니다.** 아래는 코드 논리상
맞지만 실환경에서 확인되지 않았습니다.

1. Storage 업로드가 실제 RLS 정책을 통과하는지
   → 정책은 `daily_records` 행이 먼저 있어야 함을 요구하고, 그에 맞춰 2단계로
     구현했지만 실제 버킷에 써 본 것은 아닙니다.
2. `createSignedUrls` 가 상대방의 비공개 기록 첨부를 실제로 거부하는지
3. 마이그레이션 013이 실제 스키마에서 오류 없이 적용되는지
4. 계정 삭제의 소유권 이전이 실제 FK 제약과 맞물려 동작하는지
5. 네이티브 딥링크로 구글 로그인이 완료되는지 (실기기 필요)
6. 마이그레이션 014의 event/trip/cycle/support RLS와 Realtime publication이 실제
   원격 스키마에서 의도대로 동작하는지
7. trip item insert와 parent 기간 변경이 경합할 때 row lock이 모순 commit을 막는지

→ `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` 를 사람이 수행해야 합니다.

### 기능적 제약

- **푸시 알림 없음.** 상대가 기록을 남겨도 알림이 없습니다. 관련 UI는 거짓 표시를
  피하려고 제거했습니다.
- **채팅 없음** (의도적).
- `couple_members`는 Realtime publication에 포함하며, 클라이언트가 변경을 구독합니다.
  websocket 이벤트 누락에 대비해 foreground/online 복귀와 채널 재구독 시에도
  authoritative membership RPC를 다시 호출합니다. 이 동작은 로컬 자동 테스트만
  완료했으며 원격 Realtime 전달과 RLS 조합은 staging A/B/C 검증이 필요합니다.
- 상대방이 탈퇴하면 남은 사람은 "연결 대기" 상태로 보입니다. 데이터는 안전하지만
  "상대가 떠났습니다" 라는 명확한 안내는 없습니다. (`couple_members.status` 의
  CHECK 제약이 `pending|active|disconnected` 만 허용해 새 상태값을 넣을 수 없었음)
- 번들 520KB(gzip 151KB). 코드 분할 여지가 있으나 출시 차단 사항은 아닙니다.
- `002` 번 마이그레이션이 2개 있어(`002_fix_rls_and_rpc.sql`,
  `002_fix_rls_recursion.sql`) 적용 순서가 모호합니다. 원격 상태를 확인해야 합니다.

### 보안상 남은 판단

- 초대코드 오류 메시지가 "이미 2명이 참여한 공간" 과 "유효하지 않은 코드" 를
  구분합니다. 유효한 코드임을 알려주는 신호가 되지만, 정당한 사용자에게 필요한
  안내라서 유지했고 대신 **횟수 제한**을 실제 방어선으로 삼았습니다.
- 데모 모드는 `!supabase` 일 때만 동작하며 코드 `123456` 만 받습니다.

---

## 5. 커밋 목록

기준: `master` = `bf6ba0b` (변경하지 않음)

```
efaf048  test: add jsdom + testing-library harness
6821da8  fix(auth): splash deadlock, PKCE race, cross-account leak
270da04  feat(invite,routes): invite management, honest onboarding, /service + legal
608435d  feat(media): real photo/video/voice upload
716b0c3  style: if statement instead of short-circuit
51b286e  feat(soldier): composer for 군화, remove fake energy metric
3586857  fix(privacy): stop author-only emotion items leaking
5d570dc  perf(sync): targeted realtime, sane polling, reachable /schedule
63fec4d  fix(account): stop deletion destroying partner data
c162777  feat(widgets,service): real widget data
c94b92a  fix(theme): dark mode across every routed screen
f981eb7  chore: delete unreferenced dead code
e738a07  feat(security): server-side invite throttle + migration guide
ce6c7e7  feat(capacitor): Android shell with native OAuth
e23da57  docs: kiro handoff, audit, deployment, test, rollback guides
fce7577  docs: refresh README/.env.example, guard demo-only role switch

# 공유 일정·여행·주기 확장 (b9c069d 이후)
4e0fffd  feat(data): secure collaborative planning models
edb6611  feat(calendar): complete private and shared event planning
7eeec86  feat(trips): complete collaborative travel planner
03d395b  feat(cycle): add private tracking and opt-in support
8ea2de5  fix(sync): revoke shared access and reconcile realtime state
6e6f8ff  fix(security): close identity and collaboration races
e7d80a2  fix(security): fail closed across collaboration races
```

초기 하드닝 구간은 총 60개 파일, +7,663 / -1,852 행이었고, 이후 위 7개
기능·보안 커밋으로 공유 일정·여행·주기 범위를 추가했습니다.

## 6. 최종 검증 결과

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | 오류 0 |
| ESLint | `npm run lint` | 오류 0, 경고 0 |
| 테스트 | `npm test` | **152개 통과 / 21개 파일** |
| 프로덕션 빌드 | `npm run build` | 성공 (비차단 Vite chunk 경고 2개) |
| 공백·충돌 마커 | `git diff --check` | 이상 없음 |
| 민감정보 스캔 | JWT/service_role/keystore/프로젝트 URL | 유출 없음 |

민감정보 스캔 상세:
- 추적되는 `.env` 파일 없음 (`.env.example` 템플릿만 존재, 실제 값 없음)
- JWT 형태 문자열 없음
- `service_role` 문자열은 모두 "넣지 말라"는 주석과 Edge Function의
  서버측 `Deno.env.get()` 호출뿐
- 실제 Supabase 프로젝트 URL 없음
- keystore / 인증서 파일 없음


---

# 7. 2차 감사 라운드 — 재검토와 후속 수정

1차 감사가 끝난 브랜치를 **다시** 감사했습니다. 코드·DB RLS·Realtime·클라이언트
상태·의존성을 각각 독립적으로 훑고, 마지막에 별도 리뷰어로 전체 diff를 behavioral
레벨에서 재검토했습니다. 그 결과 **1차에서 만든 수정 자체가 만든 새 결함 6건**을
포함해 추가 결함을 찾아 고쳤습니다.

## 7-1. 마이그레이션 015 신설

013·014 이후 남아 있던 문제를 `015_security_followup.sql` 로 정리했습니다.
적용 순서는 `013 → 014 → 015` 이며, **원격에는 아직 적용하지 않았습니다.**

| 심각도 | 문제 | 수정 |
| --- | --- | --- |
| HIGH | 013의 시도 횟수 제한이 `redeem_invitation` 안에만 있어, `consume_invitation` 을 직접 호출하면 통째로 우회됨 | `consume_invitation` 의 `authenticated` 실행 권한 회수, `redeem_invitation` 단일 진입점화 |
| HIGH | 실패 기록 후 `RAISE` 해서 **기록까지 함께 롤백** → 사실상 제한이 동작하지 않음 | 예상된 실패는 예외 대신 `error_code` 반환 (`JSONB`), 기록이 커밋됨 |
| HIGH | 연결 해제와 초대 사용이 겹치면 한쪽만 활성으로 남음 | 초대/재발급/해제/삭제 모두 `couples` 부모 row를 먼저 잠그고 잠금 후 재검증 |
| HIGH | 계정 삭제 시 event identity 트리거가 소유권 이전을 막아, 이어서 `auth.users` cascade가 **공유 일정을 삭제** | service_role 전용 `prepare_account_deletion` + 트랜잭션 내 소유권 이전 capability |
| MEDIUM | 비공개 일정 변경까지 무효화를 발생시켜 파트너에게 활동 타이밍 노출 | 공유 일정 변화와 공유↔비공개 전환만 발생시키도록 트리거 필터 |
| MEDIUM | `trip_items.url` 이 DB에서 검증되지 않음, 동시 append 시 순서 충돌 | `http(s)` CHECK 제약, 부모 잠금 기반 rank 할당, 하루 단위 유니크 제약 |

## 7-2. 1차 수정이 만든 결함 (2차에서 발견·수정)

가장 중요한 부분입니다. 보안을 강화하면서 **기능을 깨뜨린 것들**입니다.

| 심각도 | 무엇이 깨졌나 | 원인 | 수정 |
| --- | --- | --- | --- |
| HIGH | 계정 삭제가 **영구히 불가능**해지고 사진 업로드도 막힘 | Storage 정리 루프에 종료 조건이 없었음. 중첩 경로가 허용돼서 Storage가 그 중간 단계를 "폴더"로 보고하고 `remove()` 가 조용히 무시 → 무한 반복 | 실제 객체를 재귀 열거, 라운드 상한, Storage 경로를 3단으로 고정 |
| HIGH | 파트너 연결을 기다리는 동안 **기록을 쓸 수 없고**, 이전에 쓴 기록은 사라져 보임 | 새 workspace 가드가 파트너 존재를 요구. 하지만 공간을 만든 사람의 멤버십은 이미 `active` 라서 RLS는 원래 허용 | "내 데이터" 범위와 "공유 workspace" 범위를 분리 |
| HIGH | 비공개 일정 삭제 타이밍 유출이 **실제로는 닫히지 않음** | 트리거는 고쳤지만 `public.events` 가 Realtime publication에 남아 있었고, Realtime은 DELETE payload에 RLS를 적용하지 않음 | publication에서 `events` 제거 + 클라이언트의 직접 구독 제거 |
| HIGH | WebSocket이 막힌 환경에서 **화면이 영구히 빈 상태**, 안내도 재시도도 없음 | 채널 실패 시 공유 데이터를 숨기고 아무 복구도 시작하지 않음 | HTTP 백오프 재시도(2s~30s) + `live`/`delayed`/`unavailable` 상태와 배너·재시도 버튼 |
| HIGH | 아직 수락되지 않은 초대를 **취소할 수 없음** (파트너 대기 폴링도 계속됨) | 같은 가드가 `pending` 커플에서 조기 반환 | 파트너 없는 링크는 격리·재조정 없이 취소하는 별도 경로 |
| MEDIUM | 여행 항목 **제목만 수정해도 저장 실패** | 순서 트리거는 "값이 바뀌었는지"가 아니라 "문장이 그 열을 언급했는지"로 발동. 클라이언트가 캐시된 `sort_order` 를 매번 되돌려 보냄 | 메타데이터 열만 보내도록 변경 |
| MEDIUM | 앱을 다시 열 때마다 타임라인이 **빈 화면으로 깜빡임** | 모든 foreground/online/구독 시점에 선제적으로 공유 데이터를 비움 | 선제적 비우기 제거. 이미 보고 있던 내용이고, 새 내용은 RLS를 통과해야 하며, 재조정이 권위적으로 판단 |
| MEDIUM | 시도 횟수 초과가 **자기 잠금을 무한 연장** | `rate_limited` 판정도 실패로 기록 → 재시도하는 클라이언트가 24시간 창을 계속 갱신 | 코드를 조회하기도 전에 결정되는 판정은 기록하지 않음 |
| MEDIUM | "이미 2명" 응답이 **추측한 코드가 유효했음을 확인해 줌** | 100만 가지 공간 탐색에서 가장 비싼 절반을 대신 알려주는 셈 | `invalid_or_expired` 로 통합 |
| MEDIUM | 삭제된 사용자의 공유 일정이 **아무도 못 읽는 상태로 영구 잔존** | 이미 연결이 끊긴 상대에게도 소유권을 넘겼음 | 활성 파트너만 상속, 없으면 명시적 삭제 후 보고 |
| MEDIUM | auth 삭제가 실패하면 **살아 있는 계정의 업로드가 영구 차단** | 삭제 표식이 남고, 그것을 지울 수 있는 경로는 service_role 전용 | auth 삭제 재시도, 최종 실패 시 표식 정리 + "데이터는 이미 삭제됨" 응답 |

## 7-3. 의존성 감사 판정

`npm audit` 는 high 7건을 보고합니다. **7건 모두 조치하지 않기로 판단**했고, 근거는
다음과 같습니다.

### 프로덕션 (2건) — 전제조건 부재

`react-router` / `react-router-dom@7.18.2`,
[GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2).

[GitLab Advisory Database](https://advisories.gitlab.com/pkg/npm/react-router/) 설명에
따르면 이 권고는 CVE-2026-22030의 후속으로, **unstable RSC 코드 경로**의 CSRF 흐름을
대상으로 합니다. (라이선스 준수를 위해 내용을 재구성했습니다.)

이 앱에는 그 전제조건이 없습니다.

- `src/main.tsx` 는 `BrowserRouter` 만 사용합니다 (declarative mode).
- `loader` / `action` / `useFetcher` / react-router `<Form>` 사용처가 **하나도 없습니다.**
  즉 Framework Mode의 서버 action handler도, RSC server action도 존재하지 않습니다.
- 정적 Vite 빌드이므로 react-router를 실행하는 서버 자체가 없습니다.

또한 **올려서 고칠 방법이 없습니다.** `react-router-dom` 의 최신 배포는 7.18.2이고
(8.x 미배포), 취약 범위는 `>=7.12.0 <8.3.0` 입니다. npm이 제안하는 유일한 조치는
7.11.0으로의 **다운그레이드**(마이너 7개 후퇴, breaking)이며, 적용되지 않는 취약점
때문에 그 사이의 다른 수정들을 포기하는 것은 손해입니다.

→ **수락하고 기록.** 이 앱이 Framework Mode나 RSC, 또는 loader/action을 도입하는
순간 이 판단은 무효가 되므로, 그때 재평가해야 합니다.

### 개발 전용 (5건) — 번들에 없음

5건 모두 **하나의 근원**에서 나옵니다:
`eslint@9.39.5` → `minimatch@3.1.5` → `brace-expansion@1.1.16`
([GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg),
확장 길이가 제한되지 않아 메모리 부족으로 프로세스가 죽는 DoS).

개발 전용임을 확인한 근거:

- `npm audit --omit=dev` 는 react-router만 보고합니다 (2건).
- `npm ls --omit=dev --depth=0` 에 eslint 계열이 없습니다.
- 빌드 산출물 `dist/assets/*.js` 에 `brace-expansion` / `minimatch` 문자열이 없습니다.

조치하지 않은 이유:

- 패치된 1.x 가 없습니다(취약 범위가 `<=5.0.7`). 유일한 fix는 `eslint` 10 **메이저**
  업그레이드이며, `typescript-eslint@8.65.0` 의 호환성 확인이 선행되어야 합니다.
- `overrides` 로 `brace-expansion` 을 5.x로 올리는 방법은 검토했으나, `minimatch@3` 이
  CJS `require` 로 호출하는 형태와 5.x의 export 형태가 달라 lint 자체가 깨질 위험이
  있어 적용하지 않았습니다. (참고로 `typescript-eslint` 는 이미 5.0.8,
  `@capacitor/cli` 는 5.0.9를 쓰고 있어 그 경로들은 이미 안전합니다.)
- 도달 경로는 lint 시점의 glob 확장이고, 그 패턴은 저장소가 소유한
  `eslint.config.js` 에서 옵니다. 외부 입력이 아닙니다.

→ **수락하고 기록.** `typescript-eslint` 가 eslint 10을 지원하면 함께 올립니다.

## 7-4. 이번 라운드에서 여전히 검증하지 못한 것

1차 감사의 "검증하지 못한 것" 이 그대로 유효하고, 015 때문에 항목이 늘었습니다.

- **015를 원격에 적용하지 않았습니다.** 이 저장소에는 PostgreSQL이 없어
  SQL 문법조차 실제로 파싱해 보지 못했습니다(`$$` 짝, `BEGIN`/`COMMIT` 개수 등
  수동 확인만 했습니다). 스테이징 적용이 이 변경의 첫 실제 실행입니다.
- **`LOCK TABLE storage.objects IN SHARE MODE` 가 Supabase 호스팅에서 허용되는지**
  확인하지 못했습니다. 이 테이블은 `supabase_storage_admin` 소유이고, 필요한 권한이
  없으면 `42501` 로 실패합니다(fail closed이지만 계정 삭제 기능이 동작하지 않음).
  잠금이 유지되는 동안 프로젝트 전체 Storage 메타데이터 쓰기가 대기합니다.
- **비공개 일정 삭제가 실제로 파트너 채널을 건드리지 않는지** 두 계정으로
  확인해야 합니다. publication 제거가 옳은 조치라고 판단했지만, 관측으로
  확정하지 않았습니다.
- **`DEFERRABLE` 유니크 제약 + `SET CONSTRAINTS ... DEFERRED` 로 순서 교체가**
  실제로 위반 없이 통과하는지 확인해야 합니다.
- **Edge Function을 배포하지 않았고**, Deno 런타임이 이 환경에 없어 타입 체크도
  하지 못했습니다(esbuild 파싱만 통과). 실제 계정 삭제도 실행하지 않았습니다.
- **A/B/C 2계정 RLS·Realtime·동시성·계정 삭제 E2E 를 실행하지 않았습니다.**

## 7-5. 최종 검증 결과 (2차 라운드)

| 게이트 | 결과 |
| --- | --- |
| `npm run typecheck` | 오류 0 |
| `npm run lint` | 오류 0, 경고 0 |
| `npm test` | 152개 통과 / 21개 파일 |
| `npm run build` | 성공 |
| `git diff --check` | 이상 없음 |
| 충돌 마커 스캔 | 없음 |
| 민감정보 스캔 | 유출 없음 |
| `npm audit --omit=dev` | high 2건 (위 7-3에서 판정) |

테스트 수가 152개로 동일한 이유: 이번 라운드는 새 테스트를 추가하지 않고
기존 테스트가 회귀를 잡아내는지 확인하는 데 썼습니다. 실제로 `store.test.tsx` 의
`pending` 커플 연결 취소 테스트가 1차 수정의 회귀를 잡아냈습니다.

### 아직 테스트로 고정되지 않은 것

- `pending` 커플에서의 기록 쓰기 경로 (기존 테스트는 `coupleId` 자체가 없는
  경우만 다룹니다)
- 채널 실패 후 `SUBSCRIBED` 가 오지 않는 시나리오
- Storage 정리 루프의 중첩 경로 케이스
- SQL 전체 (`redeem_invitation` 의 기록 durability, deferred 유니크 순서 교체,
  전체 row 업데이트 대 순서 트리거)
