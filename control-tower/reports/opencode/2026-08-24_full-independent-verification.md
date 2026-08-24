---
agent: opencode
model: ox-alpha (opencode/x-preview-f-free)
role: Reviewer / Verifier (read-only)
date: 2026-08-24
time: "12:22"
task: "곰신로그 저장소 전체 독립 검증"
phase: V4
status: closed
canonical: false
tags:
  - agent/opencode
  - phase/v4
  - report
  - audit
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> Agent: [[opencode ox-alpha]] · Task: 곰신로그 저장소 전체 독립 검증
> 이전 보고서([[2026-08-24_1137_full-repository-independent-verification_codex]])를 사실로 신뢰하지 않고 독립적으로 재검증했다.

# 곰신로그 저장소 전체 독립 검증

검토 기준 시점: 2026-08-24 11:54–12:22 KST

## 1. 검증 대상과 exact HEAD

| 항목 | 값 | 확인 방법 |
|---|---|---|
| repository root | `/Users/han-yejun/Desktop/곰신로그` | session-start.sh |
| branch | `codex/service-rank-profile-settings-impl` | git live |
| checked-out HEAD | `c16537047924ec5e164fb36b8dad1aa2fb661b52` | `git rev-parse HEAD` |
| worktree 변경 상태 | tracked 22 files modified (`+491/−167`), untracked 3개 — 이전 codex 보고서, **`supabase/migrations/060_partner_username_projection.sql`(untracked)**, `src/lib/migration060.test.ts`(untracked) | `git status --porcelain` |
| origin/master | `7f4886bcbe32034bfabb454c85378532b14cb261` | `git ls-remote` live |
| 현재 PR | #89 — OPEN, non-draft, **MERGEABLE**, base=master, head=`c165370…` = 로컬 HEAD와 동일 | `gh pr view 89` live |
| CI 상태 | PR #89 head 기준 **14/14 SUCCESS** (typecheck/lint/Vitest/build, PostgreSQL security contracts, real-browser matrix, Deno, Android/iOS/Capacitor, audit/boundary/secret scan, Vercel preview) | `gh pr checks 89` live |
| Vercel Production | 공개 URL HTTP 200. 배포 번들 `index-BQRnvlJQ.js`. 정확한 소스 커밋은 대시보드 접근 불가로 **UNVERIFIED(직접)** — 번들 내용 증거상 `a33499e` 릴리스 후보와 일치(아래 §9) | curl + bundle marker 분석 |
| 원격 Supabase migration/catalog | CLI 추적 테이블(`supabase_migrations.schema_migrations`) **원격 column 전부 비어 있음**(SQL Editor 수동 적용의 알려진 상태). 057–059 대상 객체 존재·anon 차단 재확인. **060 RPC 부재 확인** | 익명 read-only PostgREST probe + `supabase migration list --linked` |

중요: **migration 060 SQL 파일과 그 테스트는 아직 git에 commit되지 않은 untracked 상태다.** PR #89의 CI는 이 파일들을 전혀 보지 못했다.

이전 보고서/WORK_LOG의 SHA를 현재 상태로 간주하지 않았고 위 표는 모두 이번 세션의 live 조회 결과다.

## 2. 최종 판정

**FAIL** (P0 없음, P1 2건)

릴리스 판정을 막는 것:

1. **P1 — 운영 Supabase에 060 RPC가 없는데, 현재 작업트리 클라이언트가 그 RPC를 최우선 호출한다.** 익명 probe에서 `get_partner_profile_with_username` → HTTP 404 / `PGRST202` 재확인. 클라이언트 fallback은 `PGRST202`일 때만 legacy로 내려가므로 원격에 legacy가 있어 동작은 유지되지만, **060이 적용되기 전에 현 작업트리를 배포하면** 신규 RPC 경로가 뜨는 순간 스키마 캐시 미갱신 환경에서 partner stage 실패로 이어질 수 있다. 반대 방향(코드 먼저 배포 → 서버 나중)의 의존성 순서가 계약상 정해지지 않았다.
2. **P1 — 현재 작업트리에서 Playwright 스위트 전체가 red.** `smoke.spec.ts`를 실제로 돌려 재현했다: mock backend가 새 RPC를 route하지 않아 HTTP 500(코드 없음) → full-state sync가 partner stage에서 실패 → 화면 `계정 정보를 확인하지 못했어요 / 진단 코드 PARTNER-UNKNOWN`. 즉 **커밋된 HEAD(c165370)의 green CI는 이 dirty worktree를 전혀 대변하지 않는다.**

로컬 단위/통합/DB harness는 강하게 통과했지만(§7), 위 두 가지는 로컬 그린으로 상쇄되지 않는 배포·검증 게이트 결함이다.

## 3. 요약

- 코드·문서·테스트·로컬 DB 체인·원격 catalog를 서로 다른 증거 경계로 분리해 재검증했다.
- 찾기 탭(복무 정보)·마이 탭(프로필/하이라이트/격자)의 **구현은 요청된 대로 존재**하며, 권한 경계(RLS/RPC/anon 거부)는 로컬 실액터 harness와 익명 원격 probe 양쪽에서 확인됐다.
- 그러나 (a) 060의 원격 미적용, (b) 060을 부르는 uncommitted 클라이언트 코드 + 갱신되지 않은 e2e fixture 조합, (c) canonical PRODUCT_V3와 runtime의 두 방향 충돌(찾기 탭, 사진 격자)이 남아 있다.
- 이전 codex 보고서의 P1/P2/P3 중 **폐쇄된 것은 하나도 없었고**, 본 검증은 그중 다수를 독립적으로 재확인했다. 일부 심각도는 본 보고서 기준으로 조정했다(§4).

## 4. 발견사항 (P0/P1/P2/P3)

### P1-1 — 운영에 060 RPC 부재 + 클라이언트 선호 호출 (배포 의존성 역전)

- severity: **P1**
- 위치: `supabase/migrations/060_partner_username_projection.sql`(untracked) · `src/lib/sync.ts:57-61`
- 문제: 원격에 `get_partner_profile_with_username()`가 없다(404 PGRST202 직접 확인). 현재 작업트리 `fetchPartnerProfile()`은 항상 이 RPC를 먼저 호출하고 legacy fallback은 오직 `code === 'PGRST202'`일 때만 허용한다.
- 사용자 영향: 060이 적용된 뒤 PostgREST 스키마 캐시가 리로드되지 않으면(P060에 `NOTIFY pgrst`가 있으나 SQL Editor 수동 실행 시 NOTIFY가 커밋과 함께 전달되는지 운영 관행상 보장 필요) 파트너 아이디 projection이 실패하고, fallback 조건을 벗어난 오류 코드(예: 네트워크 변형, 500)에서는 전체 sync 실패로 번질 수 있다.
- 보안 영향: 없음(읽기 전용 projection). 데이터 손실 없음.
- 재현: `curl -X POST $URL/rest/v1/rpc/get_partner_profile_with_username` (anon) → `404 PGRST202`.
- 실제 증거: §8 probe 로그.
- 최소 수정안: 승인된 release gate에서 060만 적용 + `NOTIFY pgrst` 확인 + A/B/C/former/anon actor probe. 클라이언트는 이미 fail-safe 설계라 코드 수정 불필요.
- 승인 필요: remote migration gate(운영 Supabase mutation).
- 검증되지 않은 가정: 원격 SQL Editor 실행이 `NOTIFY pgrst, 'reload schema'`를 실제로 전달했는지(057–059는 probe로 해석 확인됐으므로 관행상 작동하는 것으로 보이나 ledger는 UNVERIFIED).

### P1-2 — e2e fixture가 060 RPC를 모른다 → 작업트리 전체 e2e red

- severity: **P1** (이전 보고서 P2에서 상향 — smoke까지 깨져 스위트 전체가 부팅 실패)
- 위치: `e2e/fixtures/mockBackend.ts:447` (legacy `get_partner_profile`만 route; unrouted → `json(route, {...}, 500)` without code)
- 문제: 작업트리 클라이언트가 새 RPC를 먼저 호출하면 mock이 code 없는 500을 반환 → `fetchPartnerProfile`이 fallback 없이 실패 → `syncFailure('partner')`.
- 사용자 영향: 개발자 게이트 붕괴(모든 연결 시나리오 hydration 실패).
- 재현: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/..." npx playwright test e2e/smoke.spec.ts` → timeout at line 36, snapshot에 `진단 코드: PARTNER-UNKNOWN`.
- 실제 증거: `/tmp/smoke.log`, error-context.md page snapshot.
- 최소 수정안: mockBackend에 `get_partner_profile_with_username` route 추가(059가 저장한 username fixture 반환) + unrouted assertion 유지.
- 승인 필요: 없음(테스트 자산 수정).

### P2-1 — "현재 계급"이 실제 입력값이 아닌 복무율 사분위로 단정됨

- severity: **P2** (이전 보고서 P1 — 데이터·권한 영향이 없는 표시 진실성 결함으로 본 보고서는 P2로 판정. 제품 결정 대기 중이라는 점은 동일)
- 위치: `src/lib/serviceLevel.ts:25-31` (`thresholdPercent` 0/25/50/75 → 이등병/일병/상병/병장), `src/features/search/SearchPage.tsx:168` (`현재 계급 · ${level.label}`), :180-182 (`다음 계급까지`)
- 문제: 진급일·실계급 입력이 없는데 복무율 구간을 실제 군 계급으로 표시한다. 실제 진급 시점(군종별 상이)과 25% 경계는 일치하지 않는다. 입대일·전역일·D-day·복무율 자체는 사용자 입력값에서 올바르게 계산된다(`milestones.ts`). PRODUCT_V3 원칙 2 "앱은 사실만 말한다"와 충돌.
- 사용자 영향: 매일 잘못된 계급 정보를 사실처럼 읽음.
- 보안 영향: 없음. 관계 점수화도 아님(개인 복무 진행률이며 비교 요소 없음 — 확인).
- 재현: `/search` 진입(군화, 복무 중) → 복무율 ~26%에서 "현재 계급 · 일병" 표시.
- 최소 수정안: (a) 라벨을 `복무 구간`으로 정직화, 또는 (b) 실계급/진급일 입력 모델을 먼저 제품 결정.
- 승인 필요: product owner(탐지된 canonical 충돌과 함께 결정).

### P2-2 — canonical 충돌 2건이 해소되지 않은 채 구현 선행 (찾기 탭 · 사진 격자)

- severity: **P2** (방향 지배력 문제; AGENTS.md §16 "제품 방향이 바뀌면 이 문서를 먼저 고친다" 위반 상태)
- 근거:
  - `docs/PRODUCT_V3.md:199`(§5 "홈 · 나 · 일기장 · 일정 · 우리"), `:246-257`(§5.3 찾기는 탭이 아님) vs `src/components/MobileShell.tsx:44-77` 및 `docs/V4_AS_BUILT.md:31-43` — runtime/as-built는 `찾기`를 2번째 탭으로 운영.
  - `docs/PRODUCT_V3.md:635-650`(§10 하루 단위 격자, "사진 단위 격자는 … 쓰지 않는다") vs `src/features/us/postTiles.ts:56-72` + `SharedProfile.tsx:52-55,263-270` — 사진 기록 게시물 격자로 구현됨. V4_BACKLOG A2는 사용자 요청으로 DONE 기록.
- 사용자 영향: 없음(동작은 의도대로). 문서 지배력·다음 AI 세션 혼란 리스크.
- 최소 수정안: PRODUCT_V3 §5/§10을 사용자 승인 하에 개정하거나, 구현을 되돌릴지 결정. 본 검증은 어느 쪽도 선택하지 않음.

### P3-1 — highlight fetch 오류가 빈 배열로 축소됨

- `src/lib/sync.ts:380` (`highlightsResult.ok ? highlightsResult.highlights : []`), `src/lib/store.tsx:1651,1812` (`if (!result.ok) return;` — 단 이쪽은 보존이라 양호)
- `highlights.ts` failure는 `forbidden/unavailable/error`로 분류되는데 sync hydration은 그 구분을 버리고 전부 `[]` 처리. 42501·서버 오류가 "하이라이트 없음"으로 보인다. 최소 수정안: `unavailable`(missing table)만 degrade, 나머지는 sync failure로 승격.

### P3-2 — save_couple_highlight ↔ 기록 private 전환 race (숨은 잔여 child row)

- `supabase/migrations/058_couple_highlights.sql:138-147`(검증) vs `:169-172`(insert) 사이에 `daily_records.is_private=true` UPDATE(PostgREST 직접 — couples row lock을 안 잡음)가 끼면 private record를 참조하는 item row가 남는다. prune trigger는 transition(false→true) 시에만 동작하므로 이후 재prune 안 됨.
- 영향 유한: child RLS(:56-70)가 `r.is_private=false`를 요구하므로 **작성자 포함 누구에게도 노출되지 않음**. 빈 하이라이트 shell만 남을 수 있음. privacy 유출 아님, integrity 미비점.
- phase0는 sequential transition만 검증("shared-to-private removes … in the same transaction") — concurrency 미테스트.

### P3-3 — 058 highlight 직접 DELETE가 계정 삭제 pending gate를 우회

- DELETE policy(`:50-54`)는 active-couple만 요구 — unlink는 막힘(`get_my_active_couple_id()` NULL). 그러나 RPC(`:102`)와 달리 `is_my_account_deletion_pending()` 검사가 없어 **pending deletion 상태에서도 couple 하이라이트 전체를 직접 DELETE할 수 있다**. 파트너가 큐레이션한 데이터를 삭제 완료 전에 소멸시킬 수 있는 integrity 미비점. 최소 수정안: policy에 deletion-pending 조건 추가(새 forward migration).

### P3-4 — owner username 저장 dead branch

- `src/lib/store.tsx:2135-2176`: `updateProfile`이 `username` 직접 write 경로를 유지. UI 호출자 없음(grep 확인) + 059 trigger(`enforce_partner_managed_username`)가 서버에서 차단. 제품 경로와 모순되는 dead branch — 제거 대상.

### P3-5 — fetchProfileRow fallback 과잉

- `src/lib/sync.ts:80-92`: 첫 select의 **모든** 오류에 old-column query 재시도. missing-column/schema 오류로 한정 필요(네트워크·권한 오류를 조용히 저열 버전으로 덮음).

### P3-6 — realtime 복구 후 profile/username stale window

- `store.tsx:1618-1624` `reconcileSharedAccess`는 records/events/trips/talkAbout/highlights만 재조회 — **profile slice(내 username + `couple.partnerUsername`)는 제외**. 채널 다운 중 파트너가 `set_partner_username`하면 invalidation을 놓치고, 복구 후에도 다음 'profile' invalidation·재로그인까지 stale. `refreshSlice('profile')`(:1726)은 invalidation 도착 시엔 정상. 표시 메타데이터 한정, P3.

### P3-7 — 서버 highlight 저장이 사진 존재를 증명하지 않음

- `058:138-146` RPC는 same-couple/shared/non-private만 검사 — text-only shared record도 직접 RPC로 추가 가능. replay도 photo filter 없음(`StoryRoute.tsx:72-78`). UI 진입점은 양쪽 다 photo-gate(`StoryViewer.tsx:233`, SharedProfile editor는 photoRecords만). privacy 영향 없음(공유 기록 한정). P3.

### P3-8 — SharedProfile "아이디 설정하기" 라벨-목적 불일치

- `SharedProfile.tsx:170-176`: `profile.username`(내 아이디, 상대가 정함)이 없을 때 표시되지만 클릭 시 `/settings?profile=edit` — 그곳에서 설정 가능한 건 **상대방 아이디**뿐이고 내 아이디는 "상대방이 정해요"(:805,984). 편집 가능한 실경로이긴 하나 라벨이 기대와 다름. 카피 수정 제안.

### P3-9 — 운영 ACL drift + push flag RPC 결손 (이전 보고서 계승, 본 세션 재측정 불가/부분)

- 원격 authenticated grant 폭(058 의도 대비) — 익명 probe로만 재확인 가능, authenticated ACL 직접 조회 불가 → **UNVERIFIED**.
- `clear_my_unseen()` 404 재확인 — 048+가 원격 미적용인 현재 상태의 필연적 결과. 048+ 적용 gate에서 함께 닫힘.

### 참고 — 결함 가설 판정표 (요청 10건)

| # | 가설 | 판정 |
|---|---|---|
| 1 | 058 직접 DELETE가 삭제/unlink 잠금 우회 | **부분 확인** — unlink는 차단, deletion-pending gate만 우회(P3-3) |
| 2 | 하이라이트 저장↔private 전환 race | **확인** (P3-2, 노출 없음·integrity만) |
| 3 | 060 RPC auth.uid()/active couple/self-exclusion 검증 | **정확** — `p.id <> auth.uid()`, 양측 active, SECURITY DEFINER+fixed search_path, revoke/grant, disconnect 후 0행(phase0 actor) |
| 4 | 060 원격 적용 여부 | **NOT APPLIED** (404 PGRST202) |
| 5 | migration 테스트가 static 문자열만? | **부분 사실** — `migration060.test.ts`(17줄)은 문자열 검사뿐이나 phase0 harness는 실제 PostgreSQL 17 fresh chain에서 A/B/C/anon/former 행위 probe(333 assertions)를 실행. 전체는 static-only 아님 |
| 6 | realtime 복구 후 username/profile stale | **확인** (P3-6, 좁은 창) |
| 7 | 사진 격자 vs PRODUCT_V3 canonical | **충돌 확인** (P2-2) |
| 8 | SharedProfile "아이디 설정하기" 편집 경로 | **실경로 맞음** (단 라벨 불일치 P3-8) |
| 9 | 본인 username 저장 dead branch | **확인** (P3-4) |
| 10 | 다중 사진 기록의 격자 노출 | **첫 사진만 타일**(record당 1칸, `multiple` 플래그, viewer에서 전체 사진) — `postTiles.ts:56-72` |

## 5. 사용자 경로 결과

코드 존재 ≠ 실제 동작. 아래 표로 분리한다.

| 경로 | 코드(작업트리) | 실제 브라우저 |
|---|---|---|
| `/us` (격자·사진·여행, 하이라이트 rail) | PASS — SharedProfile/postTiles/postGrid 코드 요청대로 | fixture 기반 PASS(이전 세션) / **본 세션 UNVERIFIED**(브라우저 미구동 — smoke만 실행) |
| `/search` (역할별 기본 + 날짜/내용 검색) | PASS — 단 계급 표시 P2-1 | UNVERIFIED(본 세션) |
| `/settings` · `/settings?profile=edit` (상대 아이디 편집) | PASS — SettingsPage:317 modal 초기화, :799-815 partner editor | UNVERIFIED(본 세션) |
| 기록 작성 `/compose` | PASS(기존 경로 유지, 3대 진입점) | UNVERIFIED |
| 사진 상세보기 (PhotoPostViewer → exact `/record?record=`) | PASS — record id 정확 이동 | UNVERIFIED |
| 하이라이트 생성·수정·삭제 | PASS — client validation + RPC + direct DELETE | UNVERIFIED |
| 스토리→하이라이트 추가 | PASS — record-id 기반(`/us?highlightRecord=`), photo-gate | UNVERIFIED |
| 프로필 사진 변경 | PASS(코드) — **device-local only**, 동기화 없음을 문서·UI가 정직 고지(`avatarImage.ts`) | UNVERIFIED |
| 곰신/군화 양쪽 동기화 | 코드상 대칭(authorRole 매핑, role별 표면) | **BLOCKED** — 인증된 두 계정 자격증명 없음 |
| 로그아웃·재로그인·관계 해제 후 권한 | PASS(코드+harness) — quarantine/purge, disconnect actor tests | **UNVERIFIED**(실제 브라우저 lifecycle 미수행) |

## 6. 데이터베이스·RLS·Storage 결과

- **profiles RLS**: owner-only 유지. anon SELECT(username/caption 포함) → `401 42501` 원격 재확인. 060은 profiles RLS를 넓히지 않음(SECURITY DEFINER RPC로만).
- **couple_highlights**: anon → `401 42501`. parent SELECT/DELETE policy는 active-couple scope, child SELECT는 shared-only(+record shared 요구). INSERT/UPDATE는 authenticated에게 GRANT 자체가 없어 RPC로만 가능.
- **cycle raw data**: owner-only 경계 유지(migration ledger + phase0). 파트너 projection은 sanitized signal만(025/026 계승). SearchPage 곰신 표면은 자기 데이터만 렌더.
- **059 set_partner_username**: NULL actor·형식·active couple lock·재확인·self-exclusion·deletion gate·collision→`username_taken` 모두 구현 + phase0 actor 검증(owner 직접 변경 거부, former partner 거부, anon 거부).
- **Storage**: avatar는 업로드 자체를 안 함(정책 확대 회피 설계, `avatarImage.ts`). couple-media 정책은 이번 세션에서 원격 실측 안 함 → 기존 B1 gate 요구 유지.

## 7. 테스트 결과

| 명령 | 결과 | 실제 증명 범위 |
|---|---|---|
| `git diff --check` | **PASS** | 기존 dirty worktree diff에 whitespace error 없음 |
| `npm run verify` | **PASS** (EXIT=0) | typecheck + lint(max-warnings 0) + Vitest **231 files / 3,279 tests** + production build(654.30 kB main chunk 경고는 기존 것). **커밋된 HEAD+dirty worktree 로컬 품질의 증거일 뿐**, 원격/배포 증거 아님 |
| `npm run test:phase0` | **PASS** (EXIT=0) | throwaway PostgreSQL 17 fresh chain **001..060(58 migrations, 041/042 frozen)**, **333 assertions** 전부 ok — A/B/C/anon/former 실액터 + mutation proof. 로컬 체인 증거이며 **원격 적용 증거 아님** |
| `npx playwright test e2e/smoke.spec.ts` (+Chrome 실행파일 override) | **FAIL** | 60s timeout, `PARTNER-UNKNOWN` — P1-2 재현. 나머지 e2e 스펙은 미실행(같은 원인으로 전부 red 예상 — 추정이 아니라 smoke 재현으로 대변) |
| Playwright 전체 스위트 | **NOT RUN** | smoke 실패로 게이트 목적 달성; 전수 실행 생략 |
| GitHub Actions PR #89 @ `c165370` | **PASS 14/14** | 커밋된 HEAD만 검증 — **dirty worktree·untracked 060은 미포함** |
| 원격 Supabase actor-based negative verification | **부분** | 익명 negative probe 7건 수행(§8); authenticated actor 원격 실측은 BLOCKED(자격증명 부재) |

로컬 통과를 원격/브라우저/배포 통과로 확대 해석하지 않았다.

## 8. 원격 Supabase 상태 (2026-08-24 12:00 KST, 읽기 전용)

| probe (anon) | 결과 | 해석 |
|---|---|---|
| POST rpc/`get_partner_profile_with_username` | **404 PGRST202** | **060 NOT APPLIED** |
| POST rpc/`get_partner_profile` | 401 42501 | legacy RPC 존재, anon 차단 정상 |
| POST rpc/`set_partner_username` | 401 42501 | 059 객체 존재, anon 차단 정상 |
| POST rpc/`clear_my_unseen` | 404 PGRST202 | 048+ 미적용 상태 재확인 |
| GET `couple_highlights?select=id` | 401 42501 | 058 객체 존재, anon 차단 정상 |
| GET `profiles?select=username` | 401 42501 | 057 컬럼 존재, owner-only 유지 |
| GET `profiles?select=profile_caption` | 401 42501 | 동일 |
| `supabase migration list --linked` | 원격 column 전부 공란 | CLI 추적 테이블 비어 있음 — **절대 `supabase db push` 금지**(README 경고 유효) |

- 전체 migration ledger: **UNVERIFIED**(dump BLOCKED — Docker Desktop 부재는 이전 기록, 본 세션은 미재시도).
- 본 검증의 원격 mutation: **없음** (익명 read-only/negative probe만).

## 9. Vercel · CI · 브라우저 상태

- **Vercel**: prod URL HTTP 200(x-vercel-cache HIT, last-modified 2026-08-24 01:12 UTC). 배포 번들 마커 분석: `set_partner_username` **포함**(059-era UI = a33499e 릴리스 후보와 일치), `get_partner_profile_with_username` **부재**, SearchPage chunk에 이등병/일병/상병/병장 rail **포함**. → 운영은 **현재 작업트리(060 클라이언트 + 격자 확장)보다 이전**임이 번들 증거로 확인. 정확한 소스 커밋 필드는 UNVERIFIED(대시보드 토큰 부재).
- **CI**: PR #89 @ c165370 14/14 green(§1 표). dirty worktree는 CI가 원래 검증하지 않음.
- **브라우저**: 본 세션은 fixture 기반 smoke 1건만 실행(실패 = P1-2 증거). 운영 로그인 브라우저 검증은 수행하지 않음(사용자 데이터 생성 금지 원칙).

## 10. 검증하지 못한 항목

- 인증된 두 계정(A/B/former/C)의 실제 브라우저 mutation·동기화 실측 — **BLOCKED**(자격증명 부재, 감사용 사용자 데이터 생성 거부)
- iOS/Android 실기기, 기기 간 avatar(설계상 미동기화) — UNVERIFIED
- 원격 authenticated ACL 상세·full schema dump — BLOCKED/UNVERIFIED
- 운영 Vercel deployment metadata의 정확한 source commit — UNVERIFIED(간접 번들 증거만)
- Playwright 전체 스위트 — NOT RUN(smoke로 대변)
- 060 원격 적용 시 `NOTIFY pgrst` 전달 실측 — 당연히 미실측(미적용)

## 11. 최소 수정 순서

1. **P1-2**: `e2e/fixtures/mockBackend.ts`에 060 RPC route 추가 → smoke 재실행으로 green 확인. (승인 불필요)
2. **P2-1/P2-2**: 제품 오너 결정 — (a) 계급 라벨 정직화 vs 실계급 입력 모델, (b) PRODUCT_V3 §5/§10 개정 vs 구현 되돌림. 결정 전 신규 구현 금지.
3. P3-1/4/5/8: 작은 클라이언트 수정(highlight 오류 승격, dead branch 제거, fallback 한정, 카피) — 각각 repro test 선행.
4. P3-2/3/7: 058 후속 forward migration(061+) 설계 시 일괄 — policy deletion-gate, RPC photo-proof 또는 문서화 수용, (race는 문서화 수용도 가능 — 노출 없음).
5. **P1-1**: 승인된 release gate에서 060만 원격 적용 → `NOTIFY pgrst` 확인 → A/B/C/former/anon actor probe → 그 후에야 060 클라이언트 코드 배포(서버 먼저, 클라이언트 나중 순서 준수).
6. 048+ 미적용 세트(포함 `clear_my_unseen`)는 별도 원격 gate 항목으로 유지.
7. PR merge → Vercel 배포 → 실제 두 계정으로 저장 직후·새로고침·former/unrelated/anon·private 경계 검증.

## 12. 수정 후 재검증 계획

- focused Vitest → `npx playwright test`(전체) → `npm run verify` → `npm run test:phase0` 순서, 전부 exact HEAD 고정.
- 원격 060 적용 직후: anon negative probe(404→401 전환 확인) + authenticated actor 3종 probe + 스키마 캐시 리로드 실측.
- 배포 후: prod bundle marker(`get_partner_profile_with_username` 포함 여부)로 번들-서버 정합 재확인, 두 계정 브라우저로 username 저장→새로고침→복원 경로.
- 본 보고서 판정은 **해당 exact HEAD + dirty worktree에 한해 유효**하며 HEAD/worktree가 바뀌면 자동 승계되지 않는다(REVIEW IMPACT: FULL — 이전 codex review 대비 dirty delta 재검증 완료).

## 13. 변경 금지 확인

- 애플리케이션 코드 변경: **없음**
- DB/migration 변경: **없음**
- 원격 Supabase 변경: **없음** (익명 read-only probe만 실행)
- Vercel 변경: **없음**
- commit/push/PR 변경: **없음**

변경된 파일은 이 보고서 1개뿐이다. 기존 작업트리(dirty 22 files + untracked 3)는 그대로 보존했다.

---

## READY-TO-COPY WORK_LOG ENTRY

> READ-ONLY reviewer이므로 `docs/WORK_LOG.md`를 직접 수정하지 않는다. write-capable owner가 아래를 복사한다.

```markdown
### 2026-08-24 · opencode · 저장소 전체 독립 검증 (2차)

#### PLAN POSITION
- Phase: V4 independent verification / release readiness
- Workstream: engineering audit — functionality, privacy, authorization, database, browser, deployment state
- Step: whole-repository independent re-verification of the codex FAIL report
- Previous Gate: codex full-repository independent verification (FAIL, 2026-08-24 11:37)
- This Gate: independent FAIL confirmation with sharper evidence; no fix applied

#### DIRECTION CHECK
- Product source checked: docs/PRODUCT_V3.md
- Business source checked / NOT APPLICABLE: NOT APPLICABLE (no business-strategy change)
- Engineering source checked: docs/ENGINEERING_ROADMAP.md
- Current-state checked: docs/CURRENT_STATE.md
- Latest relevant Work Log checked: docs/WORK_LOG.md (2026-08-24 codex entries)
- MASTER PLAN version / 기준일: V4 working direction / 2026-08-24
- Does this task conflict with canonical direction? YES (reported, not resolved)
- If YES, what conflict: PRODUCT_V3 §5/§5.3 (찾기 비탭) & §10 (사진 격자 금지) vs runtime MobileShell/SharedProfile + V4_AS_BUILT/V4_BACKLOG A2

#### OWNERSHIP
- Tool: opencode
- Model: ox-alpha (x-preview-f-free)
- Role: independent Reviewer/Verifier (read-only)
- PR: #89 inspected only
- Branch: codex/service-rank-profile-settings-impl
- Base SHA: 7f4886bcbe32034bfabb454c85378532b14cb261 (origin/master)
- Old HEAD: c16537047924ec5e164fb36b8dad1aa2fb661b52
- New HEAD / Reviewed HEAD: unchanged c165370… plus preserved dirty worktree (22 modified + 3 untracked incl. migration 060)

#### CHANGED / REVIEWED
- file: control-tower/reports/opencode/2026-08-24_full-independent-verification.md
- what changed/reviewed: independent verdict FAIL — P1×2 (060 not applied remotely; e2e suite red on worktree via missing mock route), P2×2, P3×9; defect-hypothesis table re-adjudicated
- why: second-source verification before any implementation owner acts on the first report

#### EXPLICITLY NOT CHANGED
- crypto semantics: none
- DB/migration semantics: none
- product semantics: none (conflicts reported for user decision)
- Production: no Supabase/Vercel/user-data change; anonymous read-only REST probes only

#### VERIFICATION
- command: npm run verify → PASS EXIT=0 (231 files / 3279 tests + build)
- command: npm run test:phase0 → PASS (58 migrations / 333 actor assertions, PG17 fresh chain 001..060)
- command: npx playwright test e2e/smoke.spec.ts → FAIL (PARTNER-UNKNOWN; 060 RPC unrouted in mock)
- command: git diff --check → PASS
- command: gh pr checks 89 → 14/14 SUCCESS at c165370 (committed HEAD only)
- command: anonymous PostgREST probes → get_partner_profile_with_username 404 PGRST202 (060 NOT APPLIED); 057–059 objects resolve with 401/42501 anon deny
- what it actually proves: local chain quality and the two release-blocking gaps; NOT remote actor behavior or browser parity

#### REVIEW IMPACT
- FULL — supersedes reliance on the prior report for the current dirty worktree state

#### BLOCKERS
- code: rank semantics decision; highlight error-collapse; dead owner-username branch; over-broad profile fallback
- environment: two-account browser credentials absent; Docker absent for remote dump
- external/manual: migration 060 remote application requires approved gate; PRODUCT_V3 amendment requires user approval

#### STOPPED AT
- exact completed boundary: read-only verdict saved to control-tower/reports/opencode/2026-08-24_full-independent-verification.md

#### REMAINING
- not completed: all fixes (none authorized); full Playwright suite; two-account production browser verification; remote 060 application

#### NEXT ACTION
- next owner: user-approved implementation owner + product owner
- tool/model: bounded implementation model for P1-2 fixture route + chosen P2 decisions
- 기준 SHA: c165370… + preserved dirty worktree
- exact next task: add 060 RPC to e2e mock backend, rerun smoke; obtain product decisions for rank label and PRODUCT_V3 §5/§10 amendments

#### DO NOT ADVANCE UNTIL
- migration 060 is applied through an approved remote gate BEFORE the 060-aware client is deployed
- targeted Playwright completes green on the exact release HEAD
- canonical navigation/rank/photo-grid conflicts have explicit user decisions

#### PRODUCTION
- NOT APPLIED
```

*Obsidian 보관 위치: `control-tower/reports/opencode/` (control-tower Obsidian vault 내).*
