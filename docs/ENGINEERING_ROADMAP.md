# 곰신로그 엔지니어링 로드맵

> 구현 **순서**만 담는다. 제품 의도는 [`PRODUCT_V3.md`](PRODUCT_V3.md),
> 현재 저장소 상태는 [`CURRENT_STATE.md`](CURRENT_STATE.md).

- 기준일: 2026-08-15
- 이 문서는 어떤 것도 구현하지 않는다.

---

## 1. 세 개의 게이트를 혼동하지 말 것

가장 흔한 오해는 "Phase 1A가 프로덕션에 없으니 Phase 1B를 못 한다"는 것이다. **틀렸다.**

| 게이트 | 현재 상태 | 무엇을 요구하나 |
|---|---|---|
| **DEVELOPMENT** | ✅ **열림** | Phase 1A 마이그레이션 체인에 대해 로컬에서 개발·테스트한다. 그게 전부다. |
| **BETA 배포** | ❌ 닫힘 | §4 |
| **PRODUCTION** | ❌ 닫힘 | §5 |

```text
PHASE 1B DEVELOPMENT:            YES
PHASE 1A (기능 개발 관점):        FROZEN
PHASE 1A 프로덕션 배포:            NO — 그러나 개발 전제조건이 아니다
PRODUCTION:                      NO
```

Phase 1B는 로컬에서 Phase 1A 마이그레이션 체인(031→032→034→035→036)에 대해 개발·검증할 수
있다. 실제 배포 승인은 Beta/Production 게이트에 속한다.

---

## 2. 개발 순서

절대적이지 않다. 의존성 분석이 작은 수정을 지지하면 수정하고 이유를 남긴다.

| 단계 | 내용 | 왜 이 위치인가 |
|---|---|---|
| **P0-a** | **핵심 루프 입력 복구** — 제거 불가능한 기록 작성 진입점, 작성자 태그 입력 수단 | 가장 값싸고 영향이 크다. 루프 1단계가 제거 가능한 위젯 하나에 걸려 있고, 요약 우선순위가 읽는 태그를 사용자가 설정할 수 없다. **입력 없는 요약을 먼저 개선하는 것은 순서가 뒤집힌 것이다.** |
| **P0-b** | **Phase 0 / 프로덕션 baseline 정합성 해소** | Storage 권한, 마이그레이션 원장, 백업·데이터 손실 정책. 미디어 관련 모든 후속 작업의 전제다. `CURRENT_STATE.md` §2 참조 |
| **P0-c** | **이미 정의된 PMK/CSK/HRK 불변 규칙의 회귀 테스트** | 방어 코드가 있다는 것과 증명된다는 것은 다르다. 새 기능보다 기존 불변 규칙의 증명이 먼저다. 비용은 테스트 파일 수준 |
| **P1** | **`상대방의 오늘` 통합** — 로컬·결정적·사실 기반, 뷰어가 볼 수 있는 기록만 | 순수 클라이언트 로직이며 현재 데이터 위에서 완전히 테스트 가능하다. E2EE 이후에는 "평문이 어디서 오는가"만 달라진다. 암호화 마이그레이션과 제품 로직 변경을 같은 단계에 묶으면 회귀 원인을 분리할 수 없다 |
| **P2** | **정확한 원본 이동 하드닝 + 라우트/딥링크 동일성** | P1과 같은 이유. 삭제·수정·날짜 불일치를 먼저 고정한다. 라우트 주소 지정은 알림의 선행 조건이므로 함께 처리한다 |
| **P3** | **양방향 `이따 이야기하기`** | 조율 메타데이터 추가에 그친다. 암호화 이후에 스키마를 건드리는 것보다 안전하다 |
| **P4** | **Conversation Bridge 완성** | P3의 양방향 조율 메타데이터를 이야기거리 보관함·정확한 원본·완료 처리까지 연결한다. 원문을 복사하지 않고 original-record 권한을 그대로 따른다 |
| **P5.1** | **`daily_records` E2EE 수직 슬라이스** | Phase 1B의 첫 실제 콘텐츠 도메인 |
| **P5.2** | **Device Bootstrap** | native device identity와 실제 기기 보호 상태가 먼저 고정되어야 한다 |
| **P5.3** | **Chat E2EE Foundation — FROZEN / DEFERRED** | active draft에 구현된 couple CSK/GLE1 채팅 기반을 삭제하지 않고 동결한다. V1 제품 진입 경로에는 연결하지 않는다 |
| **P5.4** | **Chat Product Integration — FROZEN / DEFERRED** | active draft의 `/chat` 통합 자산을 삭제하지 않고 동결한다. 재개에는 별도 제품·보안 승인 필요 |
| **P5.5** | **Security Stack Integration** | P6A 이전 마지막 통합 gate다 |
| **ARCH-P6** | **암호화 미디어 architecture decision** | 결정은 완료되었지만 P6 코드는 아직 구현하지 않는다 |
| **P6A–P6D** | **CloudKit 미디어 구현·통합·실기기 hardening** | P5.5와 P6 entry conditions 이후에만 시작한다 |

### P5.1 — `daily_records` E2EE vertical slice

첫 콘텐츠 도메인으로서 `daily_records`에 암호문 envelope, PMK/CSK routing,
write-floor, 로컬 outbox 보호와 negative authorization 증명을 고정한다.
이 단계가 branch에 존재하는 것과 default branch/production에 적용된 것은 별개다.

### P5.2 — Device Bootstrap

다음 범위를 하나의 gate로 검증한다.

- native device identity, `dev_sig`, `dev_kem`
- LCK와 protected local state
- trusted-device bootstrap 및 exact scope authority
- write-floor activation prerequisites
- real-device validation

code acceptance와 native device gate가 모두 통과되기 전에는 P5.2를 완료로 보지 않는다.

### P5.3 — Chat E2EE Foundation (FROZEN / DEFERRED)

- existing couple CSK와 GLE1
- ciphertext-only server message
- RLS 및 ACTIVE write / RETIRED read
- LCK-sealed outbox
- tombstone semantics

### P5.4 — Chat Product Integration (FROZEN / DEFERRED)

- `/chat`과 Home one-action entry
- sending, retry, unavailable, protection 상태
- encrypted local persistence
- talk-about handoff
- plaintext context URL 금지

### P5.5 — Security Stack Integration

P5.5 보안 gate의 기존 통합 기준은 동결 자산의 재개 또는 P6 선행 검증에만 적용한다.
Conversation Bridge V1의 진입 조건을 약화시키거나 대체하지 않는다.

```text
P5.1 → P5.2 → P5.3 → P5.4 → integrated review
```

다음 항목을 하나의 integration base에서 검증한다.

- migration numbering과 coexistence
- native runtime 및 LCK
- `RecordCryptoEnvironment`와 `ChatCryptoEnvironment`
- account/logout/unlink teardown
- browser/native E2E

P5.5가 P6A를 시작하기 전 마지막 gate다.

### ARCH-P6 — architecture decision

ARCH-P6 결정은 완료되었으며 상태는 **READY FOR IMPLEMENTATION**이다. 이것은 P6
코드가 구현되었다는 뜻이 아니다. 결정의 핵심은 다음과 같다.

- iOS-first
- uploader-owned CloudKit private DB/custom zone
- CKAsset ciphertext
- CKShare read-only partner
- Supabase는 coordination metadata only
- PMK private photo / CSK shared photo
- HRK forbidden
- separate GME1 media envelope
- plaintext media durable storage 금지
- normalize/EXIF strip before encryption
- no silent Supabase Storage fallback
- account unlink/account switch fail closed
- Android boundary intentionally deferred

구현 순서는 `P6A Native CloudKit Media Foundation` → `P6B Media E2EE + GME1 +
normalization + migration 042` → `P6C Photo Product Integration` → `P6D Two Apple
IDs / real devices / quota / unlink / account-switch / security hardening`이다.

### P6 entry conditions

다음 조건을 모두 만족하기 전에는 P6A를 시작하지 않는다.

- P5.1/P5.2/P5.3/P5.4 integration base
- `DeviceKeys`/LCK real iPhone validation
- migration 040/041 coexistence verified
- CloudKit development entitlement/container prerequisites
- Production mutation 없음

ARCH-P6 완료는 P6A 시작 허가와 같지 않다.

## 2.5 사업 M-stage ↔ engineering P-stage crosswalk

M1–M8은 협약기간의 사업 실행·고객검증 순서이고, P-stage는 기술 의존성과 engineering
gate다. M-stage가 P-stage를 대체하거나, 사업계획서의 개발 예정이 기술 구현 완료를
증명하지 않는다.

| 사업 단계 | 기술 대응 | 경계 |
|---|---|---|
| M1 개인정보 보호 | P5.1 / P5.2 | 텍스트 E2EE와 device/bootstrap gate를 개발·검증한다. 전체 사용자 콘텐츠 E2EE 완료를 뜻하지 않는다. |
| M2 대화 연결 | P3 / P4 | Conversation Bridge로 기록에서 실제 대화까지의 맥락 연결을 완성한다. 자체 채팅은 V1 DEFERRED다. |
| M3 고객 문제검증 | **LV — Limited Validation Gate** | 곰신 고객문제·연결행동·실제 대화를 검증하는 사업 단계다. 통제된 소규모 외부 검증에는 LV gate가 필요하고, 전체 P10 Public Beta/Production gate 통과를 요구하지는 않는다. |
| M4 UX 개선 | 별도 P-stage 대체 없음 | 실증 이탈구간을 개선하는 제품 실행 단계다. |
| M5 장기 기록 | P6A / P6B / P6C / 관련 P6D | 사진 E2EE·기본 기억 아카이브·개인 클라우드 연계 PoC의 판단 자료다. |
| M6 AI 실증 | 별도 P-stage 대체 없음 | 지원기기 온디바이스 요약과 미지원기기 fallback을 검증한다. |
| M7 BM 검증 | **P-MP — Memory Product MVP** | `우리의 한 달` MVP·POD·가격·구매를 검증한다. 판매 가능한 제품은 P-MP가 만들고, M7은 그 제품으로 수요·원가·결제를 검증한다. |
| M8 사업화 판단 | Beta/Production gate와 별도 | 반복사용·원가·구매·운영부담을 종합해 GO/HOLD를 판단한다. 배포 승인이 아니다. |

**M5 Basic Memory Archive ≠ P9 Advanced Moment/Archive.** M5는 텍스트·사진 중심의
기본 기록축적과 기억상품 검증을 뜻하고, P9는 이후 고급 Moment/Archive 기술·제품 단계다.

M3와 M7은 사업 검증 단계이지만 각각 engineering 산출물을 요구한다. 그 산출물의 소유자는
아래 `LV`와 `P-MP` 단계다. 두 단계 모두 P10 Beta/Production gate를 대체하지 않는다.

### LV — Limited Validation Gate (M3 전제)

M3는 실제 곰신 사용자가 제품을 써야 성립한다. 그러나 M3가 P10 전체를 요구하면 3번째
사업 단계가 마지막 engineering 단계에 의존하는 순환이 된다. 그래서 통제된 소규모 외부
검증만을 위한 별도 gate를 둔다.

세 가지를 절대 섞지 않는다.

```text
LV Limited Validation   — 통제된 소규모 외부 사용자 검증
P10 Public Beta         — 일반 외부 베타
Production release      — 정식 배포
```

LV 진입 조건은 다음이며, 검증 대상 흐름에 한정한다.

- 계정·커플 연결·세션 복구가 안전하게 동작한다
- 기록 → `상대방의 오늘` → 정확한 원본 → 대화 준비의 핵심 흐름이 기능한다
- 검증 범위에 필요한 프라이버시·보안 보호가 적용되어 있다
- 검증 대상 흐름에 알려진 critical authorization/privacy blocker가 없다
- 외부 사용자 범위가 통제된 소규모이며 참가자에게 검증 단계임을 고지한다
- 데이터 손실·오류에 대한 rollback·지원 경로가 정해져 있다
- 검증 중 수집·보관하는 데이터 범위와 종료 후 처리가 정해져 있다

LV가 명시적으로 뜻하지 않는 것:

> **LV 통과는 Production readiness가 아니다.** §4 Beta gate(B1–B9)와 §5 Production
> gate(R1–R5)는 그대로 남아 있고, LV는 그중 어느 것도 통과했다고 주장하지 않는다.
> 검증 범위 밖 기능을 일반 사용자에게 여는 근거로도 사용하지 않는다.

LV 시점에 아직 해소되지 않은 §6 정밀 위치·§7 평문 영상 같은 gate가 있으면, 해당 기능을
검증 범위에서 제외하거나 비활성화한 상태로만 LV를 진행한다.

### P-MP — Memory Product MVP (M7 전제)

M7은 판매 가능한 기억상품을 요구한다. 그 제품을 만드는 engineering 소유자는 P-MP다.
범위는 M7 검증에 필요한 최소한으로 제한한다.

포함:

- `우리의 한 달` 구성(기간 선택, 대상 기록 수집)
- 사용자가 직접 기억을 선택·제외
- 결정적 초안·미리보기 생성
- 편집·순서변경·삭제
- 최종 미리보기 확인
- 구매·주문 흐름
- 결제 연동
- 검증하는 범위의 POD 주문 handoff (디지털 실제결제 확인 이후)
- M7이 요구하는 전환·원가 계측

포함하지 않는다:

- 전체 Book Studio
- AI가 중요한 기억을 선정하는 기능
- 고급 Archive(P9)
- Plus
- 동시 다수 기억상품
- 음성·영상 기억상품

순서:

```text
M5 기록축적·기본 Archive 기반
→ M6 온디바이스 AI 실증(선택적)
→ P-MP Memory Product MVP 구현
→ M7 디지털 기억상품 검증(지불의향·제작완료·실제결제)
→ M7 POD 실물 제작 검증
```

P-MP 안에서도 디지털 경로를 먼저 완성한다. 디지털 기억상품의 실제결제가 확인되기 전에는
POD 벤더 연동·최소 제작수량·선투자를 진행하지 않는다. 사업 근거는
[`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) §9.4, 실물 배송의
개인정보·법률 gate는 같은 문서 §13과
[`DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`](DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md) §E가 소유한다.

> **P-MP는 AI 성공에 의존하지 않는다.** 초안 구성은 결정적·규칙 기반 경로를 기본으로
> 구현하고, AI 편집보조는 그 위의 선택적 보조다. M6에서 온디바이스 AI가 지원되지 않거나
> 효과가 없다고 판정되어도 M7은 규칙 기반 구성만으로 실행할 수 있어야 한다.

결제·주문 구현 전에 구매자·미리보기 공유 범위·연결 해제 후 주문/접근 처리를 먼저
확정한다. 이는 P-MP의 선행 product/engineering gate이며 지금 추측하지 않는다.

### 후속 engineering stages 보존

P6 이후의 다음 단계도 사업 M-stage와 혼동하지 않고 별도 engineering 순서로 보존한다.

| 단계 | 범위 | 상태 경계 |
|---|---|---|
| **P7** | Schedule / military dates | 일정·군 복무일 관련 후속 구조와 권한을 검토하는 단계. 현재 완료 주장이 아니다. |
| **P8** | HRK / cycle redesign | 건강·주기 데이터의 독립 키·공유 경계를 재설계·검증하는 단계. HRK를 CSK로 대체하지 않는다. |
| **P9** | Advanced Moment / Archive | M5 기본 아카이브 이후의 고급 회고·Moment·Archive 단계. |
| **P10** | Beta / release hardening | 실제 계정·기기·권한·삭제·내보내기·Production gate를 통과시키는 후속 단계. |

각 단계의 진입 조건과 현재 gate는 `CURRENT_STATE.md`, Beta/Production 승인 기준은 이
문서 §4–§7과 관련 보안 문서에서 다시 확인한다.

### 로드맵에 없는 것

**오디오와 영상은 P0–P5(현재 활성 구간)에 없다.** P6 사진 기반이 안정된 뒤의
코어 이후 미디어 확장이다. 저장용량 premium gate가 아니라 engineering priority,
복구·프라이버시 검증 결과에 따라 순서를 정한다. **현재 P0–P5 로드맵 용량을 여기에
배정하지 않는다** — 순서는 바뀌지 않았다.

여행 플래너·공동 할 일 확장, 서버 측 검색도 로드맵에 없다.

---

## 3. P1–P4 기간의 구속 조건

E2EE보다 제품 작업을 먼저 하더라도 다음을 어기지 않는다.

1. **새로운 평문 사용자 콘텐츠 컬럼을 추가하지 않는다.** 새 필드는 조율 메타데이터이거나,
   이미 암호화 대상인 필드 안에 들어가야 한다.
2. 요약·파생값을 서버에 저장하지 않는다.
3. 알림 payload에 콘텐츠를 넣지 않는다.
4. 새 기능 명세는 [`PRODUCT_V3.md`](PRODUCT_V3.md) §14.2의 네 항목을 포함한다.

---

## 3.5 ARCH-P6 — iCloud Media Architecture

P5 이후, 실제 P6 구현 전에 다음을 read-only architecture decision으로 검증한다.
이 단계에서는 새 암호 프로토콜을 발명하지 않으며, 필요한 경우 Architect decision을
먼저 남긴다.

- CloudKit 데이터 소유권과 `CKAsset` 미디어 저장
- 파트너 공유 모델(`CKShare` 또는 승인된 equivalent)
- E2EE blob lifecycle과 CSK/PMK 미디어 라우팅
- 서버·CloudKit·공유 메타데이터 leakage
- EXIF/GPS 제거와 thumbnail/preview 경계
- upload/download retry 및 offline queue
- iCloud quota exceeded와 iCloud account unavailable 처리
- account unlink, author delete, partner access revocation, device loss
- legacy Supabase Storage 경로의 migration/disable plan
- Android/non-iOS boundary

검증 후 구현 순서는 다음과 같다.

```text
ARCH-P6
→ photo
→ upload/share/download/decrypt/delete/unlink lifecycle 증명
→ audio
→ video
```

---

## 4. BETA 배포 게이트

외부 베타 이전에 **전부** 충족해야 한다.

| # | 게이트 | 근거 |
|---|---|---|
| B1 | Storage 권한 정책이 실제 운영에 적용되었음을 **카탈로그와 실제 동작 양쪽으로** 검증 | 파일 존재는 배포 증거가 아니다 |
| B2 | 마이그레이션 원장과 원격 상태의 drift 해소 | 저장소만으로 원격 상태를 알 수 없다 |
| B3 | 백업 부재에 대한 데이터 손실 정책 확정 및 사용자 고지 | 예약 백업·PITR 제공 여부와 사용자 책임을 명확히 한다 |
| B4 | **정밀 위치 게이트** — §6 |
| B5 | **평문 영상 게이트** — §7 |
| B6 | 실제 두 계정으로 기록 → 상대방의 오늘 → 원본 → 삭제 → 내보내기 → 연결 해제 E2E 검증 | |
| B7 | 비공개 기록이 상대의 어떤 화면·요약·알림·메트릭에도 나타나지 않음을 **negative test로** 증명 | |
| B8 | 미확인 기계 추론 감정이 파트너 표면에 도달하지 않음을 테스트로 증명 | `PRODUCT_V3.md` §13 |
| B9 | P0-c의 PMK/CSK/HRK 회귀 테스트 통과 | |

---

## 5. PRODUCTION 게이트

Beta 게이트 전부 + 다음.

| # | 게이트 |
|---|---|
| R1 | Phase 1A에 대한 **독립 보안 리뷰** 통과 |
| R2 | Phase 1A 마이그레이션의 프로덕션 배포 승인 및 적용 검증 |
| R3 | 분실 기기 / 복구 kit 드릴 실제 수행 |
| R4 | 계정 삭제·데이터 내보내기 재검증 (E2EE 자료 포함) |
| R5 | Full User-Content E2EE를 주장한다면, 평문으로 남은 일반 사용자 콘텐츠 경로가 **0개**임을 감사 |

---

## 6. 정밀 위치 Beta 게이트

일반 제품 흐름이 승인된 프라이버시 아키텍처 밖에서 **정밀 위치를 평문으로 남겨서는 안 된다.**

외부 베타 이전에 다음 중 하나로 해소한다.

- **A.** 적절히 암호화한다.
- **B.** 정밀도를 낮추거나 비민감 메타데이터로 축소·제거한다.
- **C.** 정밀 평문 위치를 남기는 기능/입력을 비활성화한다.

> **"기능 동결"만으로는 불충분하다.** 사용자가 여전히 민감한 평문을 쓸 수 있다면 동결이
> 아니다.

여기서 새 암호 프로토콜을 설계하지 않는다. 게이트만 기록한다.

---

## 7. 평문 영상 Beta 게이트

Full User-Content E2EE 베타 이전에, 일반 사용자에게 **새 평문 영상 업로드 경로가 조용히
열려 있어서는 안 된다.**

선택지: 레거시 업로드 경로 비활성화 / 기존 영상 내보내기·마이그레이션 / 실수요가
정당화될 때만 암호화 영상 구현.

**정상적인 사용자 콘텐츠 영상 경로가 평문으로 살아 있는 동안에는 Full User-Content E2EE를
주장하지 않는다.** 사진·오디오는 독립적으로 진행할 수 있다.

---

## 8. 이 문서의 유지

- 순서를 바꾸면 **이유를 남긴다.**
- 제품 의도를 이 문서에 쓰지 않는다 → `PRODUCT_V3.md`.
- 현재 상태 사실을 이 문서에 쌓지 않는다 → `CURRENT_STATE.md`.
- 게이트를 통과하면 해당 행을 지우지 말고 통과 근거를 적는다.
