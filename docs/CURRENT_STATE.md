# 곰신로그 CURRENT STATE — 저장소 현실

> **이 문서는 현시점의 저장소 현실을 기술한다.** `PRODUCT_V3.md`는 2026-08-24
> 제품 오너 결정으로 legacy가 되었고, 활성 제품 방향은 최신 사용자 승인 요청과
> [`V4_AS_BUILT.md`](V4_AS_BUILT.md)에서 확인한다. 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)가 소유한다.
>
> 이 문서는 default branch reality와 active development checkpoint를 분리한다.
> active draft PR의 코드가 default branch에 구현된 것으로 보이지 않게 한다.

- 조사 기준: default branch `master`와 GitHub live state, 2026-08-18. §1의 branch
  consolidation checkpoint는 2026-08-20 전수 감사 기준이다
- 조사 방식: 저장소와 GitHub PR metadata/body 대조
- remote Supabase/Auth/Vercel과 최신 iPhone package 상태: 2026-08-28 §0B에서 live 갱신.
  signed Archive와 App Store Connect IPA export는 PASS지만 실제 화면·인증 사용자 경로·두 계정·
  TestFlight 업로드/설치는 여전히 **UNVERIFIED**

분류:

| 코드 | 뜻 |
|---|---|
| `FUTURE` | EXPECTED FUTURE WORK |
| `PRODUCT` | PRODUCT DECISION 또는 product gap |
| `SEC` | SECURITY/PRIVACY CONFLICT |
| `LEGACY` | LEGACY TO DEPRECATE |
| `BETA` | BLOCKS BETA |
| `PROD` | BLOCKS PRODUCTION |

## 0A. Active working checkpoint — 2026-08-25

- The product owner explicitly moved `docs/PRODUCT_V3.md` to **legacy**. Do not use
  that document to reactivate superseded navigation or product decisions.
- On branch `codex/service-rank-profile-settings-impl`, release commit `b2ca94f`
  is now present in `origin/master`. The current working tree still contains
  excluded local assets, while the committed product slice includes a display-only
  service EXP model: 1 second = 1 EXP, a live
  four-decimal progress percentage, an internal 200-level EXP curve, and seven
  user-facing service tiers (신병·일초·일꺾·일말·상초·상꺾·왕고). The tier is
  date-progress decoration only; it has no administrative-promotion, reward,
  push, share, ranking, nickname, or relationship-score semantics.
- The EXP calculation uses the user-entered enlistment/effective discharge dates
  on a fixed `Asia/Seoul` calendar timeline. Missing, unknown, malformed, or
  non-positive date ranges do not produce invented progress.
- The current `/search` surface renders this service card for the soldier role.
  Its default view now keeps the current tier, next target, and live EXP visible
  while the complete seven-tier rail is hidden behind an accessible 44px disclosure.
  A partner-facing service projection for the gomsin role is **not implemented**:
  the current sync path exposes partner identity only, not `military_info`. Adding
  that projection requires a separate privacy/RLS/RPC design and remote gate.
- Migration 060 is committed and pushed, PR #89 is merged, and the exact-SHA
  web/native/security/real-browser CI is PASS. Remote Supabase 060 was not
  applied by this task and remains **UNVERIFIED**. Production `/us` returned HTTP
  200, but authenticated two-account production refresh and physical-device
  evidence remain **UNVERIFIED**.
- Commit `bfc7423` adds an iOS-only Foundation Models adapter for the partner-today
  story cover. The app still builds the authorised, deterministic maximum-five-line
  corpus first; native code receives only ordinal index and normalised text, and
  JavaScript rejects the whole model batch if count, order, index, or length changes.
  The flag `VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED` is default-off. Web, Android,
  unsupported devices, timeout, cancellation, and invalid output keep the existing
  rules result. Simulator compilation is **PASS**; actual Korean model quality,
  offline networking observation, latency, heat, and battery on an eligible physical
  iPhone remain **UNVERIFIED**.
- Launch sequencing is iPhone App Store first. Android users retain the platform-neutral
  web/PWA and Supabase-backed shared data path; Google Play packaging is not an active
  release gate. iCloud/CloudKit is not implemented and is not the source of truth.
  It remains a possible later, optional encrypted backup layer only.
- Historical note: this 2026-08-25 checkpoint observed 057–059 but not 060/061.
  It is superseded by the 2026-08-28 live catalog in §0B, which found 060/061/062
  objects present while the migration ledger relation remains absent. Bulk
  `supabase db push` is still prohibited.

## 0B. Active UI/profile-post and live release-gate checkpoint — 2026-08-28

- **2026-09-01 product realignment candidate (base `origin/master` `d69b677`, isolated worktree):** Diary는 월 카드에서 날짜별 페이지로 들어가 기록 포함/제외·순서·종이 5종·3개 제한 레이아웃을 계정별 기기 로컬 메타데이터로 저장하고, 원본 `daily_records`는 복제하지 않는다. 기존 무료 스티커 12종/배치는 `기존 월 꾸미기`로 보존하며 로그아웃·계정 삭제 시 `gomsin.diary.*` 로컬 namespace를 정리한다. `/shop`은 `종이 보관함`으로 축소되어 유료 스티커·테마·Memory Product·결제 UI를 숨겼고 Book Studio는 FROZEN이다. Push는 기본 OFF이며 새 권한/등록/browser notification을 막는 동시에 과거 빌드가 남긴 token을 authenticated 상태에서 best-effort revoke하고 `clear_my_unseen`은 계속 유지한다. iOS Foundation Models 보조는 지원 native에서 default-ON으로 전환했지만 Story를 열 때 자동 실행하지 않고 `AI로 다듬기`를 눌렀을 때만 시작한다; 웹/Android/미지원/timeout/invalid output은 deterministic summary를 유지하고 `false|0|off`가 kill switch다. 현재 candidate 검증은 `npm run verify` 270 files / 3,809 tests, native 106/106, Edge 18/18, 영향 브라우저 30/30, `git diff --check`, Capacitor sync, Xcode 26.6 unsigned iOS Simulator build PASS다. 이 작업은 Supabase/Production/Vercel/TestFlight를 변경하지 않았고, 지원 **실물 iPhone**의 Foundation Models 한국어 품질·airplane mode·cold/warm latency·발열·배터리는 **UNVERIFIED**다.
- **2026-09-01 interactive companion garden candidate (base `origin/master` `b7df5f6`, isolated worktree):** 과거 `codex/couple-garden-v1`의 정적 이미지/성장 단계만 통째로 merge하지 않고 현재 master에 `/diary/garden`을 재구현했다. 연결된 현재 커플·server lifecycle `connected`·유효한 비미래 anniversary date가 모두 확인될 때만 정원을 보이는 fail-closed 경계를 유지한다. 두 오리지널 캐릭터는 독립 랜덤 목적지/이동·휴식 타이머로 정원 경계 안을 걷고 최소 간격을 지키며, 탭/Enter 시 900ms 들어 올려져 버둥댄 뒤 복귀한다. reduced-motion에서는 자동 보행을 멈추고 작은 들림만 남긴다. `없음/모자/리본/목도리/꽃` 무료 액세서리는 친구별로 `gomsin.diary.garden.<userId>` 로컬 상태에 저장되고 logout/account-deletion purge에 포함된다. 점수·스트릭·먹이·미션·결제·AI·서버 저장은 추가하지 않았다. 검증은 app release validation PASS, 전체 Vitest 277 files / 3,877 tests, Playwright 133/133, native 106/106, Edge 18/18, `git diff --check` PASS다. Supabase/Production/Vercel/TestFlight mutation은 **NOT APPLIED**다.
- **2026-09-01 local recovery delta:** branch `codex/profile-post-composer`, HEAD `a536f9b` 위 미커밋 Profile Post Composer 변경에서 publication-only retry, response-loss read-back, publication-close 삭제 방지와 realtime/local 경쟁 상태를 보강했다. 지연된 정상 성공과 read-back 모두 더 최신 record snapshot을 되돌리지 않으며 revision/attachments를 한 record 단위로 보존한다. 최종 scoped 검증은 8 files / 184 tests, typecheck, scoped lint, build, diff-check PASS; local P0/phase0/P5/write-floor/native 보안 하네스도 PASS했고 Terra 독립 재검토는 P2 **RESOLVED**, 새 P0/P1/P2 없음이다. 현재 Production write는 **NOT APPLIED**이고, 2026-09-01 anon read-only probe는 067 열 요청을 `401/42501`로 거부했지만 current authenticated remote actor/catalog·physical device·TestFlight는 여전히 **UNVERIFIED**다. 또한 linked Supabase CLI dry-run이 DB credential을 세션 출력에 노출해 **credential rotation이 운영 보안 종료 전 필수 manual blocker**다.
- **2026-09-01 service-readiness closure:** Edge Function 네 곳의 platform logger를 bounded allow-list로 묶어 caller/device/challenge ID, token, path, message, content가 로그로 전달되지 않게 했고, 모든 console 인자를 검사하는 privacy AST guard와 회귀 테스트를 추가했다. 지연된 미디어 응답은 최신 record snapshot을 보존하며 오래된 attachment를 삭제하지 않는다. Terra exact-tree 최종 검토는 **PASS / 새 P0·P1·P2 없음**. 현재 트리 기준 `npm run verify`는 268 files / 3,807 tests PASS, Playwright 124/124, Edge 18/18, P0 76, phase0 420, P5 105, write-floor 39, rollback, native 106, audit 0 vulnerabilities가 PASS했다. Capacitor sync와 Xcode-27-Beta unsigned iOS Simulator build도 PASS했다. `npm run build:release`는 필요한 `sb_publishable_` 형식 키가 이 세션 환경에 없어 fail-closed로 중단되었으며, Production/Supabase mutation·CI 재실행·실기기 설치는 **NOT APPLIED / UNVERIFIED**다.
- Branch `codex/profile-post-composer`, source HEAD `044d324`: Story는 작성자 이름을 반복하지
  않고 `HH:mm` 시각, 17px 본문, 원본 비율 사진과 콘텐츠 아래 액션을 사용한다. Home과
  My 헤더는 root 스크롤 안에서 고정된다. 설정에는 계정별 기기 로컬 `무지 종이 / 줄 종이`
  선택이 있고 재실행·계정 전환 시 다시 읽는다.
- Source commit `d40d7ee`: Home 사진 포스트도 작성자 아바타·이름과 캡션 이름을 반복하지
  않고 `사진 → 글 → 오늘/어제 HH:mm·원본·책갈피` 순서로 표시한다. DB가 `HH:mm:ss`를
  반환해도 화면은 분까지만 보이며 원본·책갈피의 44px 동작은 유지된다.
- Source commit `f12e83e`: 설정의 `보기`에 계정별 기기 로컬 `작게(15px) / 기본(17px) /
  크게(20px)` 게시물·Story 본문 크기 선택이 생겼다. Home, Story, My 게시물 상세와 legacy
  feed의 사람 작성 본문만 바뀌고 시간·버튼·법적 문구는 바뀌지 않는다. 앱 안 새 알림과
  성공/오류 toast는 `safe-area + 64px` 아래에 표시되어 상태바·고정 헤더에 가리지 않는다.
- Source commit `5b15685`: pre-auth entry에서 Home/media 코드를 분리하고 React 실행 전 크림색
  boot surface를 넣었으며 사진 디코딩을 비동기로 바꿨다. production entry는 657.02KB /
  197.58KB gzip에서 437.01KB / 133.18KB gzip으로 줄어 500KB 경고가 사라졌다. fresh 전체
  Vitest 264 files / 3,761 tests, 전체 lint/typecheck, browser 10건(smoke 1 + media/story 9),
  release build/sync가 PASS했다. Xcode 27 beta signed Archive `0.1.0 (2026082801)`과 10MB
  App Store Connect IPA export도 PASS했지만 Apple 서버 업로드는 **NOT APPLIED**다.
- My의 게시물 격자는 모든 Story 사진을 자동 수집하지 않는다. `+` 게시물 작성기에서 사진이
  완전히 저장된 마지막 업데이트에 `is_profile_post=true`가 붙은 공유 사진 기록만 보인다.
  일반 Story 사진과 이전 기록은 `사진` 목록에 보존되고, 타일·상세·원본은 같은 record ID를
  계속 사용한다. 기존 행은 발행 의도를 추측 backfill하지 않는다.
- Migration 067은 `BOOLEAN NOT NULL DEFAULT false` 한 열만 추가하고 새 RLS/RPC/index를
  만들지 않는다. 로컬 PostgreSQL 17 fresh chain은 65 migrations / 420 assertions PASS다.
  일반 기록은 새 필드를 생략하므로 DB-first 전환 중 기존 CRUD의 blast radius를 줄인다.
- `LANG=en_US.UTF-8 npm run verify`는 260 files / 3,753 tests, 전체 typecheck/lint와 2,166
  modules build까지 PASS했다. 320/390px Playwright 5/5와 Xcode 27 beta / iPhoneSimulator
  27.0 unsigned build도 PASS했다. 이 결과는 실물 iPhone·Production·TestFlight 증거가 아니다.
- 2026-08-28 사용자 action-time 승인 뒤 exact repository SQL을 `064 → 065 → 067 → 063`
  순서로 Production Supabase에 각각 적용·검증했다. 최종 catalog는 063 함수 1개와 065 RPC
  3개가 authenticated-only, SECURITY DEFINER, fixed `search_path`, `auth.uid()` bound임을
  확인했다. `crypto_pairings`의 authenticated 권한은 정확히 `SELECT`만 남고 anon SELECT는
  false다. `daily_records.is_profile_post`는 boolean NOT NULL DEFAULT false이고 기존 5행은
  모두 false, NULL 0행이다. migration ledger relation은 여전히 없으므로 `supabase db push`는
  계속 금지한다.
- live rollback-only actor matrix는 063의 gomsin 1행, soldier/former/unrelated 0행과 067의
  owner update·active partner shared read·private/former/unrelated 차단을 확인했다. 065는 정상
  start 후 rollback, NULL evidence/signature, former/unrelated, noncanonical/unconfirmed
  activation 거부를 확인했다. PostgREST anon은 새 RPC/열을 schema-missing 없이 `401/42501`로
  거부했다. 단, live active device와 active couple scope key가 각각 0이어서 실제 두 기기
  confirm→activate 정상 경로와 실제 JWT HTTP authenticated actor matrix는 **UNVERIFIED**다.
- `push_delivery_state`와 `send-push`는 여전히 없고 066은 **NOT APPLIED / 명시적 보류**다.
- Free plan에는 관리형 physical backup/PITR이 없었다. 저장소 밖 AES-256 암호화 public
  schema+data archive를 만들고 격리 PostgreSQL 17에 exit 0으로 실제 복원했다: 5 records,
  39 tables, 69 functions, 53 validated public FKs. Auth row와 Storage blob은 이 archive 범위가
  아니므로 전체 Supabase 재해복구 증거는 아니다.
- Supabase Auth는 Email/Google ON, Apple OFF이고 query-aware `sb_flow_id` redirect는 live다.
  Apple Client IDs/Secret은 비어 있다. Vercel Production은 master `d9a2eb0`, feature Preview는
  `044d324`에서 Ready이며 Production은 변경하지 않았다. 2026-08-28 fresh release build는
  live Supabase publishable key를 메모리로만 전달해 2,166 modules를 빌드했고, `dist`, iOS
  `public`, signed `App.app`의 `index.html` SHA-256이 일치했다. Xcode 27 beta/iPhoneOS 27
  signed build·덮어 설치·launch와 5초 후 process 생존은 PASS다. 실제 화면·로그인·두 계정·
  Foundation Models는 여전히 UNVERIFIED다.
- Production DB delta와 rollback-only actor 검증은 완료됐다. 다음 최소 단계는 독립 보안
  사후 검토를 닫고 PR #90을 merge한 뒤, Apple Services ID/secret/provider와 실제 iPhone
  Google/Apple PKCE 왕복을 별도 action-time gate로 진행하는 것이다. `supabase db push`, 066,
  Apple enable, Vercel Production deploy, TestFlight는 아직 실행하지 않았다.

## 0. Default-branch reality

### Latest live checkpoint — 2026-08-23

- The photo-only post correction is in the default branch; runtime implementation is in `a773834` and the follow-up browser-fixture correction is in `8d6f67d`. The latest profile correction runtime commit is `8ee3818`.
- Our first tab now renders a travel-scoped **photo-only** post grid; a tile opens a photo-primary detail viewer; the photo tab renders the existing record-centered list; the travel tab now shows a compact list of up to three trips before the full planner. Profile tabs keep a stable border footprint and inset focus ring.
- Search keeps the existing local date/content search. With an empty query, the soldier role shows service/contact information and the gomsin role shows the existing cycle surface.
- master validation run 32633810978 and native release validation run 32633810931 both completed successfully for `8d6f67d`. The Vercel production URL returned HTTP 200; the in-app browser showed the photo-only empty state on `게시물` and the existing record list on `사진`.
- The remote browser matrix passed the fixture-backed photo tile and detail-viewer path at 320px and 390px. An authenticated browser refresh of /us showed 게시물 · 사진 · 여행; /search still retains its role-specific surface from the preceding change.
- Supabase, Production data, migrations, and remote catalog were not changed or applied.
- PR #88 remains open at a different head (a7c2d5c); it was not approved because it does not identify the deployed commit.

### Latest release checkpoint — 2026-08-24

- The release checkout adds the next product slice in implementation commit `fd6c305` (feature integration `e1874d6` plus the post-deploy 44px tap-target repair): the soldier search surface now shows service information and a personal service level inline; the My profile surface shows one identity, an optional English username, an editable token-based caption, the existing local profile-photo picker, and source-derived highlight edit entrypoints.
- Migration `057_profile_identity_and_caption.sql` is present in the repository and is included in the fresh-chain harness. The throwaway PostgreSQL proof covers 55 migrations and 309 assertions. **Remote Supabase application is NOT APPLIED and the remote catalog is UNVERIFIED.**
- `npm run verify` passed on the release checkout: typecheck, lint, 226 Vitest files / 3240 tests, and build. `git diff --check` passed. GitHub master validation `32648302871` and native release validation `32648302894` both passed; the real-browser matrix passed after the tap-target repair.
- The profile username/caption write path is account-owner scoped, not a device-identity policy. Profile photos remain in the existing device-local avatar boundary. Highlight editing routes to the source feature (`/settings`, `/schedule`, `/service`) until a specific-event editor contract exists.
- Vercel reports the `fd6c305` deployment successful, and the in-app browser confirmed `/us`, `/search`, profile editing entrypoints, and the post/photo/travel tab paths. No Supabase or production data was changed.

이 절은 merge된 default branch만 설명한다.

| 영역 | master 기준 현실 |
|---|---|
| P5.1 daily_records E2EE | Approved security baseline `0660ad277`에 포함되어 PR #68로 master에 landing됨; Production 적용은 NOT APPLIED / 원격 catalog는 UNVERIFIED |
| Device Bootstrap | Approved security baseline `0660ad277`에 포함되어 PR #68로 master에 landing됨; 실기기 검증은 UNVERIFIED |
| Chat foundation | PR #59 active draft에 구현됨; **FROZEN / DEFERRED**, 아직 merge되지 않음 |
| Chat product UI | PR #60 active draft에 구현됨; **FROZEN / DEFERRED**, 아직 merge되지 않음 |
| Core Privacy Foundation integration | Approved baseline `0660ad277`에 통합되어 PR #68로 master에 landing됨; Production 적용은 NOT APPLIED / 원격 catalog는 UNVERIFIED |
| active migrations 039/040/043/044 | master에 repository artifact로 존재할 수 있으나 원격 Supabase 적용은 UNVERIFIED; migration 파일 존재는 적용 증거가 아님 |
| ARCH-P6 | architecture decision은 완료, P6 implementation은 시작되지 않음 |

따라서 master 기준 P5.5 approved security stack과 reviewed browser harness는
landing 완료 상태다. Production/Supabase/native physical-device evidence는 별도
gate이며 여전히 자동으로 충족되지 않는다. Chat foundation/UI는 여전히
FROZEN / DEFERRED active draft asset이다.

## 1. Active development checkpoint — 2026-08-18

아래 PR/HEAD는 live GitHub에서 확인한 volatile checkpoint다. 다음 세션은 작업 전에
PR state, draft, mergeability, base/head, CI를 다시 확인한다.

| 단계 | active checkpoint | 상태·gate |
|---|---|---|
| P5.1/P5.2/P5.5 approved stack | PR #68 / `integration/p5.5-approved-stack` / `eb2d9a4f9eca9742296bfe0d5a2a8e980499f2e7` merge commit; candidate parent `b788c44db39fd57a5f483b3eb3340e1630ce87d5` | MERGED to master; Opus baseline `0660ad277` preserved; Production NOT APPLIED; Supabase/native physical-device state UNVERIFIED |
| P5.3 Chat Foundation | PR #59 / `codex/04a-chat-e2ee-foundation` / `ce4a1355b2738f898109c2d70b038822996f77e7` | implemented in active draft, not merged; **FROZEN / DEFERRED** by current V1 product direction; migration 041 remains unapplied per PR declaration; independent security review pending |
| P5.4 Chat Product UI | PR #60 / `codex/04b-chat-product-ui` / `c409d92d4fa6e5e4913adb8fef2cf6f1bdacba8a` | implemented in active draft, not merged; **FROZEN / DEFERRED** by current V1 product direction; no V1 entry-path integration; real Device Bootstrap runtime integration remains unverified |
| P5.5 Core Privacy Foundation integration | Historical `codex/core-privacy-foundation-v1` branch; its approved stack was superseded by #68 | Landed master contains the approved baseline and reviewed harness; Production unapplied and real-device validation unverified |

PR #54는 CLOSED이며 #58은 OPEN/DRAFT superseded provenance다. #59/#60은
FROZEN/DEFERRED draft asset이다. PR #68의 post-merge master validation
`32095000055`와 native release validation `32095000040`은 GREEN이지만, CI는
Production 적용이나 실기기 보안 증거를 대신하지 않는다.

### Control Tower canonical convergence checkpoint — 2026-08-18

아래는 P5.5 landing 이후의 live GitHub 상태다. #62–#67은 `0660ad277`에
통합된 이전 provenance stack의 superseded draft PR이며, 별도 landing 대상이 아니다.

| PR | scope | live branch / HEAD | live base | state |
|---|---|---|---|---|
| #54 | P5.1 daily-records E2EE | `codex/p5-daily-records-e2ee-slice` / `835cddd16b71686abc5fb296e4ddce3456844ad0` | master | CLOSED; superseded/integrated through approved baseline |
| #58 | Device Bootstrap | `codex/03a-device-bootstrap` / `ac81f07f5dc3220b1bc79490e693702add957a0b` | #54 branch | CLOSED; superseded/integrated provenance |
| #62 | device protection recovery UX | `codex/device-protection-recovery-v1` / `4cfbf7a39220c672e34f046a1265594c83b7978d` | #58 stack | CLOSED; superseded/integrated provenance |
| #63 | notification re-entry | `codex/notification-reentry-v1` / `84d19b49a5bff91b75b84217f2829d44c6ac942a` | #62 stack | CLOSED; superseded/integrated provenance |
| #64 | LV/core protection UX | `codex/lv-core-ux-v1` / `576342688b0e4b165b441f10ac68cbac71aecd7e` | #63 stack | CLOSED; superseded/integrated provenance |
| #65 | P6 readiness audit | `codex/p6-readiness-audit-v1` / `ff8aaca1404ff409f39be2cb2360f5f002e4b170` | #64 stack | CLOSED; superseded/integrated provenance; does not authorize P6 |
| #66 | security stack integration | `codex/sol-integration-audit-v1` / `062b2d8ad6e34ddcdc4de9fadf3460281433c888` | #65 stack | CLOSED; superseded/integrated provenance |
| #67 | security blocker fixes | `codex/opus-security-blockers-v1` / `0660ad277dec0a62be3b315cf3668fadf91c282b` | #66 stack | CLOSED; superseded/integrated as approved baseline |
| #68 | P5.5 landing | `integration/p5.5-approved-stack` / `b788c44db39fd57a5f483b3eb3340e1630ce87d5` | master | MERGED; resulting master `eb2d9a4f9eca9742296bfe0d5a2a8e980499f2e7` |

Convergence is complete for P5.5: **approved baseline `0660ad277` → reviewed
e2e-only harness `b788c44` → master merge `eb2d9a4`**. #54/#58/#62–#67 remain
historical provenance and must not be independently landed again.

### Phase 0 defect-closure checkpoint — 2026-08-21

Fable 전략(`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md`) §8 Phase 0의 결함 목록을 소진한
active branch가 존재한다. **master에는 아직 없다.**

| 항목 | 상태 |
|---|---|
| branch | `claude/phase0-defect-closure`, base는 `9b0d4b3`(= PR #74 head) |
| 검증 | `npm run verify` PASS (EXIT=0), 172 files / 2633 tests |
| S6 감정 편집기 이중화 | 해소. `RecordEmotionCorrection` 제거, 항목 제거 기능은 `RecordMoodSection`으로 이관 |
| `AttachmentMedia` | 삭제. 단, 그 suite가 `useMediaAttachment`의 유일한 커버리지였으므로 훅 테스트로 먼저 이관했다 |
| 마이 탭 동의 카드 | 재구성. PIPA §23 고지 항목은 전부 유지 |
| 기록 탭 §3.1 위반 | 해소. 파생 요약이 원본 아래로 이동 |
| 우리 달 간격 | `조용히 지나간 N개월`로 표시 |
| 영상·음성 업로드 | 정책 거부로 닫힘 |
| Lightbox 레이어링 | **결함 아님으로 판정.** `dialog.showModal()`이라 브라우저 top layer에 그려진다 |
| 빈 홈 화면 공백 | **미해결.** 위젯이 적어 생기는 구조적 희소함이며, 내용을 만들어 채우는 것은 2026-08-20에 되돌린 방향이다. 디자인 결정 대기 |

이 branch의 CI는 base `master` PR에서만 돈다. stacked base에서는 어떤 workflow도 trigger되지 않는다.

### Phase 1 checkpoint — 2026-08-21

| 항목 | 상태 |
|---|---|
| Gate 4 통화 모드 | `claude/phase1-call-mode-v2` / PR #78, **CI 14/14 green**. 전화 걸지 않음 · 통화 기록 0 · `다음`은 쓰기 없는 건너뛰기 |
| Gate 3 push 서버 | `claude/phase1-gate3-push`. migration 048 + `send-push`. 실제 PostgreSQL로 검증됨 |
| Gate 3 push 클라이언트 | 완료. 토큰 lifecycle은 이 저장소가 다른 클라이언트 동작을 검증하는 방식으로 검증 가능했고(§14.3이 negative test를 명시적으로 요구한다), 실기기가 필요한 것은 실제 전달뿐이다 |
| `briefings` drop | **미착수.** 파괴적 변경이라 migration-gate §4의 명시적 승인이 필요하다 |
| S4 §7.6 대기 구간 | **완료.** 자동 노출 없음(저장 시 비공개 강제) + 연결 직후 창(7일) 안에서 묻는 카드. **"한 번"을 저장하지 않는다** — `couple_members.joined_at`에서 창을 계산하므로 새 영속 사실이 없다. 창이 지나도 기록은 그대로 비공개이며 개별 전환 가능 |
| §19 계측·판독 | **완료.** 선언된 8종 전부에 emit 지점이 있고, 050이 커플 축과 집계 판독을 더했다. 현재 파이프로 LV 퍼널의 **주요 지표를 실제로 계산할 수 있다** — 커플 단위 지표 2개는 050 이전에는 계산 자체가 불가능했다. 여전히 없는 것: 3분 합류 실측 · 감정 확인율 · 위젯 사용률 |
| 연락 가능 시간 | **완료.** 온보딩에서 양 역할에게 묻고, 설정에서 양 역할이 편집한다. 끝이 시작보다 이른 창은 저장 전에 거부한다 — DB는 받아들이고 발송이 영영 매치하지 않아 설명 없이 알림이 끊긴다 |

Gate 3에서 승인된 계획 하나가 구현 중에 반증됐다: 전략이 지정한 `couple_members.has_unseen`은
001의 SELECT 정책 때문에 파트너에게 읽히고, 그것은 곧 읽음 표시(§14.3 절대 금지)다. 전용 테이블로
옮겼고 근거는 048 파일과 migration README가 소유한다.

### Branch consolidation checkpoint — 2026-08-20

Every remote branch was audited for work that was still valid and not yet on master,
and what qualified was landed in one pass. The audit and the per-branch decisions are in
[`CONSOLIDATION_LEDGER.md`](CONSOLIDATION_LEDGER.md); that file, not this one, is
authoritative for why a given branch was included or skipped.

What changed in master's product reality:

| 영역 | master 기준 현실 |
|---|---|
| PartnerDay missed-context surface | `PR #72` 계보(`609a891`)의 explicit state machine이 landing됨. `CONFIRMED`/`OUTSTANDING`/`KNOWN` 3집합, receipt 4-state(`missing`·`valid`·`corrupt`·`unavailable`), corrupt는 date bound 없이 recovery, `unavailable` read는 절대 write-back하지 않음, `CONFIRMED` writer는 acknowledgement 단 하나 |
| 이야기거리 overflow | `PR #71` 계보. 여섯 번째 이후 항목이 도달 불가였던 dead end가 닫힘. 별도 탭 없이 홈 위젯의 notice 자체가 control이 됨 (§8 유지) |
| 기록 작성 진입점 | §7.1 contract가 테스트로 고정됨. 군화·곰신 both roles의 authoring 경로와, 홈을 어떻게 구성하든 진입점이 남는다는 것을 회귀로 잠금 |
| control-tower Obsidian vault | `PR #70` 계보에서 회수. production code는 회수하지 않음 — 그 계보의 PartnerDay는 `609a891`보다 오래된 구현이다 |

Branch가 아직 삭제되지 않았다는 사실은 그 branch가 landing 대상이라는 뜻이 아니다.
Consolidation 이후에도 모든 remote branch는 history 보존을 위해 그대로 남아 있다.

여전히 변하지 않은 것: Production은 NOT APPLIED, remote Supabase catalog는 UNVERIFIED,
실기기 검증은 UNVERIFIED, chat은 FROZEN / DEFERRED, P6는 NOT AUTHORIZED.

### 전수 저장소 감사 checkpoint — 2026-08-21 (최종)

앞선 저자 감사 이후, **최종 릴리스 트리 전체**를 대상으로 독립 리뷰어 6개를 병렬로 돌린
감사. 상세는 `WORK_LOG.md` 같은 날 마지막 항목.

| 항목 | 결과 |
|---|---|
| 감사 대상 | `release/phase1-gate3-clean-history` (PR #80), tree `8dade09` = #79 최종 tree |
| CRITICAL | 2건 — 035의 recovery 오버로드 부활, iOS APNs 토큰 브리지 부재. **둘 다 수정** |
| HIGH | 3건 — `couple_id` 위조, CI가 DB harness 미실행, 오프라인 큐 미전송. **전부 수정** |
| MEDIUM/LOW | 4건 수정. 나머지는 범위 밖으로 인계 문서에 기록 |
| 새 migration | **051, 052, 053** (전부 운영 미적용) |
| 검증 | verify EXIT=0 / 2829 tests · 51 migrations / 234 assertions · p5 93 · write-floor 39 · rollback PASS · 취약점 0 |
| 회귀 테스트를 못 만든 것 | **1건** — 오프라인 큐 flush. → **2026-08-21 4차 감사에서 닫혔다**(아래) |

**#80은 아직 병합되지 않았다.** 기본 브랜치 tip은 `f73ebfe`이며 병합은 user 전용 게이트다.

### 4차 전수 감사 checkpoint — 2026-08-21

같은 트리(PR #80)를 다시, 이전 보고를 사실로 믿지 않고 감사했다. live 재확인 후 실제
PostgreSQL 17.10에 전체 체인을 적용하고 RLS 실행 주체로 함수를 구동했다. 상세와 원장은
`WORK_LOG.md` 같은 날 마지막 항목이 소유한다.

| 항목 | 결과 |
|---|---|
| HIGH | 1건 — **`daily_records.shared_at`이 클라이언트 위조 가능**했고, 그것으로 053의 취소를 무력화해 행위 없는 알림을 남길 수 있었다. → `054` |
| MEDIUM | 2건 — 파트너 기록이 quarantine된 상태에서 초대를 내려 053의 경계를 영구히 밀어버림(`store.tsx`); §19 계측 배선 게이트가 주석 처리된 호출을 호출로 셈(`productEvents.test.ts`) |
| LOW | 1건 — `App.entitlements`에 `aps-environment` 항목이 둘이고 하나가 Gate 3 이전의 거짓 진술 |
| 새 migration | **054**, 그리고 후속으로 **055** (둘 다 운영 미적용) |
| 닫힌 미검증 | **오프라인 큐 flush** — outbox fixture를 만들어 배달 시도를 관측한다. mutation 4건 전부 잡힘 |
| 행위로 재확인 | 051 §1·§2·§5, `disconnect_couple` 전체 효과와 인가, 텔레메트리 판독 권한, 카탈로그 전수 |
| 검증 | verify EXIT=0 / **188 files · 2837 tests** · **52 migrations / 243 assertions** · p5 93 · write-floor 39 · rollback PASS · edge PASS·3/3 · 취약점 0 |
| mutation | **11건** 전부 실패 확인 |
| 고치지 않은 것 | (없음 — 아래 2026-08-21 후속 참조) |

**#80은 여전히 병합되지 않았다. 병합은 user 전용 게이트다.**

### 2026-08-21 후속 — 위 감사가 남긴 두 항목을 실제로 닫았다

위 표의 "고치지 않은 것"과, 054가 스스로 실행하지 못하던 repair를 각각 재현하고 고쳤다.
Fable 전략 감사가 지적한 `우리` 날짜 셀 결함도 코드로 재현해 함께 닫았다.

| 항목 | BEFORE (측정값) | 수정 | mutation |
|---|---|---|---|
| **054 repair가 무효였다** | 001→053 적용 후 소유자가 RLS로 `shared_at`을 위조하고 054를 적용해도 **두 행 모두 2126년 그대로**. 트리거를 먼저 설치한 탓에 repair UPDATE가 무전이 분기(`NEW.shared_at := OLD.shared_at`)로 들어가 자기가 지우려던 값을 되돌려놓았다 | 054 직접 수정(어디에도 미적용). repair를 트리거가 붙지 않은 구간에서 실행 | 원본 순서로 되돌리면 3개 assertion FAIL |
| **push 배달-표시 레이스 — 누락이 아니라 소실이었다** | 후보 선정(23:48:00.566) → R2 공유(23:48:00.588) → mark(23:48:00.610) 후 **`has_unseen = f`, `partner_has_pending_act = f`.** R2는 지연이 아니라 **영구 소실** — 플래그가 내려가 다시 선정되지 않고 스탬프가 경계 뒤라 영원히 세어지지 않는다 | `055`. 경계를 **발송 결정 시각**으로 긋고(`push_delivery_candidates`가 `decided_at` 반환), `has_unseen`은 053의 `partner_has_pending_act()`로 **재계산**. `p_decided_at`에 DEFAULT 없음 | 재계산 제거 → 3 FAIL / 경계 `GREATEST` 제거 → 2 FAIL / **스탬프 `GREATEST` 제거 → 3 FAIL** |
| **`우리` 날짜 셀이 항상 오늘을 열었다** | `UsPage`는 `/record?date=…`로 이동하는데 `RecordPage`가 `date`를 **어디서도 읽지 않았다**(읽는 것은 `trip`·`from`·`to`·`compose`·`record` 5개). §4.2/§10 "정확한 날짜, 근사치 금지" 위반 | `RecordPage`가 `?date=`를 읽는다. `isCalendarDate`로 검증(trip 범위와 같은 규칙), trip period가 여전히 우선 | 검증 가드 제거 → 1 FAIL |

**하지 않은 것 — canonical과 충돌하는 Fable 제안.** Fable 감사 §4 결함 2는 "이야기거리 0개일
때도 통화 모드 고정 진입점을 두라"고 제안한다. `PRODUCT_V3.md` 통화 모드 절은
**"남은 항목이 0이면 진입점을 숨긴다"**고 명시한다. canonical이 이긴다 — 구현하지 않았다.

| 항목 | 결과 |
|---|---|
| 검증 | verify EXIT=0 / **189 files · 2847 tests** · **53 migrations / 272 assertions**(+ 업그레이드 경로 전용 DB) · p5 93 · write-floor 39 · rollback PASS · edge PASS·3/3 · 취약점 0 |
| mutation | **7건** 전부 실패 확인 (054 원래 순서 3 · 055 재계산 제거 3 · 055 `GREATEST` 제거 2 · `?date=` 가드 제거 1) |
| 남은 것 | 054 재리뷰 + 055 독립 리뷰. 실제 전달은 여전히 외부 게이트(자격증명·기기) |

### 저자 감사 checkpoint — 2026-08-21

Codex 독립 감사 직전에 **결합 트리**(#74→#79)를 대상으로 저자 측 전수 감사를 했다.
결합은 `audit/combined-scratch` 브랜치(`d5471f3`)에서 PR 병합 없이 cherry-pick으로 구성했다.

| 항목 | 결과 |
|---|---|
| **001→047→048→049→050 결합 체인** | **PASS** — 48개 migration, 205 assertions. 이 조합은 그전까지 한 번도 실행되지 않았다 |
| 발견·수정한 결함 | 10건. 상세는 `WORK_LOG.md` 2026-08-21 감사 항목 |
| 그중 숫자를 틀리게 만든 것 | 1건 — §19 kill metric이 권한 거부를 opt-out으로 셌다 |
| unhandled rejection / Errors | **0건** |
| 결합 전용 산출물 | harness의 047 ORDER + 8개 assertion, 원장 047 행, #75 낡은 주장 정정 — **landing 후 적용** |

### LV 진입 조건 대비 현황 — 2026-08-21

`ENGINEERING_ROADMAP` §LV의 조건별로, **active branch 기준**이다. master는 아직 `21e7dfb`다.

| LV 조건 | 상태 |
|---|---|
| 계정·커플 연결·세션 복구 | 기존 스택 유지. 이 세션에서 약화시킨 것 없음 |
| 기록 → 상대방의 오늘 → 원본 → 대화 준비 | 루프의 **첫 화살표(push)와 마지막 화살표(통화 모드)**가 코드로 존재한다. 실제 전달만 외부 게이트 |
| 검증 범위의 프라이버시·보안 보호 | §7.6 자동 노출, 읽음 표시가 될 뻔한 컬럼 위치, 기기 이양 누출 — 셋 다 닫힘 |
| 알려진 critical authorization/privacy blocker 없음 | 이 세션에서 발견한 것은 전부 닫았다. **independent review는 아직 없다** |
| §19 허용 목록 계측 착지 | 코드로는 착지한다. **실제 이벤트가 쌓이는지는 LV 환경이 있어야 확인된다** |
| 검증 빌드의 보안 표현이 §14.5 LV 행과 일치 | **미확인.** 온보딩·설정의 문장을 §14.5 LV 행과 대조한 적이 없다 |
| 외부 사용자 범위·고지·rollback·데이터 처리 | **미착수.** LV 환경(전용 Supabase 프로젝트)이 없다 |
### Two-lineage convergence checkpoint — 2026-08-21

`claude/v1-launch-readiness`(PR #73)와 `release/v1-gate1-gate2`(PR #74)는 같은 작업의
재작성 중복 계보였다(차이는 047 cycle-pain delta 하나). 사용자 승인
([`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md`](PRODUCT_STRATEGY_REDESIGN_2026-08-21.md))에
따라 다음으로 수렴한다.

| 계보 | 처분 |
|---|---|
| PR #74 `release/v1-gate1-gate2` @ `9b0d4b3` | **landing 계보.** 역할별 홈·우리 하루 격자·감정 provenance·시각 기반·온보딩 첫 화면 + CI 수리(stale e2e locator 2건, 문서 trailing whitespace). CI 14/14 GREEN. **master merge는 사용자 실행 대기** — `.claude/hooks`가 PR merge를 사용자에게 예약한다 |
| PR #73 `claude/v1-launch-readiness` | superseded. #74 merge 후 닫는다. **HEAD가 더 최신이라는 것은 계보 선택의 근거가 아니다** (#70 vs #72와 같은 규칙) |
| 047 care-signal delta | `claude/047-cycle-pain-gated`(PR #76, ready)로 분리. independent review가 3단계 통증 어휘를 `CHANGES_REQUIRED`로 반려 → `d0e2c0a`에서 승인된 `feeling_unwell` 한 종류로 축소, phase0 fresh-chain(001→047)을 실제 PostgreSQL로 양측(구현자·재심사자) 검증 → **delta re-review `APPROVED WITH NOTES`**. merge 순서는 #74 이후. N1에 따라 반려 어휘를 담은 PR #73은 CLOSED |
| canonical 개정 (2026-08-21 승인분) | `claude/canon-amendments-2026-08-21`에 반영: PRODUCT_V3 §5.2·§6.1·§7.6·§8 통화 모드·§10 하루 격자·§14.3 알림 정책·§14.5 E2EE 표현 계약, ENGINEERING_ROADMAP ARCH-P6 개정·LV 계측 조건, BUSINESS §9.2 전역 가설 |

이 checkpoint 이후에도 변하지 않은 것: Production NOT APPLIED, remote catalog UNVERIFIED,
실기기 UNVERIFIED, chat FROZEN / DEFERRED, P6 NOT AUTHORIZED(개정된 ARCH-P6 기준으로도
구현 미착수), push 알림 미구현, §19 계측 미구현.

> **2026-08-21 정정.** 위 문단은 원래 "push 알림 미구현, §19 계측 미구현"으로 끝났다.
> 그 문장은 이 checkpoint가 작성된 시점에는 참이었고 **결합 트리에서는 거짓이다** —
> 둘 다 PR #79에서 구현됐다(migration 048~050). landing 순서상 이 checkpoint(#75)가
> 먼저 오고 구현(#79)이 나중에 오므로, 두 계보가 합쳐지는 지점에서 이 문장이 낡는다.
> 저자 감사에서 발견해 정정했다.

## 2. Active migration ledger facts

| migration | scope | production state for this docs task |
|---|---|---|
| 039 | daily_records P5 | NOT APPLIED per active PR declaration; remote catalog independently UNVERIFIED |
| 040 | Device Bootstrap/write-floor semantics | active branch only; remote catalog independently UNVERIFIED |
| 041 | chat messages | absent from master; frozen/deferred active-draft asset; NOT APPLIED per PR #59/#60 declarations; remote catalog independently UNVERIFIED |
| 042 | media coordination | absent from master; frozen/deferred P6 draft number; implementation not started. It must be reissued as 045+ before P6 resumes because active V1 now has 043/044 |
| 043 | Conversation Bridge completion | present in landed master tree; remote catalog independently UNVERIFIED |
| 044 | unlink crypto pairing authority | present in landed master tree; remote catalog independently UNVERIFIED |
| 045 | E2EE write-floor activation hardening | present in landed master tree; Production NOT APPLIED; remote catalog independently UNVERIFIED |
| 046 | device provisioning actor requirement | present in landed master tree; Production NOT APPLIED; remote catalog independently UNVERIFIED |
| 047 | care signal `feeling_unwell` | **PR #76이 소유하며 master에도 이 branch에도 없다.** Production NOT APPLIED |
| 048 | push delivery metadata (Gate 3) | active branch only. fresh chain 001→048에서 실제 PostgreSQL 17.10으로 37개 계약 검증, mutation 6건 확인. Production NOT APPLIED; 047과 결합한 체인은 **아직 한 번도 실행되지 않았다** |
| 049 | §19 최소 계측 (LV 진입 조건) | active branch only. **timestamp 컬럼이 없다** — 날짜 버킷만. 파트너 read 정책 없음, UPDATE/DELETE 정책 없음. fresh chain 001→049에서 19개 계약 검증, mutation 4건 확인. Production NOT APPLIED |
| 050 | LV 판독 (couple 축 + 집계 함수) | active branch only. `couple_id`는 세션에서 파생되고 파트너 read는 여전히 없다. 판독은 `(metric, value)` 집계만 반환하며 행 반환 경로가 없다. fresh chain 001→050에서 16개 계약 검증, mutation 5건 확인. Production NOT APPLIED |

| 051 | audit closure (recovery 오버로드 제거 · `couple_id` 위조 차단 · 회수/공유 전환 플래그 · NULL 판독 범위) | active branch only. Production NOT APPLIED |
| 052 | 공유 기록 삭제·계정 탈퇴 시 플래그 하강 | active branch only. Production NOT APPLIED |
| 053 | 알림 플래그가 "pending act"를 뜻하게 함 (`notified_through` + `shared_at`) | active branch only. Production NOT APPLIED |
| 054 | `shared_at`을 서버 전용 상태로 만든다 — 053이 남긴 클라이언트 쓰기 경로를 닫는다 | active branch only. fresh chain 001→055(53개)에서 272 assertions, mutation 4건 확인. **2026-08-21 정정: repair 문장이 무효였고 파일을 직접 고쳤다**(미적용 파일). Production NOT APPLIED |
| 055 | 알림 경계(`notified_through`)를 **발송 결정 시각**으로 긋는다 — 결정과 표시 사이에 공유된 행위가 소실되던 레이스를 닫는다. **2026-08-22 보강:** `last_notified_at`도 같은 단조 보장을 받는다 — 경계만 `GREATEST`였고 스탬프는 flat이라, 늦게 도착한 **더 이른** mark가 스탬프를 뒤로 끌어 이미 쓴 하루 상한을 다시 열었다(같은 날 알림 2건). 경계 assertion은 전부 통과하는 채로 그 옆에서 벌어졌다 | active branch only. fresh chain 001→055에서 055가 32 assertions(A·B·C·D·E·G·H 전 시나리오 + 영구 negative proof + 카탈로그 계약 전수 비교), mutation 5건 확인. Production NOT APPLIED |

No remote Supabase mutation was performed by this documentation task.

## 3. Default-branch product/security reality

master에는 approved P5.5 security stack과 reviewed browser harness가 landing되었다.
그러나 이것은 Production/Supabase 적용이나 실기기 검증 완료를 의미하지 않는다.
P5.3/P5.4 chat stack은 여전히 FROZEN / DEFERRED다.

| 기대 | master 기준 현재 현실 | 분류 |
|---|---|---|
| 사용자 콘텐츠 E2EE | approved P5.5 stack이 master에 landing되었으나 Production/Supabase 적용과 전체 콘텐츠 범위는 별도 gate | `FUTURE` `PROD` |
| 기기·복구 UX | approved Device Bootstrap stack이 master에 landing되었으나 실제 기기 gate는 UNVERIFIED | `FUTURE` `PROD` |
| 자체 채팅 | master에는 not merged; PR #59 foundation과 PR #60 product UI가 active draft에 존재하나 현재 V1은 **FROZEN / DEFERRED** | `FUTURE` |
| 주기 projection | 서버 평문 건강 데이터 계산 경계는 재설계 필요 | `SEC` `PROD` |
| 정밀 위치 | 여행 항목에 정밀 위경도 평문 경로가 남아 있음 | `SEC` `BETA` |
| 평문 영상 | **신규 업로드 경로는 닫혔다** — `classifyMediaFile`이 영상·음성을 정책으로 거부하고 컴포저에서 캡처 칩이 제거됐다(§12.4 선택지 C, 2026-08-21). 이미 저장된 첨부는 계속 재생된다. 쓰기만 막았고 읽기는 그대로이므로 기존 평문 데이터 자체의 해소는 여전히 P6 과제다. 이 변경은 아직 active branch에만 있다 | `PRODUCT` `BETA` |
| 레거시 건강 평문 | 레거시 주기 테이블·백업 데이터가 남아 있음 | `LEGACY` |
| `briefings` 레거시 스키마 | 평문 요약 캐시 테이블이 스키마에 남아 있다. `master`의 `src/**`에 read/write 경로가 없어 **동작하는 평문 요약 파이프라인은 아니다**. 삭제하는 migration도 없어 스키마 정리 대상으로 남는다 | `LEGACY` |
| 연결 해제와 pairing 상태 | master에는 `disconnect_couple`이 `couple_members`만 갱신하는 상태다. integration branch의 044가 pairing도 `UNLINKED`로 전이하며 local tombstone을 함께 처리한다. 아직 merge·원격 적용 전이다 | `FUTURE` `PROD` |

## 4. 핵심 루프와 범위 밖 기능

P0–P4의 핵심 루프 작업은 default branch에 merge된 기록과 코드에서 확인한다.
P5.3/P5.4 chat stack은 active draft 자산으로 보존하지만 V1 제품 진입 경로에서 동결한다.

| 기능 | 현재 상태 |
|---|---|
| `상대방의 오늘` → 정확한 원본 → Conversation Bridge | P0–P3은 merge된 범위. 이야기거리 보관함·완료 처리 P4는 integration branch에 있으나 master에는 아직 merge되지 않음 |
| 알림 | **코드는 양쪽 다 있다.** 서버: migration 048(전용 `push_delivery_state` 테이블 · 비공개 기록은 아무것도 올리지 않음 · 하루 1회와 연락 가능 시간을 DB가 강제 · 기기 이양 시 토큰 회수)과 `send-push` Edge Function. 클라이언트: `@capacitor/push-notifications` 통합 · 커플 연결 시 권한 요청과 토큰 등록 · 로그아웃 시 회수 · 탭 착지는 홈 고정. 전부 active branch에 있고 검증됐다. **남은 것은 외부 게이트와 운영 조건 하나다** — APNs/FCM 자격증명, `aps-environment` entitlement(Apple portal capability와 함께 추가해야 함), 실기기 2대, 그리고 **`send-push` 스케줄러의 single-flight 보장.** 마지막 항목은 자격증명이 아니라 배포 설정이다: 하루 1회 상한은 후보 선정 시점에 판정되고 `mark_push_delivered()`에서야 닫히므로, 두 스케줄러가 겹쳐 돌면 같은 수신자를 각자 고르고 같은 날 알림 2건이 나간다. **데이터베이스는 이것을 막지 않는다** — 행 잠금도 advisory lock도 없다. LV 범위에서는 운영 조건으로만 수용하며, 통과 조건과 증거 요건은 `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` §6-1이 소유한다. 보장할 수 없으면 LV는 HOLD다. 이 기기에서는 Xcode 부재로 `pod install`도 완료할 수 없다 |
| `외박` / `외출` 일정 종류 | 미구현. `기타`로 표현됨 |
| Moment / 월간 히스토리 | 미구현 |
| 수익화 / 구독 | 코드 없음. 방향은 [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) |
| 여행 플래너·공동 할 일 | 동결. 새 투자 없음. 위치 privacy gate는 별도 충족 필요 |
| 사진 업로드 실패 뒤의 재시도 | **재시도가 원래 기록이 아니라 새 기록을 만든다.** 사진 일부가 실패하면 글은 저장되고 실패한 파일만 컴포저에 남는다(D-05). 그 상태에서 `남기기` 를 다시 누르면 `addRecordWithMedia` 가 **새 기록**을 만들므로, 글만 있는 기록과 사진만 있는 기록이 하루에 둘 남는다. 데이터 손실은 아니고(파일이 사라지던 것이 D-05 수정으로 없어졌다) **master 에도 같은 모양으로 있던 선행 결함**이다 -- 옛 컴포저의 `clearComposer()` 도 글을 비운 뒤 실패 파일만 남겼다. 제대로 고치려면 `uploadRecordMedia(file, coupleId, recordId)` 로 **이미 만들어진 기록에 붙이고** 그 행의 `attachments` 를 갱신해야 한다. 2026-08-23 gpt-5.6-sol 검토에서 지적됨 |
| 감정 · 기계 추론 노출 | **§13이 2026-08-23에 개정됐다.** V4 컴포저는 기계가 읽은 감정을 여섯 칸에 미리 눌린 채로 두고, 기록의 공개 범위 기본값은 `우리에게 공유`다. 그래서 감정 칸을 건드리지 않은 사용자의 추론이 파트너에게 간다 -- 개정 전 규칙이 금지하던 일이다. 확인받은 제품 결정이며 `PRODUCT_V3.md` §13.1이 무엇이 남는지(보장 넷) 소유한다. 되돌릴 자리는 하나다: 컴포저가 읽은 것을 미리 누르지 않는 것 |
| 일기장 하단 탭 및 다꾸 상점 (`DiaryPage` · `ShopPage`) | **active worktree에서 2026-08-23 개편됨.** 하단 탭바 3번째 칸이 `/compose`('기록 남기기')에서 여태 남긴 기록을 월별로 모아 읽고 꾸미는 `/diary`('일기장')으로 전환됨. `/shop` 카탈로그 최소 화면이 존재하여 스티커·다꾸 테마·책 만들기 미리보기를 제공하나, 실제 결제·주문·유료 entitlement 및 Supabase 스키마는 미구현이며 `P-MP` 게이트 대기 상태임(정직한 준비 중 안내 유지, 기본 12종 스티커 무료 보존). 프로필 화면의 '오늘 내 상태'/'일기장' 버튼은 제거되었고 곰신 '오늘 내 상태'는 '찾기' 메인에 배치됨. '출혈량' UI는 제거되었으나 기존 flow 데이터/DB 스키마는 보존됨. 3대 기록 작성 진입점(홈 레일 +, 우리 헤더 펜, 찾기 헤더 펜)은 `/compose`로 유지됨. master/Production에 적용된 사실이 아님 |
| 위젯 홈 · 통화 브리핑 · 상대 감정 위젯 | **V4에서 홈이 피드가 되면서 걷혔다 (2026-08-23, 의도된 제품 결정).** `RoleHome`·`CallBriefingWidget`(`여기까지 확인` 포함)·`PartnerEmotionWidgets`·`PartnerDayTimelineWidget`·`CareHintWidget`·`AddWidgetBottomSheet`와 `lib/widgets.tsx` 레지스트리는 저장소에 남아 있으나 **어느 라우트에서도 마운트되지 않는다.** V4는 두 역할에게 같은 홈을 주고 역할차를 "먼저 누르는 링"으로 푼다(`HomePage.tsx`, PRODUCT §5.2). 되돌리려면 컴포넌트는 그대로 있으므로 자리만 정하면 된다. 통화 목차와 통화 모드 자체는 `/saved`·`/call`이 계속 소유한다 |

## 5. Phase 0 production baseline

028–030에 대해서는 기존 독립 기록 두 개가 모두 운영 미적용을 가리킨다. 다만 이
문서 작업에서는 원격 Supabase를 다시 조회하지 않았으므로 live catalog는
`UNVERIFIED`다.

| migration | repository ledger / prior read-only evidence |
|---|---|
| 025–027 | 2026-08-11 운영 적용됨으로 기록됨 |
| 028–030 | 신규 / 운영 미적용으로 기록됨 |
| 031–034 | 신규 / 어디에도 미적용으로 기록됨 |

Beta gate B1 전에는 Storage policy catalog와 실제 signed-URL 동작을 모두 다시
검증해야 한다. migration 파일 존재는 production 적용 증거가 아니다.

## 6. 확인된 좋은 설계 — 되돌리지 말 것

| 항목 | 왜 유지하는가 |
|---|---|
| 배려 신호가 주기 데이터에서 파생되지 않는다 | 사용자가 당일 직접 고르는 독립 opt-in 신호이며 HRK 경계를 단순하게 유지한다 |
| 아무것도 공유하지 않으면 파트너 주기 카드가 렌더되지 않는다 | 공유 거절 사실 자체를 추론할 수 없게 한다 |
| 파트너 projection 타입에 증상·통증·메모 필드가 없다 | 건강 원본이 실수로 전달되는 경로를 타입 수준에서 줄인다 |
| 요약이 캐시되지 않고 매번 재계산된다 | stale 상태가 구조적으로 존재하지 않는다 |
| 원본 이동 대상이 없으면 대체하지 않는다 | 잘못된 기록으로 조용히 이동하지 않는다 |
| 외부 AI·분석·크래시 SDK가 없다 | 계측 도입 시 프라이버시 경계를 처음부터 설계할 수 있다 |
| 사진 업로드 시 EXIF/GPS 제거 실패 시 원본 업로드 거부 | 정밀 위치 메타데이터의 조용한 유출을 막는다 |

## 7. 이 문서의 유지

- 항목이 해소되면 삭제한다. 완료 이력을 여기에 쌓지 않는다.
- 제품 의도는 최신 사용자 승인 V4 방향과 `V4_AS_BUILT.md`/`V4_BACKLOG.md`에 쓴다.
  `PRODUCT_V3.md`는 legacy 역사 기록이다. 구현 순서는 `ENGINEERING_ROADMAP.md`에 쓴다.
- remote 상태 주장은 날짜·증거 출처와 함께 적고, 확인할 수 없으면 `UNVERIFIED`다.
- active PR/HEAD/CI는 checkpoint일 뿐이며 다음 세션에서 live 재검증한다.

## 8. 2026-08-24 local implementation checkpoint

This section describes the current local checkout only. It is not a claim about
`origin/master`, Production, or the remote Supabase catalog.

- Branch: `codex/service-rank-profile-settings-impl`, based on `7f4886b`.
- Find tab: the existing date-derived service card now shows the personal rank rail
  `이등병 → 일병 → 상병 → 병장`, next-rank percentage/days, and refreshes at local
  midnight or when the page regains focus. It does not compare partners or score the
  relationship.
- My tab: the single profile surface has direct `프로필 편집` and `하이라이트 설정`
  entry points. The persistent camera badge was removed; the existing avatar storage
  is still device-local. Highlight rows still edit their existing source anniversary,
  schedule, or service data; independent highlight creation/name/cover data does not
  exist yet.
- Profile identity: the existing owner-managed English username remains separate from
  the nickname and is reachable through the direct profile modal. Partner-phone-only
  mutation of the global username is intentionally not implemented because the current
  auth/RLS model cannot prove a physical phone and does not authorize one user to update
  another user's profile row.
- Verification for this local checkpoint: `npm run verify` PASS; focused keyboard/profile
  tests PASS; local rendered `/search`, `/us`, and `/settings?profile=edit` paths PASS.
- 2차 refinement: before-enlistment users now see `대기 · 입대 대기` with a locked rank rail;
  serving users receive current-tier EXP percentage/days, and the profile no longer shows a
  persistent camera badge or a redundant header search entry. The latest local verify is
  `226` Vitest files / `3247` tests PASS.
- Remote boundary: no migration, Supabase mutation, commit, push, merge, or deployment was
  performed. Live remote check at this checkpoint: `origin/master` is `7f4886b`, PR #88 is
  OPEN/CONFLICTING with head `a7c2d5c`, and Production `/us` returned HTTP 200 for its
  existing deployment. The branch changes are therefore not in Production.

## 9. 2026-08-24 refinement checkpoint — supersedes section 8 for this working tree

This section is the current local checkout truth. It does not claim that the
uncommitted work is present on `origin/master`, Production, or the remote
Supabase project.

- Working tree: branch `codex/service-rank-profile-settings-impl`; repository HEAD
  remains `7f4886bcbe32034bfabb454c85378532b14cb261` and the implementation is
  uncommitted.
- Find tab: `/search` shows date-derived enlistment/discharge dates, D-day,
  service percentage, and a personal `이등병 → 일병 → 상병 → 병장` progression
  rail. The percentage is for service progress only, never a relationship score.
  Pre-enlistment state is shown as `입대 대기` with a locked rail; serving state
  refreshes on local midnight/focus.
- My tab: `/us` now has one shared couple profile surface with an Instagram-like
  header, English `@username`, separate nickname/caption, three counts, one
  profile edit entry, a custom highlight rail, and `격자`/`사진`/`여행` views.
  The persistent camera UI and the old status/diary controls are absent from
  this surface. Avatar selection is still intentionally device-local and says so
  to the user; cross-device avatar sync is not implemented.
- Highlights: `couple_highlights` plus ordered items provide independent shared
  highlight title, selected shared photos, cover-by-first-item, edit, delete, and
  story-viewer routes. Private records are excluded in both client filters and
  the database child-row policy/trigger path.
- Shared profile views: grid/photo/travel content is derived from the couple's
  shared records/trips, not a single owner's private records. Realtime/profile
  invalidation refreshes profile and highlights additively.
- Partner username: the local UI removes owner-side username editing and offers
  a connected-user field to set the active partner's English username. Migration
  `059_partner_managed_username.sql` enforces this through a locked active-couple
  SECURITY DEFINER RPC, collision validation, deletion gating, and an owner-update
  trigger. A server session can prove the active partner relationship; it cannot
  prove a physical phone, so that phrase is not enforced beyond the authenticated
  partner session.
- Database boundary: migration 058's highlight object is now confirmed by the
  user's SQL Editor query (`has_highlights = true`). A later targeted PostgREST
  probe resolved both `profiles.username`/`profile_caption`, the highlight table,
  and `set_partner_username(text)`, returning `401/42501` for anon access. This
  confirms the requested 057–059 objects are present and protected remotely;
  the full migration ledger remains unverified. A full remote schema dump was
  `BLOCKED` because Docker Desktop is unavailable.
- Verification: latest `npm run verify` passed with typecheck, lint, 230 Vitest
  files / 3275 tests, and build. Local rendered `/search`, `/us`,
  `/settings?profile=edit`, highlight creation dialog, and photo tab were
  inspected with no browser console errors observed. Phase 0 was previously
  passed at 57 migrations / 328 assertions; the final phase0 rerun also passed.

### 10. 2026-08-24 remote migration order diagnosis

The Supabase SQL editor rejected `059_partner_managed_username.sql` with
`42703: column "username" of relation "profiles" does not exist`. This is an
ordering/dependency error: migration 057 creates `profiles.username`,
`profile_caption`, and `profile_date_type`; migration 059 only creates the
partner-managed trigger/RPC and assumes those columns already exist.

- A post-error REST probe still returns `400 42703` for `profiles.profile_caption`.
- The anonymous negative probe for `set_partner_username` returns `404 PGRST202`.
- The user confirmed `has_highlights = true` in the SQL Editor, so 058's object is
  present remotely. The exact migration ledger remains separately unverified.
- No automatic retry or remote mutation was performed by this diagnosis.

### 11. 2026-08-24 remote migration readiness recheck

- The user reported that Supabase application was completed.
- Targeted PostgREST probes resolved `profiles.username`, `profile_caption`,
  `couple_highlights`, and `set_partner_username(text)` and returned `401/42501`
  for anonymous access, confirming the requested objects and their deny boundary.
- The full remote migration ledger was not dumped; Docker-based inspection remains
  `BLOCKED`. The user's SQL Editor is the source for the applied-migration action;
  this agent performed no remote mutation.

## 12. 2026-08-24 PR #89 release candidate status

This is the current release-candidate truth. It does not claim that an open PR is
present in `origin/master` or Production.

- Branch: `codex/service-rank-profile-settings-impl`.
- Production deployment source: `a33499e179a163f87d0efae94ca3262f445fc00b` (`docs: record PR release gate status`).
- The later PR commits are documentation-only release bookkeeping; they do not change the
  deployed runtime bundle.
- PR: [#89](https://github.com/yesung23/gomsin-log/pull/89), OPEN, non-draft, mergeable; not merged.
- Remote CI: PASS at the exact HEAD, including the real-browser creator/partner matrix,
  typecheck/lint/Vitest/build, PostgreSQL security contracts, Deno, Android, iOS,
  Capacitor, audit, boundary, and secret scans.
- Vercel: the PR preview was promoted through the authenticated dashboard. Production
  deployment `8RZXxyM31uykxXwMAxDKzZofVycz` is `Ready`, aliases
  `gomsin-log.vercel.app`, and cites exact source commit `a33499e`.
- Production URL: `https://gomsin-log.vercel.app/us?release=a33499e` returned HTTP 200
  with a fresh cache miss. The authenticated production browser rendered `/us`,
  `/search`, and `/settings?profile=edit`, including the new profile and service surfaces.
- Supabase: the user reported SQL Editor completion. Targeted anonymous probes resolve
  `profiles.username`, `profiles.profile_caption`, `couple_highlights`, and
  `set_partner_username(text)` and return `401/42501`; the full migration ledger remains
  `UNVERIFIED`, and this agent performed no remote SQL mutation.
- Local verification: `npm run verify`, `npm run test:phase0`, and `git diff --check`
  are PASS. Local `npm run test:e2e` is BLOCKED because Playwright Chromium is absent;
  the remote real-browser matrix is PASS.
- Remaining release risks: PR merge, two-account/two-device realtime parity, and
  cross-device avatar synchronization remain unverified. The two stale untracked
  control-tower reports are preserved and are not part of the PR.

## 13. 2026-08-24 username / post / story-highlight refinement

This is the current release truth for the latest working tree. Repository code is
in `origin/master`; remote Supabase application and authenticated production
parity remain separate gates.

- Branch: `codex/service-rank-profile-settings-impl`; release HEAD is
  `b2ca94f2e185c694a3d930bde06f8432e1f66c01`, present in `origin/master` and
  feature ref. PR #89 is merged.
- Partner username: `/settings` and the profile edit modal now expose the active
  partner username field. A successful save updates the current couple projection;
  the server RPC still derives the target from the active couple and does not widen
  direct `profiles` RLS. The current web auth model proves the partner account/session,
  not a physical-phone identity.
- Username reload projection: local sync calls the additive
  `get_partner_profile_with_username()` RPC and falls back only on missing-RPC
  `PGRST202`. Migration `060_partner_username_projection.sql` is present locally,
  but this agent did not apply it remotely; remote application is **UNVERIFIED**.
- My tab: the profile grid now contains every couple-shared record with a photo, not
  only records inside a travel period. The photo tab and travel tab retain their
  separate meanings. The obsolete travel-only classifier was removed from runtime.
- Highlights: highlight data remains separate from the grid. The editor can select
  grid photos, and a shared photo story can open the same editor with its exact record
  preselected. Private records remain excluded. The existing record-level model means
  a multi-photo record is selected as one item and uses its first photo as cover.
- Verification: focused path tests **PASS** (7 files / 171 tests); the first full
  E2E run was 97/99 because two layout cases timed out, their isolated retry was
  2/2, and the second full E2E run was **99/99 PASS**. `npm run verify` is
  **PASS** (231 Vitest files / 3279 tests plus typecheck, lint, build). Phase 0 is
  **PASS** with 58 migrations and 333 actor/security assertions after the 060 probes.
- Sol Max: three explicit `kiro/gpt-5.6-sol` + `max` dispatches failed with provider
  `502` (`Kiro does not support parallel tool calls`). No Sol result is claimed; the
  failure and the primary manual review are recorded in
  `control-tower/reports/codex/2026-08-24_sol-max-profile-story-review.md`.
- Release boundary: master push and PR merge are **APPLIED/MERGED**. The exact-SHA
  Vercel preview passed and `https://gomsin-log.vercel.app/us` returned HTTP 200.
  No remote Supabase mutation was performed; authenticated two-account production
  parity remains **UNVERIFIED**.

## 14. 2026-08-24 release repair and master promotion

- The dirty-worktree failure was repaired by routing
  `get_partner_profile_with_username` in `e2e/fixtures/mockBackend.ts`; the
  production sync fallback remains limited to `PGRST202`.
- Migration `060_partner_username_projection.sql` and its contract test are
  committed. Phase 0 confirms the 060 active-partner/reciprocal/unrelated/anon/
  disconnected actor boundary on a fresh local chain.
- Exact release commit: `b2ca94f2e185c694a3d930bde06f8432e1f66c01`.
- PR #89 is `MERGED`; exact-SHA CI is PASS, including the real-browser creator/
  partner matrix, PostgreSQL, native, and Vercel checks.
- `master` push is APPLIED. Production `/us` returned HTTP 200. Supabase 060 is
  not applied by this task and remains UNVERIFIED.
- Detailed evidence: [`release repair report`](../control-tower/reports/codex/2026-08-24_release-repair-and-master-promotion_codex.md).
