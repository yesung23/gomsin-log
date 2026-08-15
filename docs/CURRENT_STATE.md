# 곰신로그 CURRENT STATE — 저장소 현실

> **이 문서는 현시점의 저장소 현실을 기술한다.** 제품 정의는
> [`PRODUCT_V3.md`](PRODUCT_V3.md), 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)가 소유한다.
>
> 이 문서는 default branch reality와 active development checkpoint를 분리한다.
> active draft PR의 코드가 default branch에 구현된 것으로 보이지 않게 한다.

- 조사 기준: default branch `master`와 GitHub active PR checkpoint, 2026-08-15
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
| P5.1 daily_records E2EE | PR #54에 구현되어 있으나 아직 merge되지 않음 |
| Device Bootstrap | PR #58에 active draft로 존재하나 아직 merge되지 않음 |
| Chat foundation | PR #59 active draft에 구현됨; **FROZEN / DEFERRED**, 아직 merge되지 않음 |
| Chat product UI | PR #60 active draft에 구현됨; **FROZEN / DEFERRED**, 아직 merge되지 않음 |
| active migrations 039–042 | repository/PR에는 존재하지만 이 문서 작업에서 production 적용을 확인하지 않음 |
| ARCH-P6 | architecture decision은 완료, P6 implementation은 시작되지 않음 |

따라서 master만 기준으로 보면 P5 E2EE·Device Bootstrap·chat은 **not merged**다.
active development를 함께 보면 각 draft branch에 해당 foundation 또는 product
integration이 존재한다.

## 1. Active development checkpoint — 2026-08-15

아래 PR/HEAD는 live GitHub에서 확인한 volatile checkpoint다. 다음 세션은 작업 전에
PR state, draft, mergeability, base/head, CI를 다시 확인한다.

| 단계 | active checkpoint | 상태·gate |
|---|---|---|
| P5.1 daily_records E2EE | PR #54 / `codex/p5-daily-records-e2ee-slice` / `835cddd16b71686abc5fb296e4ddce3456844ad0` | implemented in active branch, not merged; production unapplied per PR declaration; final independent acceptance pending unless live evidence changes this |
| P5.2 Device Bootstrap | PR #58 / `codex/03a-device-bootstrap` / `ac81f07f5dc3220b1bc79490e693702add957a0b` | active draft; H-1 duplicate Android registration wiring fix is in the live HEAD; crypto and migration semantics are unchanged by that fix; code-delta review pending |
| P5.3 Chat Foundation | PR #59 / `codex/04a-chat-e2ee-foundation` / `ce4a1355b2738f898109c2d70b038822996f77e7` | implemented in active draft, not merged; **FROZEN / DEFERRED** by current V1 product direction; migration 041 remains unapplied per PR declaration; independent security review pending |
| P5.4 Chat Product UI | PR #60 / `codex/04b-chat-product-ui` / `c409d92d4fa6e5e4913adb8fef2cf6f1bdacba8a` | implemented in active draft, not merged; **FROZEN / DEFERRED** by current V1 product direction; no V1 entry-path integration; real Device Bootstrap runtime integration remains unverified |

PR #54는 open/non-draft이고 #58/#59/#60은 open draft다 at this checkpoint. PR-specific
CI 결과는 영구 acceptance가 아니다. PR #58의 remaining environment gates는 missing
Android SDK, Full Xcode가 필요한 iOS native validation, 그리고 physical iPhone의
Secure Enclave/LCK/`dev_sig`/`dev_kem` 동작 미검증이다.

## 2. Active migration ledger facts

| migration | scope | production state for this docs task |
|---|---|---|
| 039 | daily_records P5 | NOT APPLIED per active PR declaration; remote catalog independently UNVERIFIED |
| 040 | Device Bootstrap/write-floor semantics | active branch only; remote catalog independently UNVERIFIED |
| 041 | chat messages | NOT APPLIED per PR #59/#60 declarations; remote catalog independently UNVERIFIED |
| 042 | media coordination | reserved; implementation not started |

No remote Supabase mutation was performed by this documentation task.

## 3. Default-branch product/security reality

master에서 active PR 코드를 구현된 것으로 세지 않으면, 사용자 콘텐츠 전체 E2EE는
아직 달성되지 않았다. P5.1–P5.4는 active branch checkpoint이지 배포 사실이 아니다.

| 기대 | master 기준 현재 현실 | 분류 |
|---|---|---|
| 사용자 콘텐츠 E2EE | daily_records P5는 active PR에 있으나 unmerged; 일정·여행·주기·미디어는 active P5 stack 밖 | `FUTURE` `PROD` |
| 기기·복구 UX | P5 capability와 PR #58 foundation이 있으나 master에 merge되지 않았고 실제 기기 gate 미검증 | `FUTURE` `PROD` |
| 자체 채팅 | master에는 not merged; PR #59 foundation과 PR #60 product UI가 active draft에 존재하나 현재 V1은 **FROZEN / DEFERRED** | `FUTURE` |
| 주기 projection | 서버 평문 건강 데이터 계산 경계는 재설계 필요 | `SEC` `PROD` |
| 정밀 위치 | 여행 항목에 정밀 위경도 평문 경로가 남아 있음 | `SEC` `BETA` |
| 평문 영상 | 기존 평문 첨부 경로가 존재하며 Full User-Content E2EE 전에는 해소 필요 | `PRODUCT` `BETA` |
| 레거시 건강 평문 | 레거시 주기 테이블·백업 데이터가 남아 있음 | `LEGACY` |
| `briefings` 레거시 스키마 | 평문 요약 캐시 테이블이 스키마에 남아 있다. `master`의 `src/**`에 read/write 경로가 없어 **동작하는 평문 요약 파이프라인은 아니다**. 삭제하는 migration도 없어 스키마 정리 대상으로 남는다 | `LEGACY` |
| 연결 해제와 pairing 상태 | `disconnect_couple`이 `couple_members`만 갱신하고 `crypto_pairings`를 `UNLINKED`로 전이하지 않는다. `UNLINKED` 값은 031에 정의되어 있으나 이 RPC가 사용하지 않는다. **데이터 유출이 아니라 lifecycle/state 정합성 문제**다 | `FUTURE` |

## 4. 핵심 루프와 범위 밖 기능

P0–P4의 핵심 루프 작업은 default branch에 merge된 기록과 코드에서 확인한다.
P5.3/P5.4 chat stack은 active draft 자산으로 보존하지만 V1 제품 진입 경로에서 동결한다.

| 기능 | 현재 상태 |
|---|---|
| `상대방의 오늘` → 정확한 원본 → Conversation Bridge | P0–P3은 merge된 범위; 이야기거리 보관함·완료 처리는 후속 구현 대상 |
| 알림 | 완전 미구현 |
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
