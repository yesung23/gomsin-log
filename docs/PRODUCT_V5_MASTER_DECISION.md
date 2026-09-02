# 곰신로그 V5 제품·사업·운영 마스터 결정

> 상태: **APPROVED DIRECTION / IMPLEMENTATION IN PROGRESS**
> 승인 근거: 2026-09-03 제품 오너의 명시적 전략 변경
> 적용 범위: 곰신로그 앱, 정원 상점, Book Studio, 온디바이스 AI, 미디어 보존,
> Apple 로그인·인앱결제, 운영 백엔드
> 사실 원칙: 이 문서는 앞으로 만들 제품을 결정한다. 현재 구현 여부는 코드와
> [`V4_AS_BUILT.md`](V4_AS_BUILT.md), 현재 배포 여부는 [`CURRENT_STATE.md`](CURRENT_STATE.md)가
> 최종 증거다.

## 1. 한 문장과 제품 루프

곰신로그는 **생활시간이 다른 두 사람이 놓친 하루를 부담 없이 복구하고, 오늘의 대화로
다시 연결하며, 둘이 직접 고른 시간을 오래 남길 수 있게 하는 사적인 커플 기록 서비스**다.

```text
가볍게 기록
→ 상대방의 오늘
→ 요약 항목
→ 정확한 원본 기록
→ 이따 이야기하기
→ 실제 대화
→ 둘이 직접 고른 기억 축적
→ 정원과 Memory Product에서 다시 만남
```

정원·AI·결제·책은 이 루프를 돕는 보조 표면이다. 어느 것도 관계 점수, 출석, streak,
읽음 압박, 감시, 공개 경쟁으로 바뀌지 않는다.

## 2. 이번 결정이 바꾸는 것

이 문서는 다음 과거 결정을 명시적으로 대체한다.

- 정원 상점은 영구 무료 전용이 아니다. **오리지널 또는 적법하게 라이선스된** 액세서리,
  상호작용 건물, 종이·계절 묶음을 유료로 판매할 수 있다.
- 선택형 `GomsinLog Plus` 구독을 검증·도입할 수 있다. 단, 저장용량·원본화질·보안·개인정보
  또는 핵심 연결 기능을 인질로 삼지 않는다.
- Book Studio는 post-PMF까지 동결하지 않는다. 앱 Release Candidate의 안전 게이트 이후
  다음 제품 단계로 진행한다.
- App Store 상품 승인이 아직 없어도 클라이언트·서버·복구·환불 경로는 **기본 OFF**로
  완성해 둔다. 실제 상품 ID와 승인 상태가 확인된 뒤에만 구매 버튼을 연다.

바꾸지 않는 결정:

- 무료 핵심 연결과 정상적인 사진 보존
- 사용자가 정확한 원본 기록과 순서를 직접 고르는 권리
- E2EE·프라이버시·내보내기·삭제의 무료 제공
- AI는 선택자가 아니라 편집 보조라는 경계
- 영상은 이번 Release Candidate의 핵심 범위가 아님
- CloudKit·전체 E2EE·Production 적용을 구현 사실처럼 주장하지 않음

## 3. 정보구조 결정

다섯 탭은 유지한다. 새로움을 위해 바꾸지 않는다.

| 탭 | 사용자가 얻는 답 | 1차 행동 |
|---|---|---|
| 홈 `/home` | 지금 우리에게 가장 중요한 것은? | 상대의 오늘 확인, 이어서 대화 |
| 찾기 `/search` | 예전에 남긴 무엇을 다시 찾을까? | 날짜·내용·복무 정보 검색 |
| 일기장 `/diary` | 오늘과 지난날을 어떻게 엮을까? | 날짜별 지면 편집, 정원 진입 |
| 일정 `/schedule` | 앞으로 무엇을 같이 기다릴까? | 일정·D-Day 준비 |
| 우리 `/us` | 우리가 함께 쌓은 것은? | 프로필·게시물·사진·여행·하이라이트 |

설정·계정·개인정보·구매 복원은 `우리 → 프로필 메뉴` 아래에 둔다. 작성은 탭이 아니라
맥락 행동(`/compose`)으로 유지한다. 정원과 Book Studio는 일기장의 축적 경험에서 들어가되,
결제 배너를 홈의 핵심 연결보다 앞세우지 않는다.

## 4. 무료와 유료의 경계

### 4.1 영구 무료 Core

- 텍스트·사진 기록과 정상적인 최적화 보존
- 상대방의 오늘, 정확한 원본, 이따 이야기하기, 통화 준비
- 검색, 기본 일정, 일기장, 기본 정원과 기본 상호작용
- 기본 종이와 무료 액세서리
- 프라이버시, E2EE 지원 범위, 동의 철회, 계정 삭제, 데이터 내보내기
- 규칙 기반 요약과 지원 기기의 선택형 온디바이스 보조
- 책에 넣을 기록·사진을 직접 고르고 기본 미리보기를 만드는 기능

무료 사용자는 기간 만료, 저장공간 게이지, 사진 저화질 강제, 관계 압박 때문에 결제하지
않는다.

### 4.2 1회 구매

| 상품 | App Store 유형 | 소유권 |
|---|---|---|
| 정원 액세서리·상호작용 건물·계절 묶음 | non-consumable | 구매한 곰신로그 계정이 영구 소유 |
| 종이·Book Studio 디자인 묶음 | non-consumable | 구매한 곰신로그 계정이 영구 소유 |
| 디지털 책 최종 내보내기 | consumable export credit | 구매 계정의 미사용 크레딧을 서버 원장에 보존 |
| 실물 책 제작·배송 | IAP가 아닌 실물상품 결제 | 주문자 계정의 주문·환불 원장에 보존 |

디지털 기능·콘텐츠는 앱 안에서 Apple IAP를 사용하고, 앱 밖에서 소비하는 실물 책은
Apple Pay 또는 일반 결제를 사용한다. 앱은 웹 결제로 디지털 상품 구매를 우회하도록
유도하지 않는다.

구매 권리는 **커플이 아니라 구매 계정**에 귀속된다. 활성 커플 정원에 구매 에셋을 배치하면
파트너도 그 공간에서 보고 상호작용할 수 있지만 소유권을 이전받지는 않는다. 연결 해제 시
공유 배치는 읽기 전용 archive로 보존하고, 구매자는 새 커플에 자신의 에셋을 새로 배치할 수
있으며 과거 커플의 배치·기억·상대 콘텐츠는 이동하지 않는다. 환불·revocation 시 원본 기록과
배치 행은 삭제하지 않고 해당 에셋만 비활성화해 무료 fallback으로 표시한다. 같은 original
transaction의 중복 전달은 권리를 중복 생성하지 않는다.

### 4.3 선택형 GomsinLog Plus

Plus는 저장공간 구독이 아니라 **계속 새로 제공되는 편집 경험**이다.

- 매달 갱신되는 계절·기념일 편집 라이브러리 접근
- Book Studio의 고급 조판, 색·글꼴·레이아웃 도구
- 사용자가 고른 기록만으로 만드는 월간/기념일 편집 초안
- 고급 회고·정리·검색 필터와 여러 Book Studio 프로젝트 관리
- Plus 기간에 제공되는 디지털 내보내기 혜택은 상품 메타데이터로 명확히 표시

구독이 끝나도 기록, 사진, 구매한 1회성 상품, 이미 완성·내보낸 책은 사라지지 않는다.
Plus 전용 템플릿을 쓴 초안은 읽을 수 있고 무료 템플릿으로 교체할 수 있다. 새 Plus 전용
편집과 새 내보내기 혜택만 중단한다.

초기 가격 가설은 월 `4,900원`, 연 `39,000원`이다. **확정 가격이 아니며** App Store 가격
포인트, 실제 전환, 수수료·세금·CS 원가를 검증한 뒤 catalog에서 정한다. 가격은 앱 코드에
하드코딩하지 않고 StoreKit 표시 가격을 그대로 보여 준다.

### 4.4 Book Studio 소유·동의·연결 해제 계약

Book Studio project는 시작한 **한 계정**이 소유하고 결제한다. 커플 공동 계정이나 공동
소유권을 새로 만들지 않는다. 다만 상대가 작성한 기록·사진을 책에 넣어 외부 파일 또는
인쇄물로 만드는 것은 기존 커플 화면 공유보다 목적과 유출 범위가 크므로 source owner의
project별 명시 동의가 필요하다.

| 상태 | 원본·미리보기·결제 계약 |
|---|---|
| 초안 시작 | project owner가 접근 가능한 항목을 후보로 고르되 자기 원본만 즉시 배치한다. 상대 원본은 `승인 대기` placeholder이며 export·주문 payload에 들어가지 않는다 |
| 상대 원본 승인 | source owner가 정확한 record/photo, crop, project, 사용 목적(디지털 export/실물 인쇄)을 확인해 항목별 또는 명시적 묶음으로 승인한다. 원본의 일반 `shared` 상태만으로 인쇄 동의를 추론하지 않는다 |
| 미리보기 공유 | 기본은 project owner 전용이다. owner가 명시적으로 공유한 경우에만 현재 partner가 read-only preview를 보며, 아직 승인되지 않은 상대 원본과 owner의 비공개 원본은 placeholder로 표시한다 |
| 최종 확정 | export 또는 주문 직전에 양쪽이 자신이 소유한 포함 원본과 crop을 다시 확인한다. 승인 receipt는 project/version/source id·hash·목적·시각만 보존하고 원문을 analytics/log에 복제하지 않는다 |
| 연결 해제 전 미완료 초안 | 즉시 동결한다. 각 사용자는 자기 원본과 자기 편집만 계속 볼 수 있고 상대 원본은 unavailable placeholder가 된다. project owner는 상대 원본을 제거·교체한 뒤 새 버전으로만 export/주문할 수 있다 |
| 연결 해제 전 완료 export | 당시 최종 승인을 거쳐 전달된 immutable 파일은 purchaser가 보유한다. 이미 다운로드되거나 전달된 사본은 원격 회수할 수 있다고 주장하지 않는다 |
| 결제 후 제작 중 실물 주문 | 최종 승인 뒤 print vendor에 전달된 주문은 연결 해제만으로 자동 취소하지 않는다. 취소·환불·재제작은 주문 상태와 vendor 정책을 따르고 배송 개인정보는 별도 처리자 계약·보존기간을 적용한다 |
| 계정 삭제 | 삭제 사용자의 원본은 미완료 project에서 제거·차단한다. 이미 적법하게 완성·전달된 파일·인쇄물은 원격 회수할 수 없으며, 미처리 주문·세무·분쟁 원장은 법정 필요 범위만 별도 보존한다 |

상대는 승인 전 언제든 거절할 수 있고, 최종 확정 전에는 자기 원본 승인을 철회할 수 있다.
철회는 원본 기록을 삭제하지 않고 해당 project version만 export/order 불가로 만든다. 최종
승인·전달 이후의 회수 불가능성은 확인 화면에서 미리 고지한다. 새 커플에는 과거 project,
상대 원본, 승인 receipt, 완성본을 자동 이전하거나 노출하지 않는다.

## 5. App Store 결제 계약

### 5.1 활성화 방식

- `VITE_APPLE_IAP_SALE_ENABLED === 'true'`인 서명된 배포 구성에서만 새 구매 CTA와 판매
  catalog를 연다. query string, localStorage, cookie로 이 gate를 우회하지 않는다.
- 반면 StoreKit transaction listener, `currentEntitlements`, 구매 복원, 환불·revocation
  reconciliation은 native 로그인 세션에서 항상 살아 있어야 한다. 판매 OFF나 상품 심사 중인
  상태가 기존 구매자의 권리를 지우거나 복원을 막아서는 안 된다.
- App Review·Sandbox용 서명 빌드는 별도 build configuration으로 심사 상품을 조회·구매할 수
  있게 하고, 일반 Production 판매 CTA는 App Store Connect의 실제 상품 ID·계약·세금·은행·
  심사 상태를 확인하기 전까지 OFF로 둔다.
- entitlement 판정 자체를 끄는 kill switch는 두지 않는다. 사고 시에는 신규 판매만 닫고,
  검증·복원·환불 서비스는 유지한다.
- consumable, non-consumable, auto-renewable subscription, non-renewing subscription 각
  유형의 첫 상품은 새 앱 버전과 함께 심사에 제출하고 Sandbox/TestFlight 및 App Review
  경로를 먼저 검증한다.

### 5.2 신뢰 경계

```text
StoreKit 2 구매
→ 검증된 Transaction
→ appAccountToken으로 현재 곰신로그 계정 연결
→ 서버가 Apple JWS를 검증
→ 원본 transaction id 기준 멱등 원장 기록
→ 서버 entitlement를 authoritative 상태로 계산
→ 클라이언트가 서버 상태를 새로 읽은 뒤 기능 개방
```

클라이언트의 `purchased=true`, 로컬스토리지, 화면 상태만으로 유료 기능을 열지 않는다.
서버는 Apple App Store Server Notifications V2를 받고, 누락 대비 주기적 reconciliation을
수행한다.

### 5.3 최소 서버 원장

- `apple_product_catalog`: 내부 상품과 Apple product id, 종류, 버전, 판매 상태
- `apple_transactions`: original/transaction id, product id, app account token hash,
  구매·만료·취소·environment, 마지막 검증 시각
- `apple_subscription_state`: 현재 구독 그룹 상태와 갱신 정보
- `apple_notifications`: notification UUID, type/subtype, 수신·검증·처리 상태, 재시도 횟수
- `entitlements`: 사용자별 계산된 권리와 출처 transaction
- `memory_product_orders`: 디지털 내보내기·실물 주문·취소·환불의 별도 상태머신

전체 결제카드 정보, Apple 계정 비밀번호, 사용자 콘텐츠, 영구 보관할 필요가 없는 raw JWS는
저장하지 않는다. 보존기간은 세무·분쟁·환불 의무를 확인한 뒤 개인정보 처리방침과 운영
runbook에 명시한다.

### 5.4 복원·환불·가족공유

- 앱에 `구매 복원`을 항상 제공하고 StoreKit sync 후 서버 재검증을 실행한다.
- `REFUND` 또는 revoked transaction은 entitlement를 회수한다.
- `REFUND_REVERSED`는 같은 원장을 통해 다시 부여한다.
- 이미 존재하는 기록·정원 배치·책 원본을 환불 때문에 삭제하지 않는다. 유료 에셋이 없어진
  자리에는 안전한 무료 fallback을 표시하고 배치 정보는 보존한다.
- consumable 크레딧은 Apple 자동 복원에 의존하지 않고 서버 원장으로 미사용 잔액을 복구한다.
- 미사용 export credit은 만료시키지 않는다. 환불된 미사용 credit은 원장 보정으로 회수하고,
  이미 사용한 credit의 환불은 완성본이나 원본 기록을 삭제하지 않는다. Apple의 consumption
  information 요청에는 사용 여부·전달 상태만 최소화해 답하며, Apple이 요구하는 사용자 동의
  절차와 최신 API 계약을 release gate에서 검증한다.
- 가족공유는 상품별 명시 결정 전에는 OFF로 가정하며 코드가 임의로 공유하지 않는다.

## 6. 정원 제품과 런타임 규격

정원은 retention game이 아니라 **둘의 기억이 다시 모습을 갖는 조용한 공간**이다.

### 6.1 콘텐츠 원칙

- 캐릭터·건물·액세서리·종이는 자체 제작 또는 상업적 사용권과 2차적 저작물 권리가
  확인된 것만 배포한다.
- 캐릭터를 유료로 파는 행위 자체가 저작권 침해를 만드는 것은 아니다. 권리 없는 캐릭터는
  무료 배포도 위험하다. 캐릭터 판매는 chain-of-title이 확인될 때까지 보류하고, 우선
  액세서리·건물·종이를 판매한다.
- 확률형 유료 뽑기, 유료 재화, streak 보상, 관계 점수는 만들지 않는다.
- 매일 접속을 재촉하는 뽑기·출석 보상은 무료라도 만들지 않는다. 기본 starter set과
  둘이 남긴 실제 기억에 연결된 유한한 무료 collection만 제공하고, 놓친 날에 손해가 없다.
- V4의 하루 한 번 무작위 액세서리 뽑기는 RC 전에 제거한다. 이미 얻은 액세서리는 보존하고,
  같은 무료 starter set은 날짜 제한 없이 사용자가 원하는 항목을 직접 받는 상시 보관함으로
  전환한다. 과거 `lastFreeDrawDate` 값은 권리나 노출 여부를 제한하는 입력으로 쓰지 않는다.

### 6.2 월드 좌표와 에셋 manifest

- 논리 월드: `1200 × 720` 단위, 반응형 화면에 letterbox 없이 cover-fit 후 safe bounds 계산
- 배치 grid: `24 × 14`, 셀 `50 × 50`인 `1200 × 700` playable area와 상하 `10` safe margin;
  저장은 grid 좌표와 회전, asset version
- 캐릭터 기본 footprint: `72 × 88`; anchor는 발 중앙 `(0.5, 0.92)`
- 소형 장식: `1×1~2×2`, 일반 건물 `3×2~4×3`, 대형 상호작용 건물 최대 `6×4`
- 모든 에셋은 visual bounds와 collision footprint를 별도로 가진다.
- 캐릭터와 상호작용 건물은 approach/interaction slot을 명시한다.

필수 manifest 필드:

```ts
type GardenAssetManifest = {
  schemaVersion: 1;
  id: string;
  version: number;
  kind: 'paper' | 'accessory' | 'decoration' | 'building';
  art: { src: string; width: number; height: number; anchorX: number; anchorY: number };
  placement: { cols: number; rows: number; collision: 'none' | 'solid' | 'interaction' };
  interaction?: {
    action: 'sit_pair' | 'swim_pair' | 'picnic_pair' | 'tea_pair' | 'rest_pair';
    slots: Array<{ x: number; y: number; facing: 'left' | 'right' | 'front' | 'back' }>;
  };
  accessibility: { label: string; reducedMotionLabel: string };
  provenance: { rightsRecordId: string; sha256: string };
};
```

manifest에는 비공개 계약서나 개인정보를 넣지 않는다. 별도 `asset_rights_ledger`가 저작자·
계약 상대방, 원본 출처, 계약/영수증, 상업 이용·재판매·수정·2차적 저작물·지역·기간·매체·
AI 사용 여부, 검토자와 검토일을 보관한다. 필요한 권리가 하나라도 불명확하면 catalog 상태는
`rights_hold`이며 판매·배포할 수 없다. hash와 자유형 license 문자열만으로 권리를 증명했다고
보지 않는다.

### 6.3 캐릭터 상태머신

```text
idle → walk → approach → interact-enter → interact-loop → interact-exit → idle
  └──────────────── picked-up / drag ────────────────┘
```

- 경계·고체 충돌·다른 캐릭터 footprint를 통과하지 않는다.
- 같은 목적지 반복과 기계적 왕복을 피하도록 최근 목적지와 행동을 짧게 기억한다.
- 벤치·수영장 등은 두 자리 모두 접근 가능한 경우에만 pair 행동을 시작한다.
- 탭은 짧은 반응, 길게 누르기는 들어 올리기, 드래그는 배치가 아니라 캐릭터 상호작용이다.
- `prefers-reduced-motion`에서는 자동 배회와 loop animation을 끄고, 사용자가 누른 동작을
  정적인 단계 전환과 텍스트 상태로 제공한다.
- 모든 조작은 44×44pt 이상이며 키보드·VoiceOver용 `행동 선택` 목록을 같은 기능으로 제공한다.
- 보이지 않는 탭이나 background에서는 animation clock과 pathfinding을 정지한다.

### 6.4 첫 상품군

- `꽃신의 봄`: 벚꽃길, 꽃그늘 벤치, 꽃 장식, 벚꽃 편지지
- `여름 물가`: 작은 수영장, 함께 수영, 밀짚모자, 물결 편지지
- `가을 소풍`: 피크닉 매트, 함께 앉기, 목도리, 크라프트·체크 종이
- `겨울 온기`: 화로·찻상, 함께 쉬기, 귀마개, 눈 내린 편지지

각 묶음은 개별 에셋의 provenance와 접근성 대체동작을 통과해야 catalog에 등록된다.

## 7. 사진 저장과 Book Studio 인쇄 품질

### 7.1 기본 저장

- 업로드 전 클라이언트에서 방향을 바로잡고 EXIF를 제거하며 재인코딩한다.
- 일반 화면용 master는 우선 긴 변 `2560px` 목표로 실기기 크기·품질을 벤치마크한다.
- 목록용 `640px` thumbnail을 별도 생성해 같은 큰 파일을 격자마다 내려받지 않는다.
- 원본 파일명·GPS·불필요한 EXIF는 서버로 보내지 않는다.
- 업로드는 object UUID, checksum, variant, width/height/bytes, content type을 metadata로 기록하고
  재시도는 멱등 처리한다.
- 레코드 저장 실패 또는 취소로 고아가 된 object는 quarantine 후 주기적으로 정리한다.

현재 코드는 2048px JPEG screen master 하나를 저장하며 별도 thumbnail metadata가 없다.
따라서 2560/640 정책은 **계획·벤치마크 단계**이고 구현 완료가 아니다.

### 7.2 책 품질

모든 원본을 7일 또는 30일간 서버에 자동 보관하지 않는다. 비용·프라이버시·E2EE 복잡도가
커지고 실제 책 선택 전 대부분 버려지기 때문이다.

```text
평소: 최적화 screen master + thumbnail 보존
→ 사용자가 책에 정확한 사진과 crop을 선택
→ Book Studio가 실제 인쇄 크기의 effective PPI 검사
→ 부족한 사진만 Photos에서 원본 재선택 요청
→ 임시 print master를 암호화 업로드
→ 제작·재인쇄 기간 뒤 자동 삭제
```

- A5 한 면에서 300PPI를 목표로 하고 240PPI 미만은 경고, 180PPI 미만은 최종 주문을 막는다.
- spread·full-bleed는 crop 뒤 유효 픽셀로 다시 계산한다.
- 기존 2048px 사진은 작은 배치에 그대로 쓸 수 있고, 큰 배치에서만 재선택을 요청한다.
- 임시 print master는 구독 등급이 아니라 사용자가 시작한 정확한 book project/order에 묶는다.
- 주문 취소·환불·미완료 만료 시 print artifact만 삭제하고 원본 기록과 일반 화면용 사진은
  삭제하지 않는다.
- 향후 E2EE에서는 derivative 생성·암호화를 클라이언트에서 수행하고 서버는 opaque blob만
  저장한다.

## 8. 온디바이스 요약

### 8.1 확정 역할

AI는 원문 대신 무엇이 중요하다고 고르지 않는다. 먼저 권한이 확인된 적격 원문 전체를
시간순으로 규칙 기반 구성하고, 사용자가 버튼을 누를 때 **같은 항목 수·같은 순서·같은
원본 연결을 유지한 채 문장만 압축**한다.

- 모델 입력에 record id, 사용자 id, 커플 id, 날짜, 위치 metadata를 넣지 않는다.
- 숫자·시각·고유명사·부정 표현을 보존한다.
- 감정, 관계 상태, 진단, 숨은 의도를 추론하지 않는다.
- 한 항목이라도 검증에 실패하면 전체 batch를 버리고 규칙 결과를 유지한다.
- cloud AI fallback은 두지 않는다.
- 건강·주기·성적·정확 위치 등 민감 분류를 확실히 제외할 수 없으면 그날 전체를 규칙 결과로
  유지한다.

### 8.2 활성화 게이트

`VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED === 'true'`인 검증 빌드에서만 버튼을 연다. 실물
지원 iPhone의 한국어 의미 보존, airplane mode 무전송, cold/warm latency, 취소, 메모리,
발열·배터리 테스트 전에는 기본 OFF다. 미지원 기기는 설명 없이 열화된 cloud 경로로 보내지
않고 같은 규칙 요약을 사용한다.

## 9. 여행 OCR

- iOS: PhotosPicker의 사용자가 고른 이미지에 한해 Vision OCR을 우선한다.
- Web/PWA: 현재의 로컬 Tesseract를 fallback으로 유지한다.
- 여러 장은 사용자가 고른 순서를 보존하고 각 장의 후보를 독립적으로 만든다.
- OCR 결과는 `장소명 / 주소 / 영업시간 / 날짜·시각 후보 / 출처 이미지 순번 / confidence`인
  로컬 draft다.
- OCR 사진 원본과 bounding box는 서버에 저장하지 않는다.
- 장소 중복·낮은 confidence·서로 충돌하는 날짜는 자동 합치지 않고 사용자에게 표시한다.
- **사용자가 확인하고 저장을 누르기 전에는 DB write가 0건이어야 한다.**
- GPS EXIF를 읽어 여행을 자동 생성하지 않는다. 미래에 별도 동의와 목적 제한을 승인하기
  전까지 위치 metadata는 제거한다.

## 10. 생리주기 예측과 건강 데이터

이 기능은 의료 진단이나 피임 도구가 아니다. 원본 주기·증상·통증·출혈·메모와 여기서
계산한 예상은 소유자만 본다. 현재 동의·고지는 건강 파생정보의 자동 partner provision을
허용하지 않으므로 `현재 생리 여부`, `예상 범위`, `가임 추정` 자동 공유는 모두 닫는다.
파트너에게 갈 수 있는 것은 사용자가 그날 직접 고른 짧고 만료되는 배려 신호뿐이며,
이 신호는 원본 주기에서 계산하지 않는다.

예측 원칙:

- 실제 생리 **시작일**만 다음 시작 범위 계산에 사용한다. 종료일은 기간 기록에만 쓴다.
- 증상-only 기록은 생리 기간을 생성·연장하거나 예측을 바꾸지 않는다.
- 유효한 실제 시작일이 0~2개면 `기록이 더 필요해요`만 보여주고 날짜나 범위를 만들지 않는다.
- 미래·중복·잘못된 달력 날짜는 입력으로 쓰지 않는다. 최근 최대 13개 시작일에서 최대 12개
  간격만 보고, 최신 간격부터 거꾸로 이어진 `15~60일` 연속 구간을 사용한다. 중간의 비정상
  간격을 건너뛰어 오래된 기록과 최근 기록을 임의로 연결하지 않는다.
- 최근 유효 간격이 2개 미만이면 날짜를 보류한다. 충분하면 중앙값을 대표값으로 두고,
  `최근 시작일 + (관측 최솟값 - 2일)`부터 `최근 시작일 + (관측 최댓값 + 2일)`까지를
  참고 범위로 표시한다.
- 범위가 양 끝을 포함해 14일을 넘거나 범위 전체가 이미 지났다면 날짜를 보류한다.
- 하나의 확정일이나 확률형 신뢰도(`낮음/보통/높음`)를 표시하지 않는다. 근거는 최근 실제
  시작 간격 개수와 관측 범위만 사실 그대로 보여 준다.
- 모든 날짜 계산은 timezone/DST에 흔들리지 않는 UTC calendar arithmetic을 사용한다.
- 배란일·가임기·안전한 날·임신 가능성은 계산하거나 표시하지 않는다.
- 불규칙성, 산후, 임신 가능성, 호르몬 치료·피임 등 의료적 상황을 앱이 추론하지 않는다.
  향후 `예측 쉬기`를 추가하더라도 본인 기기 표시만 제어하고 원본을 삭제하지 않는다.
- 정확도 개선을 위해 서버에 원본 건강정보나 개별 `예측 오차 일수`를 보내지 않는다.
  제품 계측은 별도 명시 동의와 재식별 위험 검토 전까지 추가하지 않는다.

현재 고정 알고리즘 버전은 `v4.0.0-owner-only`다. 변경하려면 이 절, deterministic fixture,
민감정보 negative test와 독립 privacy/security review를 함께 갱신한다.

## 11. Apple 로그인과 계정 경계

- 목표 상태에서는 iOS 시작 화면에 Apple 로그인을 Google과 동등하게 제공한다.
- 현재 Supabase Apple OAuth 코드가 존재하는 것과 Apple provider가 Production에서 실제
  설정·동작하는 것은 별개다. 원격 상태는 확인 전 `UNVERIFIED`다.
- 가능하면 native Sign in with Apple credential을 Supabase session으로 교환하고, web/PWA는
  OAuth PKCE를 사용한다.
- Apple이 이름을 처음 한 번만 줄 수 있으므로 최초 성공 시에만 사용자 확인을 거쳐 저장한다.
- private relay email 때문에 이메일이 같다는 이유만으로 Google 계정과 자동 병합하지 않는다.
  로그인된 사용자의 명시적 `로그인 방법 연결`과 재인증을 요구한다.
- 로그아웃·계정삭제·연결해제·도난기기·토큰 revoke 경로를 테스트한다.
- 계정삭제 시 Sign in with Apple refresh/access token revoke 의무를 서버에서 수행하고 실패는
  재시도 가능한 삭제 작업 원장에 남긴다.

### 11.1 현재 managed Supabase 제약과 활성화 HOLD

2026-09-03 공식 문서와 현재 코드 검토 기준, managed Supabase Auth는 검증된 동일 이메일의
OAuth identity를 자동 연결할 수 있지만 이를 프로젝트 단위로 안전하게 끄는 일반 설정은
문서화·실증되지 않았다. open-source GoTrue의 실험적 provider-linking domain 설정이 managed
프로젝트에서 지원된다고 가정하지 않는다.

- Apple 로그인 코드는 `default OFF`로 준비할 수 있지만 Production provider와 사용자 CTA는
  활성화하지 않는다.
- 로그인 전 클라이언트 이메일 비교, `Before User Created` hook, redirect 후 확인 화면은 이미
  일어난 서버측 자동 병합을 되돌릴 수 없으므로 안전 경계의 대체물이 아니다.
- 명시적 연결은 기존 로그인 세션에서 재인증을 거쳐 시작하고, 취소·충돌·다른 계정·relay
  email·기존 Apple identity를 각각 테스트한다.
- 활성화 전에는 managed Supabase가 자동 병합을 끌 수 있는 공식 지원 경로를 제공하는지
  재확인하고, staging의 서로 다른 두 계정으로 silent merge가 일어나지 않음을 실측한다.
- 이 조건과 Apple token revoke를 포함한 계정 삭제 복구 테스트가 통과하기 전까지
  **V5-B, Apple Production 활성화, App Store 제출은 HOLD**다.
- 이 제약만 피하려고 Auth를 self-host하거나 자체 OAuth broker를 도입하지 않는다. 그런 변경은
  auth.uid(), RLS, 세션 복구, E2EE device binding 전체를 다시 검증해야 하는 별도 아키텍처
  결정이다.

## 12. 서버·비용·운영 구조

초기에는 별도 대형 백엔드를 만들지 않고 Supabase 경계를 유지한다.

```text
React/Capacitor
→ Supabase Auth
→ Postgres + RLS/RPC
→ Realtime
→ private Storage
→ Edge Functions (결제 검증·notification·삭제/정리 작업)
```

StoreKit 검증, App Store notification, orphan cleanup, print-master lifecycle은 Edge Function과
Postgres job/외부 scheduler의 멱등 작업으로 둔다. service-role은 서버 작업 안에서만 사용하고
클라이언트 번들에 넣지 않는다.

서버가 수용할 사용자 수는 마케팅 숫자로 추측하지 않는다. 실제 Supabase plan, DB 크기,
storage egress, Realtime peak, 사진 평균 bytes가 확인돼야 한다. 운영 gate는 다음 식과 단계로
관리한다.

```text
월 신규 storage = 업로드 사진 수 × screen master 평균 bytes
월 egress = 조회된 thumbnail/master 수 × 각 평균 bytes
DB write TPS = 기록 + 일정 + 배치 + entitlement + notification peak
Realtime peak = 동시에 열린 커플 화면 × 채널/이벤트 수
```

- Stage A: 내부/최대 100커플 — 기능·권한·삭제·백업 복원 검증
- Stage B: 최대 1,000커플 — 부하·비용 baseline, alert, notification replay, storage lifecycle 검증
- Stage C: 최대 10,000커플 — 측정값으로 DB compute/connection pool/CDN·image egress를 증설
- 다음 단계는 숫자 도달만으로 열지 않고 p95 latency, 오류율, connection saturation,
  storage/egress 비용, restore drill이 모두 gate를 통과해야 한다.

초기 SLO 후보:

- 핵심 읽기·쓰기 성공률 99.9% (클라이언트 오류 제외, 28일 window)
- 일반 API p95 800ms 이하, 핵심 쓰기 p95 1.5s 이하
- App Store notification 99%를 5분 안에 처리하고 실패는 idempotent replay
- RPO 24시간 이하, RTO 4시간 이하를 복구훈련으로 증명

이는 Production 달성 사실이 아니라 출시 전 검증 목표다. 정확한 plan별 수용량과 월 비용은
실제 project metrics와 load test 전까지 `UNVERIFIED`다.

## 13. 수집하는 데이터와 수집하지 않는 데이터

### 서비스 제공에 필수인 데이터

- 인증·계정·활성 커플·권한·동의 revision
- 사용자가 작성한 기록과 사용자가 선택한 공유 범위
- 파일 variant/크기/checksum/보존 상태 같은 운영 metadata
- 결제 transaction/entitlement/order/refund의 최소 원장
- 보안·장애 대응에 필요한 콘텐츠 없는 짧은 보존 운영 event: event type, error code,
  latency bucket, app/build/platform, 무작위 request id

필수 인증·권한·결제·삭제 원장은 서비스 계약 수행과 법적 의무 범위에서 처리하며 마케팅
동의와 섞지 않는다. 운영 event에도 기록 ID, 사용자 작성문, 파일명, URL, 정확 시각·위치 같은
재식별 가능 콘텐츠를 넣지 않고 보존기간과 접근 역할을 별도 runbook에 고정한다.

### 선택형 제품 개선 데이터

- 기록 완료, 정확한 원본 이동, 이야기거리 추가, Book Studio 시작·완성 같은 집계 event는
  별도 명시적 opt-in일 때만 수집한다.
- 기본값은 OFF이고 동의하지 않아도 기능·가격·지원에 불이익이 없다. 설정에서 철회하면 새
  수집을 즉시 멈추며, 이미 집계·비식별화된 통계와 삭제 가능한 개인 event의 경계를 고지한다.
- 마케팅 attribution·광고 ID·cross-app tracking은 현재 범위에 도입하지 않는다.

### 수집하지 않는 데이터

- 관계·애정 점수, 이별 예측, 몰래 계산한 열람 패턴
- 기록·사진 OCR·건강 메모의 평문 analytics/log
- 연락처 전체, 다른 앱 사용, 정확 위치, 광고 ID
- AI가 만든 중요도·감정 라벨
- 결제카드 원문과 불필요한 Apple payload

필수 운영 telemetry, 선택형 제품 analytics, 마케팅 처리는 목적·동의·보존·접근권한을 서로
분리한다. 사용자 콘텐츠를 URL, push payload, crash log, analytics property에 넣지 않는다.

## 14. 구현 순서와 Release Gate

1. OCR 명시 저장과 온디바이스 AI default-OFF 안전장치
2. 이 문서와 사업·엔지니어링 canonical 문서 정합성
3. Apple 로그인 실경로와 계정 연결/삭제 검증
4. StoreKit bridge + 서버 entitlement/notification/refund 원장 (기본 OFF)
5. 정원 manifest·충돌·상호작용 상태머신 + 무료 첫 건물
6. 서버 동기화 정원 layout과 non-consumable catalog
7. thumbnail·media metadata·orphan cleanup·print quality gate
8. iOS Vision 기반 다중사진 OCR review flow
9. 소유자 전용 주기 예측 V4의 deterministic fixtures와 privacy negative tests
10. 실제 iPhone light/dark/small/large/VoiceOver/Dynamic Type/reduced motion 검증
11. 구현자와 독립된 고추론 성능·보안·전체코드 review
12. `GOMSINLOG RELEASE CANDIDATE` 판정
13. Book Studio를 exact-source selection과 print-quality contract 위에서 완성

다음은 외부 승인 없이는 실행하지 않는다.

- Production Supabase migration·secret·provider 변경
- 실제 IAP 상품 생성·가격 확정·심사 제출·판매 개시
- POD 계약·실물 결제·배송 개인정보 처리 시작
- TestFlight/App Store 제출
- master merge와 Production 배포

## 15. 공식 기준

- Apple App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- In-App Purchase types: <https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-types>
- First IAP submission: <https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase>
- StoreKit current entitlements: <https://developer.apple.com/documentation/storekit/transaction/currententitlements>
- App Store Server Notifications V2: <https://developer.apple.com/documentation/appstoreservernotifications/receiving-app-store-server-notifications>
- App Store Server API: <https://developer.apple.com/documentation/appstoreserverapi>
- Sign in with Apple account deletion: <https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple>
- Supabase Apple Auth: <https://supabase.com/docs/guides/auth/social-login/auth-apple>
- Supabase identity linking: <https://supabase.com/docs/guides/auth/auth-identity-linking>
