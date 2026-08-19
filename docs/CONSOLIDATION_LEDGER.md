# 곰신로그 BRANCH CONSOLIDATION LEDGER — 2026-08-20

> 이 문서는 **왜 어떤 branch의 작업이 master에 들어왔고 어떤 것이 들어오지 않았는가**를
> 소유한다. 현재 저장소 현실은 [`CURRENT_STATE.md`](CURRENT_STATE.md), 세션 색인은
> [`WORK_LOG.md`](WORK_LOG.md)가 소유한다. 여기에 그 사실들을 복제하지 않는다.

- 기준 `origin/master`: `7a83665299a1f0096f2f81da393f28a97142c9ba`
- 백업 branch: `backup/pre-consolidation-20260820-0130` (기준 master를 정확히 가리킴)
- 감사한 remote branch: **76개** (master 포함, backup 제외)
- remote branch 삭제: **0개**. force push: **없음**. PR 생성: **없음**.

## 판정 방법

branch 하나하나에 대해 `git rev-list --left-right --count`, `git cherry`(patch-id
동등성), `git ls-tree` 전수 비교, 그리고 문제가 되는 파일에 대한 blob 단위 비교를
수행했다. **commit SHA가 달라도 같은 patch가 이미 master에 있으면 다시 적용하지
않았다.** 날짜가 최신이라는 이유만으로 승리시키지 않았고, 충돌 지점마다 두 구현의
의미를 직접 읽고 판정했다.

---

## 1. 회수한 작업

### 1.1 PartnerDay missed-context state machine — INCLUDED

**SOURCE BRANCH:** `claude/lv-partner-day-clean-v2` (PR #72)
**SOURCE COMMITS:** `8429883` → `27703a5` → `609a891`
**TARGET COMMITS:** `f90ea36` → `8e8bd66` → `0cb7666`
**DECISION: INCLUDED (전량)**

**WHY.** 이것이 이번 consolidation에서 가장 중요한 판정이었다. PartnerDay 구현이
**두 개** 존재했고 둘 다 26시간 안에 만들어졌다.

| | `codex/lv-readiness-audit-v1` (PR #70) | `claude/lv-partner-day-clean-v2` (PR #72) |
|---|---|---|
| HEAD 시각 | 2026-08-20 01:26 (**더 최신**) | 2026-08-20 00:33 |
| 계보 | master에서 16 commit 점진 수정 | master에서 3 commit clean 재구현 |
| `partnerDay.ts` | +493 lines | **+672 lines** |
| `partnerDay.test.ts` | +915 lines | **+1358 lines** |
| `usePartnerDay.ts` | +140 lines | **+177 lines** |
| `'unavailable'` 출현 | **0회** | 18회 |
| `'missing'` 출현 | **0회** | 12회 |
| `'corrupt'` 출현 | 2회 | 21회 |
| `PartnerDayReceiptStatus` | 없음 | `missing`·`valid`·`corrupt`·`unavailable` |
| `readPartnerDayCheckpointStatus` | 없음 | 있음 |

PR #70의 HEAD가 53분 **더 최신**이지만, 그 HEAD(`1a5d0d9`, 커밋 메시지 "08/20
push")는 사람이 작업 트리를 통째로 올린 커밋이고 그 안의 PartnerDay는 receipt 4-state를
전혀 갖고 있지 않다. PR #72의 export API는 PR #70의 **완전한 superset**이다. 따라서
"나중 commit wins"를 적용하지 않고 의미가 더 강한 쪽을 택했다.

보호 기준으로 지정된 8개 의미가 landing된 트리에 모두 존재함을 코드에서 직접 확인했다:
CONFIRMED/OUTSTANDING/KNOWN 3집합 · no silent loss(`outstandingRecordIds`의 멤버십은
추가/제거 transition으로만 바뀌므로 시간 경과가 비울 수 없다) · receipt provenance ·
corrupt receipt recovery(date bound 없이) · 4-state read handling · unreadable-but-writable
overwrite protection(`unavailable`은 절대 write-back하지 않음) · unavailable fail-open ·
acknowledgement-only CONFIRMED writer.

**CONFLICT RESOLUTION:** 충돌 없음. `609a891`은 master에서 직접 분기했으므로 3개 commit이
그대로 적용되었다. 적용 후 트리가 `609a891`과 **byte-identical**임을 확인했다
(`git diff HEAD 609a891` = 빈 출력).

### 1.2 이야기거리 overflow + §7.1 authoring contract — INCLUDED

**SOURCE BRANCH:** `claude/lv-two-person-launch-pack-v1` (PR #71)
**SOURCE COMMITS:** `0903e33`, `72d0bd2`
**TARGET COMMITS:** `b879309`, `cf6e861`
**FILES:** `TalkAboutListWidget.tsx` / `.test.tsx`, `src/lib/widgets.tsx`,
`src/pages/recordAuthoringEntryPoint.test.tsx`
**DECISION: INCLUDED**

**WHY.** master에 없는 실제 제품 결함 수정이다. 여섯 번째 이후의 이야기거리가 도달
불가였다 — overflow가 control 없는 텍스트("외 N개")로만 표시되어 목록이 빠질 때까지
기다려야 했다. §8이 대화 아카이브 전체를 홈 위젯의 count 뒤에 두고 별도 탭을 명시적으로
배제하므로, 이 위젯이 유일한 경로다. 또 §7.1의 기록 작성 진입점 계약(군화에게는 유일한
authoring 경로)이 테스트로 고정되어 있지 않았다. literal backtick이 UI에 노출되던 버그도
같은 commit에 있다.

**CONFLICT RESOLUTION:** `src/lib/widgets.tsx`가 1.1과 겹칠 것으로 예상했으나 실제로는
충돌하지 않았다. 두 변경이 registry의 **다른 항목**을 건드린다 — 1.1은 `partner_day`의
label/description, 이쪽은 `talk_about_list`의 description. 두 계보가 이 파일에 대해 동일한
blob(`b548082`)에서 출발했기 때문에 cherry-pick이 그대로 적용되었다. 적용 후 두 변경이
모두 살아 있음을 파일에서 직접 확인했다.

### 1.3 control-tower Obsidian vault + LV architecture reports — INCLUDED

**SOURCE BRANCH:** `codex/lv-readiness-audit-v1` (PR #70)
**SOURCE COMMITS:** `1a5d0d9`의 문서 부분 (+ 그 이전 commit들의 control-tower 변경 누적)
**TARGET COMMIT:** `2a7acf2`
**DECISION: PARTIALLY_INCLUDED — 문서만 회수, production code는 회수하지 않음**

**WHY.** 이 branch에만 있는 고유 자료다: `.obsidian/` 공유 설정, `README.md`,
`Start Here.md`, agent별 노트 6개, 2026-08-19 LV architecture report 3개,
`tasks/PartnerDay Checkpoint State Machine.md`, 그리고 기존 P5.5 report 9개에 붙은
YAML frontmatter와 wikilink. control-tower 파일 수가 24 → 40이 되며 **삭제는 없다**.

이 branch의 PartnerDay production code는 §1.1의 이유로 회수하지 않았다.

**CONFLICT RESOLUTION:** `docs/WORK_LOG.md`가 PR #70과 PR #71 양쪽에서 수정된다. 두
branch의 추가분이 파일의 **다른 위치**에 붙는 순수 append였다 — PR #71은 끝에 244줄,
PR #70은 89행 근처에 102줄. PR #71 판을 base로 두고 PR #70의 첫 hunk만 분리해 적용해
양쪽 entry를 모두 보존했다(1677 → 2017행, 5개 entry 전부 존재).

### 1.4 stale 상태 서술 정정 — INCLUDED

**TARGET COMMIT:** 아래 §5
**DECISION: INCLUDED**

회수한 문서 중 volatile 서술이 최종 트리와 모순되는 부분을 정정했다. 설계 서술 원문은
그대로 두고, 사실이 아니게 된 진술만 고쳤다.

- `control-tower/Current Gate.md` — `status: blocked` → `open`. "PR cannot land in its
  current shape"는 그 defect가 §1.1로 닫혔으므로 거짓이 되었다.
- `control-tower/tasks/PartnerDay Checkpoint State Machine.md` — "OPEN — do not merge"
  → LANDED. defect 표에 8번(corrupt/missing 구분 불가)을 추가하고 각 항목의 상태를 명시.
- `control-tower/Dashboard.md` — Open work 항목의 "open defect, do not merge" 정정.
- `docs/WORK_LOG.md` — 회수한 PR #70 entry가 provenance를 "uncommitted working tree"로
  적고 있었다. 그 트리는 그대로 커밋되지 않았고 같은 설계가 PR #72 세 commit으로 다시
  구현되었다. 실제 착지 계보로 정정하고, 정정했다는 사실 자체를 인용문으로 남겼다.
- `docs/CURRENT_STATE.md` — §1에 consolidation checkpoint 추가.

---

## 2. 제품 방향에 의해 제외 — SKIPPED_DEFERRED

### 2.1 자체 in-app chat

**SOURCE BRANCHES:** `codex/04a-chat-e2ee-foundation` (`ce4a135`, PR #59),
`codex/04b-chat-product-ui` (`c409d92`, PR #60)
**SOURCE COMMITS:** `ed73c35`, `ce4a135`, `c409d92`
**DECISION: SKIPPED_DEFERRED**

**WHY.** 세 가지가 각각 독립적으로 이 판정을 강제한다.

1. **제품 방향.** 자체 chat은 FROZEN / DEFERRED다. "모든 branch를 합친다"는 이유로
   동결된 기능을 production에 켜지 않는다. history는 remote branch에 그대로 남는다.
2. **migration 번호.** 두 branch 모두 `041_chat_messages_e2ee.sql`을 들고 있다. 041은
   이 저장소에서 frozen number이며 `.claude/hooks/`가 재사용을 결정적으로 차단한다.
3. **트리 자체가 회귀.** master 대비 59 commit 뒤처져 있고 net diff가 **−12,106줄**이다.
   migration 040·043·044·045·046과 `store.tsx`·`SettingsPage.tsx`의 큰 부분을 지운다.
   병합했다면 P5.5 security stack 전체가 사라졌을 것이다.

### 2.2 P6

시작하지 않았다. `codex/p6-readiness-audit-v1`은 이미 master에 포함된 문서 branch이며
P6 구현을 승인하지 않는다.

---

## 3. 더 최신 구현으로 대체됨 — SKIPPED_SUPERSEDED

| SOURCE BRANCH | HEAD | 고유 commit | 판정 근거 |
|---|---|---|---|
| `codex/03a-device-bootstrap` | `ac81f07` | `68c328d` (docs) | 트리가 master 대비 −9,054줄. 문서 1건은 P5 재검증 기록으로, 그 내용이 서술하는 상태는 이미 지나갔다 |
| `codex/p5-daily-records-e2ee-slice` | `835cddd` | `68c328d` (docs) | 동일. net −12,106줄 |
| `feat/replace-mock-widgets-with-real-data` | `36af008` | `e4728bc`, `36af008` | PR #11 CLOSED. master 대비 359 commit 뒤, net **−134,886줄**. 고유 자산인 `tests/browser/*`는 master의 landing된 browser harness(`b788c44`)로 대체됨. `tsconfig.tsbuildinfo`는 생성 산출물 |
| `kiro/web-app-completion` | `06498c8` | `b48c13d`, `79e66cf`, `ccedf23`, `f1007ca` | §3.1 참조 |
| `kiro/web-release-stabilization-validation-v2` | `f1007ca` | 위와 동일 4건 | §3.1 참조 |

### 3.1 2026-08-01 CI gate 계열 — SKIPPED_SUPERSEDED

두 branch가 같은 4개 commit을 공유한다. `web-release-validation.yml`에 인라인 보안 스캔
6종과 `gatePathCoverage.test.ts`, staging 문서 2건을 추가한다. **하나씩 master와 대조한
결과 전부 master가 더 강하다.**

| 옛 branch의 gate | master의 현재 상태 |
|---|---|
| 손으로 쓴 JWT/service-role/Supabase URL grep 3종 | `gitleaks/gitleaks-action` 전용 job — 산업 표준 스캐너 |
| `.jks`/`.keystore` 추적 검사 | `native-release-validation.yml`이 `p12`·`p8`·`cer`·`mobileprovision`·`google-services.json`까지 검사 |
| "build MUST fail without env vars" | `master-validation.yml`의 "A build with no Supabase environment MUST fail, **naming the variable**" |
| `gatePathCoverage.test.ts` 259행 | master 판 **604행** |
| `.env` 추적 검사 | `native-release-validation.yml`의 "No build output, dependency cache or machine-local file is tracked" |

`docs/kiro/NEXT_RELEASE_STEPS.md`와 `docs/kiro/STAGING_HANDOFF.md`만이 master에 없는
고유 파일이다. 둘 다 migration **013/014/015**를 적용 순서로 지시한다. 저장소는 현재
046까지 와 있다. 33개 migration만큼 낡은 운영 지시서는 회수하면 적극적으로 오도한다 —
"stale status statements"에 해당하므로 제외했다.

또한 `master-validation.yml`의 placeholder가 옛 branch 판보다 새롭다
(`sb_publishable_...` vs `ci-public-placeholder-...`). master 파일이 전반적으로 후속본이다.

---

## 4. 이미 master에 있음 — SKIPPED_ALREADY_PRESENT

### 4.1 commit은 앞서 있으나 patch는 전부 동등한 branch

`git cherry` 기준 고유 patch가 **0개**다. 파일 단위로도 손실이 없음을 확인했다.

| SOURCE BRANCH | HEAD | ahead | 확인 |
|---|---|---|---|
| `codex/conversation-bridge-v1` | `222f301` | 3 | master에 없는 파일은 `GomsinlogDeviceKeys.podspec` 하나인데, master가 같은 파일을 `GomsinlogCapacitorDeviceKeys.podspec`으로 **rename**해서 갖고 있고 branch에 없는 `LocalKeys.kt`/`LocalKeys.swift`까지 갖고 있다. master가 후속본 |
| `fix/partner-cycle-projection-e2e` | `7b6a7eb` | 1 | master에 없는 파일 0개 |
| `kimi/web-release-stabilization` | `4ae0baf` | 53 | 고유 파일은 `emotionRuleEngine.ts` 계열 — §4.3 |
| `kiro/media-and-real-data-hardening` | `00e7413` | 1 | 동일 |
| `kiro/web-release-stabilization-validation` | `c3eeae2` | 62 | 동일 |

### 4.2 master의 조상이거나 완전히 포함된 branch (60개)

`git rev-list <branch> ^master`가 **0**이다. 아무 것도 적용하지 않았다.

**여기에 `design/*` 12개가 전부 포함된다.** 각 design branch의 ancestry를 확인한 결과
stacked progression이 아니라 이미 전부 master의 조상이다. token migration · ui primitives ·
shared components · account/record/plan screens · settings-onboarding · large components ·
coral/bottom stack · editorial density · 320 mobile layout gate · soldier home 모두
해당한다. 따라서 design 계열에는 ARCHIVE_ONLY로 남길 미착지 작업이 없다.

| BRANCH | HEAD | behind master | DECISION |
|---|---|---|---|
| `agent/fix-pkce-login-callback` | `e49cd73ec0` | 178 | SKIPPED_ALREADY_PRESENT |
| `agent/shared-planning-and-call-context` | `fc384a5fa0` | 179 | SKIPPED_ALREADY_PRESENT |
| `ci/master-validation` | `9be0b8777a` | 215 | SKIPPED_ALREADY_PRESENT |
| `codex/core-privacy-foundation-v1` | `b675abf6ce` | 33 | SKIPPED_ALREADY_PRESENT |
| `codex/device-protection-recovery-v1` | `4cfbf7a392` | 31 | SKIPPED_ALREADY_PRESENT |
| `codex/lv-core-ux-v1` | `576342688b` | 28 | SKIPPED_ALREADY_PRESENT |
| `codex/notification-reentry-v1` | `84d19b49a5` | 29 | SKIPPED_ALREADY_PRESENT |
| `codex/opus-security-blockers-v1` | `0660ad277d` | 20 | SKIPPED_ALREADY_PRESENT |
| `codex/p6-readiness-audit-v1` | `ff8aaca140` | 27 | SKIPPED_ALREADY_PRESENT |
| `codex/sol-integration-audit-v1` | `062b2d8ad6` | 26 | SKIPPED_ALREADY_PRESENT |
| `codex/web-release-stabilization` | `6e0e004f2f` | 295 | SKIPPED_ALREADY_PRESENT |
| `design/320-mobile-layout-gate` | `24a15e833c` | 174 | SKIPPED_ALREADY_PRESENT |
| `design/account-screens` | `30b46eab08` | 161 | SKIPPED_ALREADY_PRESENT |
| `design/coral-strong-and-bottom-stack` | `77a44caae0` | 169 | SKIPPED_ALREADY_PRESENT |
| `design/large-components` | `daf2d70ea5` | 155 | SKIPPED_ALREADY_PRESENT |
| `design/plan-screens` | `8856f06d6f` | 163 | SKIPPED_ALREADY_PRESENT |
| `design/record-screen` | `4286c39a74` | 165 | SKIPPED_ALREADY_PRESENT |
| `design/settings-onboarding` | `e7733ad00e` | 159 | SKIPPED_ALREADY_PRESENT |
| `design/shared-components` | `df272e8192` | 157 | SKIPPED_ALREADY_PRESENT |
| `design/soldier-home-briefing-first` | `458d9754cd` | 171 | SKIPPED_ALREADY_PRESENT |
| `design/token-migration` | `3207b19f1d` | 153 | SKIPPED_ALREADY_PRESENT |
| `design/ui-primitives` | `4817e0abfb` | 167 | SKIPPED_ALREADY_PRESENT |
| `design/v2.1-editorial-density` | `f32a37bbe0` | 136 | SKIPPED_ALREADY_PRESENT |
| `docs/chat-contract-v1` | `017c334965` | 71 | SKIPPED_ALREADY_PRESENT |
| `docs/control-tower-governance` | `5f1d7b4929` | 51 | SKIPPED_ALREADY_PRESENT |
| `docs/icloud-memory-business-model` | `83c9b82b4c` | 60 | SKIPPED_ALREADY_PRESENT |
| `docs/product-north-star-memory-vision` | `2b06fd6e33` | 65 | SKIPPED_ALREADY_PRESENT |
| `docs/product-v3-canonical` | `c1589cd81d` | 88 | SKIPPED_ALREADY_PRESENT |
| `docs/project-handoff-business-memory` | `6cc9f720d8` | 68 | SKIPPED_ALREADY_PRESENT |
| `docs/shared-ai-control-tower-v1` | `f0c163c749` | 7 | SKIPPED_ALREADY_PRESENT |
| `docs/state-accuracy` | `0988125f2c` | 213 | SKIPPED_ALREADY_PRESENT |
| `docs/work-log` | `6bb52bbb94` | 78 | SKIPPED_ALREADY_PRESENT |
| `feat/bilateral-talk-about` | `a626d2e9e2` | 77 | SKIPPED_ALREADY_PRESENT |
| `feat/core-day-loop-v3` | `af6b3ccfef` | 80 | SKIPPED_ALREADY_PRESENT |
| `feat/e2ee-phase-1a-key-foundation` | `8c9cca089a` | 91 | SKIPPED_ALREADY_PRESENT |
| `fix/p5.5-browser-e2e-harness` | `b788c44db3` | 17 | SKIPPED_ALREADY_PRESENT |
| `fix/phase0-production-baseline-reconcile` | `068bccbfe1` | 84 | SKIPPED_ALREADY_PRESENT |
| `fix/self-host-pretendard` | `b1b58b93d5` | 215 | SKIPPED_ALREADY_PRESENT |
| `integration/p5.5-approved-stack` | `b788c44db3` | 17 | SKIPPED_ALREADY_PRESENT |
| `kiro/a11y-hardening` | `fb1ea8afe2` | 201 | SKIPPED_ALREADY_PRESENT |
| `kiro/briefing-jump-to-record` | `b78238674f` | 199 | SKIPPED_ALREADY_PRESENT |
| `kiro/complete-v1-overnight` | `7f8c311696` | 273 | SKIPPED_ALREADY_PRESENT |
| `kiro/drop-unused-date-fns` | `015818ea05` | 206 | SKIPPED_ALREADY_PRESENT |
| `kiro/emotion-pipeline-single-source` | `cb4001e843` | 192 | SKIPPED_ALREADY_PRESENT |
| `kiro/final-product-completeness` | `9c3348ecb9` | 222 | SKIPPED_ALREADY_PRESENT |
| `kiro/fix-pkce-callback-race` | `aa8e606850` | 182 | SKIPPED_ALREADY_PRESENT |
| `kiro/hosting-spa-fallback` | `aebc25885a` | 209 | SKIPPED_ALREADY_PRESENT |
| `kiro/keyboard-operable-cards` | `abf199aaf5` | 191 | SKIPPED_ALREADY_PRESENT |
| `kiro/lint-gate-zero-warnings` | `54fae4b566` | 189 | SKIPPED_ALREADY_PRESENT |
| `kiro/media-playback` | `cf75eba30f` | 205 | SKIPPED_ALREADY_PRESENT |
| `kiro/merge-policy-steering` | `4d6a68440b` | 217 | SKIPPED_ALREADY_PRESENT |
| `kiro/mobile-v1-release-candidate` | `d47563bc9a` | 261 | SKIPPED_ALREADY_PRESENT |
| `kiro/offline-outbox` | `a51c913dbe` | 194 | SKIPPED_ALREADY_PRESENT |
| `kiro/partner-day-timeline` | `67e239b62a` | 197 | SKIPPED_ALREADY_PRESENT |
| `kiro/record-author-distinction` | `f863d8a522` | 192 | SKIPPED_ALREADY_PRESENT |
| `kiro/release-hardening-2026-07-31` | `7d82e3efd1` | 310 | SKIPPED_ALREADY_PRESENT |
| `kiro/two-account-v1-completion` | `86eda04036` | 245 | SKIPPED_ALREADY_PRESENT |
| `kiro/v1-product-excellence-audit` | `69b268aab2` | 184 | SKIPPED_ALREADY_PRESENT |
| `kiro/web-app-completion-v2` | `0ba6e8c849` | 283 | SKIPPED_ALREADY_PRESENT |
| `transfer/kimi-web-release-stabilization-0eb48b5` | `0eb48b5a71` | 299 | SKIPPED_ALREADY_PRESENT |

### 4.3 의도적으로 삭제된 코드 — SKIPPED_UNSAFE

`src/lib/emotionRuleEngine.ts`와 `src/lib/__tests__/emotionRuleEngine.test.ts`가
`kimi/*`·`kiro/media-and-real-data-hardening`·`kiro/web-release-stabilization-validation`에
남아 있다. 이 파일은 PR #27 "화면에 없는 두 번째 감정 엔진이 계속 다른 답을 갖고 있었다"에서
**의도적으로 제거**되었다. 되살리면 금지 영역인 AI 감정 추론을 다시 켜는 셈이 되므로
회수하지 않는다. 같은 이유로 `src/features/home/SoldierDashboard.tsx`(design 계열에서 대체),
`walkthrough.md`, `public/icons/icon-*.svg`, Capacitor 템플릿 잔여
`ExampleInstrumentedTest.java`/`ExampleUnitTest.java`도 회수하지 않는다.

---

## 5. remote에 없는 local branch 작업

local branch 7개가 remote 어디에도 없는 commit **17개**를 들고 있었다. 데이터 손실
위험이 가장 큰 항목이므로 개별 검증했다.

`codex/opus-security-blockers-v1`(local `e96a5e6`), `codex/sol-integration-audit-v1`,
`codex/p6-readiness-audit-v1`, `codex/lv-core-ux-v1`, `codex/notification-reentry-v1`,
`codex/device-protection-recovery-v1`, `codex/core-privacy-foundation-v1`.

**DECISION: SKIPPED_ALREADY_PRESENT — 손실 없음.**

**WHY.** 이들은 PR #62–#67 stack의 **convergence 이전** 판이고, 그 stack은
`0660ad277` → `b788c44` → PR #68로 master에 착지했다. 두 가지로 확인했다.

1. `e96a5e6`에 있고 master에 없는 파일: **0개**.
2. security 파일 blob 단위 비교 — 전부 **byte-identical**:

| 파일 | 결과 |
|---|---|
| `src/app/e2ee/coupleProtectionBarrier.ts` | IDENTICAL |
| `src/app/e2ee/runtimeSession.ts` | IDENTICAL |
| `src/app/e2ee/settingsFacts.ts` | IDENTICAL |
| `src/lib/store.tsx` | IDENTICAL |
| `supabase/migrations/044_unlink_crypto_pairing_authority.sql` | IDENTICAL |
| `supabase/migrations/046_require_actor_for_device_provisioning.sql` | IDENTICAL |

`.claude/`·`docs/skills/`·`.codex/`·`.kiro/steering/` 개편분도 전부 master에 있다.

**local branch는 하나도 삭제하지 않았다.** dirty worktree 3곳의 tracked diff와 untracked
파일도 별도로 백업했다.

---

## 6. 제외한 파일

| 파일 | 이유 |
|---|---|
| `.DS_Store` | `.gitignore` 대상. master에 이미 실수로 추적되고 있으나, binary diff는 작업을 담지 않으므로 이번 변경에 포함하지 않았다. master의 기존 추적 상태는 건드리지 않았다 |
| `tsconfig.tsbuildinfo` | 생성 산출물 |
| `docs/kiro/NEXT_RELEASE_STEPS.md`, `docs/kiro/STAGING_HANDOFF.md` | migration 013/014/015 기준의 낡은 운영 지시서 (§3.1) |
| `supabase/migrations/041_chat_messages_e2ee.sql` | frozen migration number + FROZEN 기능 (§2.1) |
| `src/lib/emotionRuleEngine.ts` 및 테스트 | 의도적으로 삭제된 두 번째 감정 엔진 (§4.3) |

`node_modules`, `dist`, build 산출물, 임시 파일은 어느 회수 경로에도 포함되지 않았다.

---

## 7. 남은 수동 판단

- **불확정 `OUTSTANDING` 증가.** 미확인 기록을 저장 용량보다 우선한다는 방향은 정해졌으나
  상한은 정해지지 않았다. 제품 결정이 필요하다.
- **실기기 다일차 검증.** 시뮬레이션 시간으로만 검증되었다. 실제 기기에서 여러 날에 걸친
  확인은 수행되지 않았다.
- **독립 review.** PartnerDay clean replacement에 대한 독립 reviewer 판정은 아직 없다.
- **remote branch 정리.** 이번 pass에서는 **0개** 삭제했다. 삭제 여부는 사용자 승인 후
  별도 pass에서 판단한다.
- **PR #70·#71·#72 상태.** 세 PR 모두 OPEN/DRAFT로 남아 있다. 내용은 master에 착지했으므로
  닫을지 여부는 사용자 판단이다.
