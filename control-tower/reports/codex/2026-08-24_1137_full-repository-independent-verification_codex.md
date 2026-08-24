---
agent: codex
agent_note: "[[Codex]]"
date: 2026-08-24
time: "11:37"
task: "곰신로그 저장소 전체 독립 검증"
phase: V4
status: closed
canonical: false
tags:
  - agent/codex
  - phase/v4
  - report
  - audit
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> Agent: [[Codex]] · Task: 곰신로그 저장소 전체 독립 검증

# 곰신로그 저장소 전체 독립 검증

검토 기준 시점: 2026-08-24 11:37 KST

이 문서는 저장소·로컬 테스트·운영 Supabase·Vercel·브라우저를 서로 다른 증거 경계로 나눈 독립 검증 보고서다. 문서에 적힌 완료 주장을 그대로 승계하지 않았고, 가능한 항목은 현재 상태를 다시 조회했다.

## 검토 기준

- 저장소: `/Users/han-yejun/Desktop/곰신로그`
- 브랜치: `codex/service-rank-profile-settings-impl`
- 검토 HEAD: `c16537047924ec5e164fb36b8dad1aa2fb661b52`
- `origin/master`: `7f4886bcbe32034bfabb454c85378532b14cb261`
- PR: `#89` — `OPEN`, `MERGEABLE`, `CLEAN`
- GitHub CI: 위 커밋 기준 전부 green. 현재 미커밋 작업트리는 검증하지 않는다.
- 검토 시작 작업트리: tracked 20개 수정, untracked 2개, tracked diff `+370/-161`
- 기존 변경은 reset·stash·checkout하지 않고 그대로 보존했다.
- 요청된 `main/gpt-5.6-sol`, reasoning `max` 검토는 공급자 오류/무응답으로 완료되지 않았다. 결과는 **BLOCKED**이며, 이 문서는 primary Codex의 독립 검증 결과다.

## DIRECTION CHECK

- Product source checked: `docs/PRODUCT_V3.md`
- Business source checked / NOT APPLICABLE: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — 사업·가격·고객·저장 전략을 바꾸는 작업이 아님
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`
- Current-state checked: `docs/CURRENT_STATE.md`
- Latest relevant Work Log checked: `docs/WORK_LOG.md`
- Additional requested docs checked: `docs/ONBOARDING_PROMPT.md`, `CLAUDE.md`, `AGENTS.md`, `docs/WHAT_IS_GOMSINLOG.md`, `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`, `docs/WORK_LOG.md`
- Does this task conflict with canonical direction? **YES**
- Conflict: `docs/PRODUCT_V3.md:199,246`은 `찾기`가 탭이 아니라고 결정하지만, `docs/V4_AS_BUILT.md:35-36`과 현재 코드는 `/search`를 두 번째 탭으로 운영한다. 이번 작업은 읽기 전용 검증이므로 중단하지 않았고, 다음 구현 전에 제품 결정을 요구한다.

## What was requested

- 찾기, 마이, 게시물·사진·여행·하이라이트, 권한·개인정보·DB, 실제 사용자 경로를 저장소 전체에서 검증한다.
- 코드와 화면, 로컬과 원격, migration 파일과 실제 적용 상태를 분리한다.
- focused Vitest, `npm run verify`, `npm run test:phase0`, 브라우저 검증, `git diff --check`를 실행한다.
- 1차 검토 중 코드·커밋·push·PR·배포·운영 migration을 변경하지 않는다.

## What was actually done

- 지정 문서와 `bash scripts/agent/session-start.sh`를 확인했다.
- 현재 브랜치·HEAD·worktree·`origin/master`·PR·CI를 다시 확인했다.
- 관련 React call path, Supabase RPC/RLS/migration, phase0 actor harness를 정적으로 추적했다.
- 로컬 focused/full test, fresh-chain PostgreSQL actor test, build, diff check를 실행했다.
- fixture 기반 로컬 Chrome과 현재 로그인된 운영 브라우저를 각각 확인했다.
- Supabase 원격 catalog와 익명 REST 경계를 읽기 전용으로 조회했다.
- 운영 사용자 데이터 쓰기, migration 적용, Vercel 배포, 커밋, push, PR 수정·merge는 하지 않았다.

## 1. 최종 판정: FAIL

P0는 발견되지 않았다. 그러나 다음 세 가지가 현재 릴리스 판정을 막는다.

1. 운영 Supabase에 migration 060의 RPC가 없어 파트너 아이디가 새로고침 뒤 복원되지 않는다.
2. 실제 계급 입력 없이 복무율 0/25/50/75%를 이등병·일병·상병·병장으로 표시해 사실과 다른 계급으로 읽힌다.
3. 관련 Playwright가 현재 fixture 누락으로 완주하지 못했고, 운영 배포도 현재 작업트리보다 이전 상태다.

로컬 unit/full/phase0가 통과한 것은 강한 긍정 증거지만, 위 운영·브라우저 결함을 상쇄하지 않는다.

## 2. 현재 실제 구현된 기능

### A. 찾기 탭

- **PASS — 코드/운영 렌더링:** `/search` 첫 화면에 입대일·전역일·D-day·복무율 카드가 보인다.
- **PASS — 계산:** `src/lib/milestones.ts`가 사용자가 저장한 입대일·전역일을 기준으로 날짜와 진행률을 계산한다.
- **PASS — 갱신 코드:** 날짜 변경·자정·포커스 복귀 갱신 경로가 있고 focused Vitest가 통과했다.
- **FAIL — 의미 정확성:** `src/lib/serviceLevel.ts:25-30`이 실제 진급일 입력 없이 복무율 4등분을 계급으로 단정하고, `src/features/search/SearchPage.tsx:168`이 이를 `현재 계급`으로 표시한다.
- **PASS — 제품 금지선:** 관계 점수·애정 점수 계산은 없다. 다만 `Lv.`와 `경험치` 표현은 군 복무 구간이라는 설명이 더 분명해야 한다.
- **PASS — 기존 찾기:** 날짜 찾기와 기록 찾기 경로가 유지된다.
- **PASS — 건강정보 분리:** 곰신의 생리·컨디션 원본은 별도 owner-only 경계에 있고, 파트너 projection은 원시 출혈량·증상·통증·기분·메모를 반환하지 않는다.

### B. 마이 탭

- **PASS — 로컬 코드:** 예시 인물·가상 프로필 없이 현재 사용자/커플 프로필을 렌더링한다.
- **PASS — 필드 분리:** 별명(`display_name`)과 영어 아이디(`username`)가 분리돼 있다.
- **PASS — 규칙/DB:** `057_profile_identity_and_caption.sql:12-20`은 `^[a-z][a-z0-9_]{2,19}$` 및 소문자 unique index를 둔다.
- **PASS — 권한 모델(phase0):** 059의 `set_partner_username(text)`는 active couple의 상대 row만 결정한다. owner 직접 username 수정, former partner, unrelated user, anon은 거부되는 actor mutation이 통과했다.
- **PASS — 도달성(로컬):** `/settings`와 `/settings?profile=edit` 모두 상대 아이디 편집기에 도달한다.
- **PASS — 로컬 fixture:** 저장 직후와 새로고침 뒤 동일 값이 표시됐다.
- **FAIL — 운영:** 원격 060이 없어 운영 새로고침 후 username projection은 성립하지 않는다.
- **PASS — fallback 설계:** `src/lib/sync.ts:57-60`은 `PGRST202`일 때만 legacy RPC로 내려가며 권한·RLS·서버 오류를 숨기지 않는다.
- **PASS — 카메라 배지:** 지속적으로 겹치는 카메라 배지는 없다.
- **PASS — 데이터 경계 설명:** `src/lib/avatarImage.ts:5-28`에 프로필 사진이 기기 localStorage 전용이고 동기화되지 않음이 명시돼 있다. 날짜 없는 업로드 토큰을 만들지 않는다.

### C. 게시물·사진·여행·하이라이트

- **PASS — 개념 분리:** 격자는 사진 게시물 목록이고, 하이라이트는 사용자가 고른 record-id 묶음이다.
- **PASS — 로컬 코드:** `src/features/us/SharedProfile.tsx:43-55`는 여행 날짜가 아니라 모든 shared non-private 사진 기록을 선택한다.
- **PASS — 미디어 필터:** `src/features/us/postTiles.ts:46-66`은 사진 attachment가 없는 글·영상·음성 기록을 격자에서 제외한다.
- **PASS — 상세/원본:** 사진 타일은 사진 중심 상세를 열고, `원본 보기`는 정확한 record ID로 이동한다.
- **PASS — 하이라이트 편집:** 격자에서 사진 기록을 선택하고, 공유 사진 story는 배열 인덱스가 아닌 record ID를 `/us?highlightRecord=...`로 전달한다.
- **PASS — private/모드:** private record는 격자·story action·highlight 선택에서 제외되고, highlight mode에는 하이라이트 추가 버튼이 전달되지 않는다.
- **PASS — 수정/삭제/커버:** 현재 DB 모델과 같이 하이라이트 title/order/item record IDs를 수정하며 첫 record ID를 cover로 사용한다.
- **주의 — 여러 장:** 한 게시물에 사진이 여러 장이면 record 하나가 선택되고, 타일·하이라이트 cover는 그 record의 첫 번째 사진이다. attachment 단위 선택 모델은 없다.
- **PASS — 비목표:** 좋아요·조회수·본 사람 목록·팔로워·관계 점수는 추가되지 않았다.

### D. 권한·개인정보·DB

- **UNVERIFIED — 적용 순서:** `supabase migration list --linked`는 유효한 remote migration history를 보여주지 못했다. 따라서 057→058→059→060의 실제 원격 적용 순서는 증명하지 못했다.
- **부분 확인 — 원격 객체:** 057·058·059의 핵심 객체는 원격 catalog에 존재한다. 이것은 객체 존재 증거이지 migration history 증거는 아니다.
- **FAIL — 060 원격:** `get_partner_profile_with_username()`은 원격에 없고 anon REST probe는 HTTP 404 / `PGRST202`였다.
- **PASS — 060 저장소 정의:** local migration은 `SECURITY DEFINER`, 고정 `search_path`, PUBLIC/anon/authenticated revoke 후 authenticated grant, PostgREST reload를 포함한다.
- **PASS — profiles RLS:** 원격 `profiles` 직접 SELECT/UPDATE/INSERT 정책은 owner-only이며 partner username 읽기를 위해 넓어지지 않았다.
- **PASS — 민감정보:** cycle raw tables는 owner-only이고 partner projection은 정제된 signal만 반환한다.
- **PASS — storage/RLS actor test:** phase0는 A/B/C/anon 실제 role과 mutation을 사용하고, 정책을 약화했을 때 assertion이 실패하는 mutation proof를 포함한다.
- **주의 — defense in depth:** 원격 highlight table의 authenticated ACL은 migration 파일의 선택적 grant보다 넓지만, 현재 RLS가 비인가 direct write를 차단한다.

### E. 실제 사용자 경로

| 경로 | 운영 브라우저 | 로컬 fixture Chrome | 판정 근거 |
|---|---|---|---|
| `/us` | **FAIL** — 배포판은 여행 사진 전용 빈 문구 | **PASS** — 전체 shared 사진 격자 | 운영이 현재 작업트리보다 오래됨 |
| `/search` | **PASS** 렌더링 / **FAIL** 계급 의미 | **PASS** | 저장 날짜 기반 D-98·0%와 하드코딩 계급 rail 확인 |
| `/settings` | **PASS** | **PASS** | 상대 아이디 설정 영역 도달 |
| `/settings?profile=edit` | **FAIL** — 배포 modal에 새 상대 아이디 editor 없음 | **PASS** | 로컬 변경 미배포 |
| 기록 작성(`/compose`) | **PASS** 화면 렌더링 | **PASS** | 실제 기록 저장은 개인정보 보호상 수행하지 않음 |
| 사진 게시물 상세 | **BLOCKED** — 운영 계정에 검증용 사진 없음 | **PASS** | 사진 viewer와 exact `/record?record=...` 확인 |
| `/story/partner` | **BLOCKED** — 운영 데이터 없음 | **PASS** | fixture record로 렌더링 확인 |
| `/story/highlight/:id` | **BLOCKED** — 운영 highlight 없음 | **PASS** | fixture highlight 순서 확인 |
| 프로필 사진 변경 | **UNVERIFIED** — 운영 쓰기 미수행 | **PASS** — localStorage, network write 없음 | 기기 간 sync는 구현되지 않음 |

운영 화면은 Vercel 배포 SHA `a33499e179a163f87d0efae94ca3262f445fc00b`에서 HTTP 200이었다. 현재 HEAD 및 미커밋 변경과 다르다.

## 3–4. 확인된 결함, 심각도, 파일·함수·근거

| 심각도 | 결함 | 파일·함수 | 근거 |
|---|---|---|---|
| P1 | 실제 계급처럼 보이는 25% 구간값 | `src/lib/serviceLevel.ts:25-30` `SERVICE_LEVELS`; `src/features/search/SearchPage.tsx:160-202` | 진급일/현재 계급 입력 없이 0·25·50·75%를 계급으로 표시한다. 실제 입력에서 계산되는 것은 복무율이지 계급이 아니다. |
| P1 | 운영에 060 RPC 없음 | `supabase/migrations/060_partner_username_projection.sql:7-31`; `src/lib/sync.ts:57-60` | 원격 catalog에 함수가 없고 REST가 `PGRST202`; legacy RPC는 username을 반환하지 않는다. |
| P1 | 현재 구현 미배포 | Vercel SHA `a33499e...` 대 local HEAD/worktree | 운영 `/us`와 profile modal이 현재 로컬 동작과 다르다. |
| P2 | 관련 E2E fixture가 새 RPC를 모름 | `e2e/fixtures/mockBackend.ts:446-456` | legacy `get_partner_profile`만 route해 새 RPC가 generic 500을 받고 Playwright가 timeout한다. |
| P2 | 운영 `clear_my_unseen()` 없음 | `src/lib/pushTokens.ts:105-108` | 운영 콘솔에서 schema-cache missing function 경고가 반복됐다. delivery flag가 내려가지 않을 수 있다. |
| P2 | DB highlight 저장이 사진 여부를 증명하지 않음 | `supabase/migrations/058_couple_highlights.sql:136-146`; `src/features/story/StoryRoute.tsx:72-78` | RPC는 same-couple/non-private만 검사하고, highlight replay도 photo filter가 없다. 직접 RPC로 shared text-only record를 넣을 수 있다. |
| P2 | highlight fetch 오류를 빈 배열로 숨김 | `src/lib/sync.ts:320-380` | `highlightsResult`가 failure gate에서 빠지고 모든 오류가 `[]`로 변환된다. 42501/서버 오류도 migration 미적용처럼 보인다. |
| P3 | owner profile schema fallback이 과도하게 넓음 | `src/lib/sync.ts:63-85` `fetchProfileRow` | 첫 select의 모든 오류에 old-column query를 재시도한다. missing-column/schema 오류로만 제한해야 한다. |
| P3 | 원격 highlight ACL이 migration 의도보다 넓음 | remote catalog vs `058_couple_highlights.sql:72-75` | RLS가 현재 보호하지만 authenticated table privilege가 least-privilege 의도와 불일치한다. |
| P3 | canonical navigation 충돌 | `docs/PRODUCT_V3.md:199,246-253`; `docs/V4_AS_BUILT.md:31-43` | canonical product는 찾기 탭을 폐기했지만 as-built와 runtime은 `/search` 탭을 둔다. |
| P3 | 이전 홈 서브시스템과 테스트 부채 | `src/features/home/RoleHome.tsx`, `src/components/widgets/WidgetWrapper.tsx`, `src/components/widgets/AddWidgetBottomSheet.tsx` | production 686줄과 dnd-kit 3개 의존성이 현재 `PaperHome` runtime에 연결되지 않는다. 세 legacy test는 1,133줄이므로 유효 보장을 옮긴 뒤 삭제해야 한다. |

## 5. 실행한 테스트와 정확한 결과

| 명령/검증 | 상태 | 정확한 결과와 증명 범위 |
|---|---|---|
| 관련 focused Vitest 24 files | **PASS** | 24 files / 340 tests. 찾기, 프로필, 격자, story, highlight, sync fallback 관련 로컬 동작을 증명한다. |
| `npm run verify` | **PASS** | typecheck, lint, full Vitest 231 files / 3,279 tests, production build 모두 exit 0. build는 main chunk `654.30 kB` (`196.08 kB` gzip)로 500 kB 경고를 냈다. |
| `npm run test:phase0` | **PASS** | throwaway PostgreSQL 17, 58 migrations, 333 assertions. A/B/C/anon actor, 실제 mutation, policy-mutation proof가 통과했다. 로컬 fresh-chain 증거다. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx playwright test e2e/usArchiveShots.spec.ts e2e/realUsability.spec.ts e2e/coupleMatrix.spec.ts` | **FAIL** | 49 planned, 4 passed, 2 failed, 43 not run. 새 partner RPC fixture 누락으로 20초 timeout이 반복되어 exit 130으로 중단했다. |
| 로컬 fixture 기반 Chrome 수동 경로 확인 | **PASS** | `/search`, `/us`, photo detail→exact record, partner story, highlight story, settings, profile edit, partner ID 저장/새로고침, compose, device-local avatar를 확인했다. |
| 운영 브라우저 수동 확인 | **부분 PASS / BLOCKED** | 위 E 표의 실제 배포 화면을 확인했다. 데이터가 필요한 사진/story/highlight 쓰기 경로는 검증용 운영 데이터가 없어 BLOCKED/UNVERIFIED다. |
| `git diff --check` | **PASS** | 검토 대상 기존 diff에 whitespace error 없음. |
| GitHub PR #89 CI | **PASS** | exact committed HEAD `c165370...`의 checks green. 미커밋 worktree는 증명하지 않는다. |

## 6. 실행하지 못한 테스트와 이유

- **BLOCKED — Sol Max 독립 결과:** `main/gpt-5.6-sol`, reasoning `max` agent가 공급자 502 및 이후 무응답으로 완료되지 않았다. 이전 상세 dispatch 기록은 [[2026-08-24_sol-max-profile-story-review]]에 있다.
- **BLOCKED — 운영 two-account actor browser:** active A/B, former partner, unrelated user의 실제 로그인 자격증명이 없어 브라우저 mutation을 하지 못했다.
- **BLOCKED — 운영 사진/story/highlight 상세:** 현재 로그인 세션에 검증용 데이터가 없고, 감사를 위해 실제 사용자 데이터를 생성하지 않았다.
- **UNVERIFIED — 실제 단말/기기 간:** iOS/Android 실기기 및 두 기기 간 avatar 동기화는 실행하지 않았다. 코드상 avatar는 동기화되지 않는다.
- **UNVERIFIED — remote migration history:** linked migration history가 비어 있어 실제 적용 순서를 재구성하지 못했다.

## 7. 원격 Supabase·Vercel·브라우저 검증 상태

### Supabase

- `supabase migration list --linked`: **UNVERIFIED** — usable remote history 없음.
- authenticated read-only catalog query: 057/058/059 핵심 객체 **APPLIED at object level**; 060 **NOT APPLIED**.
- 060 local definition: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, revoke/grant, `NOTIFY pgrst` 모두 존재.
- anon REST probes: new partner RPC `404/PGRST202`; legacy partner RPC, profiles, highlights는 `401/42501`.
- `profiles` direct RLS: owner-only. cycle raw tables: owner-only. partner cycle projection: sanitized signal only.
- `clear_my_unseen()`: **NOT APPLIED / absent**.
- 원격 mutation 및 migration 적용: **NOT APPLIED by this audit**.

### Vercel

- 배포 SHA: `a33499e179a163f87d0efae94ca3262f445fc00b`
- deployment: 성공, 공개 URL HTTP 200.
- 현재 local HEAD/worktree: **NOT DEPLOYED**.

### 브라우저

- 운영 로그인 세션에서 `/us`, `/search`, `/settings`, `/settings?profile=edit`, `/compose`, story 빈 상태, avatar input을 확인했다.
- 운영 콘솔에서 missing `clear_my_unseen()` 경고를 재현했다.
- 실제 사용자 데이터 mutation은 하지 않았다.

## 8. 가장 작은 수정안

1. 계급 rail을 실제 계급이 아닌 `복무 구간`으로 정직하게 바꾸거나, 제품이 실제 계급을 원하면 진급일/현재 계급 입력과 검증 규칙을 먼저 정의한다.
2. `mockBackend.ts`에 `get_partner_profile_with_username` route를 추가하고 PGRST202/42501/500 분기 테스트를 고정한다.
3. decrypt 뒤 client-side highlight replay에서도 사진 record만 허용하고 text-only shared record negative test를 추가한다. 새 media table은 만들지 않는다.
4. highlight fetch는 오직 missing-table/schema일 때만 `[]`로 degrade하고 권한·서버 오류는 sync failure로 올린다. owner profile fallback도 missing-column/schema로 제한한다.
5. 위 로컬 수정과 테스트가 끝난 뒤 별도 승인된 release gate에서 migration 060만 적용하고 A/B/C/former/anon actor를 검증한다.
6. `clear_my_unseen()`은 전 migration 재실행이 아니라 선행 객체를 확인한 뒤 해당 migration만 별도 복구한다.

## 9. 수정하지 말아야 할 사항

- UI 전체 재디자인, 색상·타이포·레이아웃 취향 변경.
- profiles SELECT/RLS, storage, cycle raw-data 권한 확대.
- 좋아요·조회수·본 사람 목록·팔로워·관계 점수·애정 점수 추가.
- avatar 동기화를 이미 된 것처럼 표시하거나 기존 couple-media 정책을 우회하는 업로드.
- attachment 선택을 위해 검토 없이 새 DB/media 모델 추가.
- remote history가 없다는 이유로 migration 001~060을 일괄 재적용.
- `RoleHome`을 즉시 삭제해 1,133줄 테스트의 유효 보장을 잃는 것. 먼저 `PaperHome` 경로로 필요한 보장을 옮겨야 한다.
- 기존 dirty worktree reset·stash·checkout 또는 사용자 변경 덮어쓰기.

## 10. 다음 작업 순서

1. 제품 오너가 `/search` 탭 canonical 충돌과 `계급` 대 `복무 구간` 의미를 결정한다.
2. 승인된 P1/P2 최소 코드 수정만 구현한다.
3. focused Vitest → targeted Playwright → `npm run verify` → `npm run test:phase0` 순서로 재검증한다.
4. 변경된 exact HEAD를 별도 검토자가 다시 판정한다.
5. 원격 backup/catalog 확인 후 migration 060만 승인 절차로 적용하고 actor 테스트를 실행한다.
6. `clear_my_unseen()` 결손은 별도 원인/선행 migration을 확인해 좁게 복구한다.
7. Vercel 배포 후 실제 두 계정으로 저장 직후·새로고침·former/unrelated/anon·private/highlight 경계를 검증한다.

## Changed files (this delta only)

- `control-tower/reports/codex/2026-08-24_1137_full-repository-independent-verification_codex.md` — 이 보고서 신규 작성.
- `docs/WORK_LOG.md` — 이번 감사와 보고서 위치를 ledger에 추가.

애플리케이션 코드·테스트·migration은 이 문서화 작업에서 수정하지 않았다.

## Production / remote impact

- Production: **NOT APPLIED**
- Supabase migration/data: **NOT APPLIED**
- Vercel: **NOT DEPLOYED**
- Git/PR: commit·push·PR update·merge **NOT PERFORMED**

## STOPPED AT

- branch: `codex/service-rank-profile-settings-impl`
- changed: Obsidian 보고서 1개와 `docs/WORK_LOG.md` 인덱스만 추가
- explicitly not changed: app code, tests, migration, remote data, deployment, PR
- tests: 감사 실행 결과는 위 표와 같음; 문서 delta `git diff --check` PASS
- Production: NOT APPLIED
- Supabase: NOT APPLIED
- P6: NOT CHANGED
- next owner: 사용자 승인 후 bounded implementation owner
