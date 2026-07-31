# 릴리스 감사 2026-07-31

브랜치: `kiro/release-hardening-2026-07-31` (기준 `master` = `bf6ba0b`)

## 요약

| 항목 | 시작 | 현재 |
| --- | --- | --- |
| 자동 테스트 | 16개 | **104개** |
| TypeScript 오류 | 0 | 0 |
| ESLint 오류 | 0 (경고 10) | 0 (경고 11) |
| 프로덕션 빌드 | 성공 | 성공 |
| 실제 Supabase 검증 | 없음 | **없음 (사용자 승인 필요)** |

남은 ESLint 경고 11개는 모두 `react-refresh/only-export-components` 로,
개발 중 핫리로드 편의에 관한 것이며 동작에 영향이 없습니다.

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

104개 (시작 16개). 새로 추가한 것:

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

→ `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` 를 사람이 수행해야 합니다.

### 기능적 제약

- **푸시 알림 없음.** 상대가 기록을 남겨도 알림이 없습니다. 관련 UI는 거짓 표시를
  피하려고 제거했습니다.
- **채팅 없음** (의도적).
- `couple_members` 가 Realtime publication에 없어 상대방 연결 감지는 폴링입니다.
  publication에 추가하면 폴링을 없앨 수 있습니다.
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
```
