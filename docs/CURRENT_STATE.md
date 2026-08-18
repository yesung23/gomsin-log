# 곰신로그 CURRENT STATE — 저장소 현실

> **이 문서는 현시점의 저장소 현실을 기술한다.** 제품 정의는
> [`PRODUCT_V3.md`](PRODUCT_V3.md), 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)가 소유한다.
>
> 이 문서는 default branch reality와 active development checkpoint를 분리한다.
> active draft PR의 코드가 default branch에 구현된 것으로 보이지 않게 한다.

- 조사 기준: default branch `master`와 GitHub live state, 2026-08-18
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
| P5.5 Core Privacy Foundation integration | `codex/core-privacy-foundation-v1` / `35da04cf739649667c4d405a6c64c522d9e000e3` | P4 Conversation Bridge + P5.1 + P5.2 integration branch. Session runtime install, floor guard, account-switch teardown, unlink authority tombstone, and forward migration 044 are code/test-verified locally; not merged, production unapplied, and real-device validation remains unverified |

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
| #58 | Device Bootstrap | `codex/03a-device-bootstrap` / `ac81f07f5dc3220b1bc79490e693702add957a0b` | #54 branch | OPEN / DRAFT; superseded/integrated provenance |
| #62 | device protection recovery UX | `codex/device-protection-recovery-v1` / `4cfbf7a39220c672e34f046a1265594c83b7978d` | #58 stack | OPEN / DRAFT; superseded/integrated provenance |
| #63 | notification re-entry | `codex/notification-reentry-v1` / `84d19b49a5bff91b75b84217f2829d44c6ac942a` | #62 stack | OPEN / DRAFT; superseded/integrated provenance |
| #64 | LV/core protection UX | `codex/lv-core-ux-v1` / `576342688b0e4b165b441f10ac68cbac71aecd7e` | #63 stack | OPEN / DRAFT; superseded/integrated provenance |
| #65 | P6 readiness audit | `codex/p6-readiness-audit-v1` / `ff8aaca1404ff409f39be2cb2360f5f002e4b170` | #64 stack | OPEN / DRAFT; superseded/integrated provenance; does not authorize P6 |
| #66 | security stack integration | `codex/sol-integration-audit-v1` / `062b2d8ad6e34ddcdc4de9fadf3460281433c888` | #65 stack | OPEN / DRAFT; superseded/integrated provenance |
| #67 | security blocker fixes | `codex/opus-security-blockers-v1` / `0660ad277dec0a62be3b315cf3668fadf91c282b` | #66 stack | OPEN / DRAFT; superseded/integrated as approved baseline |
| #68 | P5.5 landing | `integration/p5.5-approved-stack` / `b788c44db39fd57a5f483b3eb3340e1630ce87d5` | master | MERGED; resulting master `eb2d9a4f9eca9742296bfe0d5a2a8e980499f2e7` |

Convergence is complete for P5.5: **approved baseline `0660ad277` → reviewed
e2e-only harness `b788c44` → master merge `eb2d9a4`**. #54/#58/#62–#67 remain
historical provenance and must not be independently landed again.

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
| 평문 영상 | 기존 평문 첨부 경로가 존재하며 Full User-Content E2EE 전에는 해소 필요 | `PRODUCT` `BETA` |
| 레거시 건강 평문 | 레거시 주기 테이블·백업 데이터가 남아 있음 | `LEGACY` |
| `briefings` 레거시 스키마 | 평문 요약 캐시 테이블이 스키마에 남아 있다. `master`의 `src/**`에 read/write 경로가 없어 **동작하는 평문 요약 파이프라인은 아니다**. 삭제하는 migration도 없어 스키마 정리 대상으로 남는다 | `LEGACY` |
| 연결 해제와 pairing 상태 | master에는 `disconnect_couple`이 `couple_members`만 갱신하는 상태다. integration branch의 044가 pairing도 `UNLINKED`로 전이하며 local tombstone을 함께 처리한다. 아직 merge·원격 적용 전이다 | `FUTURE` `PROD` |

## 4. 핵심 루프와 범위 밖 기능

P0–P4의 핵심 루프 작업은 default branch에 merge된 기록과 코드에서 확인한다.
P5.3/P5.4 chat stack은 active draft 자산으로 보존하지만 V1 제품 진입 경로에서 동결한다.

| 기능 | 현재 상태 |
|---|---|
| `상대방의 오늘` → 정확한 원본 → Conversation Bridge | P0–P3은 merge된 범위. 이야기거리 보관함·완료 처리 P4는 integration branch에 있으나 master에는 아직 merge되지 않음 |
| 알림 | 완전 미구현 |
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
