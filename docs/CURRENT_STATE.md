# 곰신로그 CURRENT STATE — 저장소 현실

> **이 문서는 현시점의 저장소 현실을 기술한다.** 제품 정의는
> [`PRODUCT_V3.md`](PRODUCT_V3.md), 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)가 소유한다.
>
> 이 문서는 default branch reality와 active development checkpoint를 분리한다.
> active draft PR의 코드가 default branch에 구현된 것으로 보이지 않게 한다.

- 조사 기준: default branch `master`와 GitHub live state, 2026-08-18. §1의 branch
  consolidation checkpoint는 2026-08-20 전수 감사 기준이다
- 조사 방식: 저장소와 GitHub PR metadata/body 대조
- remote Supabase catalog, production migration state, 실제 기기 state: **UNVERIFIED**

분류:

| 코드 | 뜻 |
|---|---|
| `FUTURE` | EXPECTED FUTURE WORK |
| `PRODUCT` | PRODUCT DECISION 또는 product gap |
| `SEC` | SECURITY/PRIVACY CONFLICT |
| `LEGACY` | LEGACY TO DEPRECATE |
| `BETA` | BLOCKS BETA |
| `PROD` | BLOCKS PRODUCTION |

## 0. Default-branch reality

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
| 회귀 테스트를 못 만든 것 | **1건** — 오프라인 큐 flush. 단독 통과, 전체 스위트에서 간섭. 이 수정만 "읽어서 확인" |

**#80은 아직 병합되지 않았다.** 기본 브랜치 tip은 `f73ebfe`이며 병합은 user 전용 게이트다.

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
| 알림 | **코드는 양쪽 다 있다.** 서버: migration 048(전용 `push_delivery_state` 테이블 · 비공개 기록은 아무것도 올리지 않음 · 하루 1회와 연락 가능 시간을 DB가 강제 · 기기 이양 시 토큰 회수)과 `send-push` Edge Function. 클라이언트: `@capacitor/push-notifications` 통합 · 커플 연결 시 권한 요청과 토큰 등록 · 로그아웃 시 회수 · 탭 착지는 홈 고정. 전부 active branch에 있고 검증됐다. **남은 것은 전부 외부 게이트다** — APNs/FCM 자격증명, `aps-environment` entitlement(Apple portal capability와 함께 추가해야 함), 실기기 2대. 이 기기에서는 Xcode 부재로 `pod install`도 완료할 수 없다 |
| `외박` / `외출` 일정 종류 | 미구현. `기타`로 표현됨 |
| Moment / 월간 히스토리 | 미구현 |
| 수익화 / 구독 | 코드 없음. 방향은 [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) |
| 여행 플래너·공동 할 일 | 동결. 새 투자 없음. 위치 privacy gate는 별도 충족 필요 |

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
- 제품 의도는 `PRODUCT_V3.md`, 구현 순서는 `ENGINEERING_ROADMAP.md`에 쓴다.
- remote 상태 주장은 날짜·증거 출처와 함께 적고, 확인할 수 없으면 `UNVERIFIED`다.
- active PR/HEAD/CI는 checkpoint일 뿐이며 다음 세션에서 live 재검증한다.
