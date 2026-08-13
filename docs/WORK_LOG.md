# 작업 기록 (Work Log)

> AI 에이전트가 수행한 작업의 누적 기록. `CLAUDE.md`의 지시에 따라 유지한다.
>
> **이 문서는 "무엇을 했는가"의 기록이다.** 제품 의도는
> [`PRODUCT_V3.md`](PRODUCT_V3.md), 저장소 현실은
> [`CURRENT_STATE.md`](CURRENT_STATE.md), 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)가 각각 canonical이다.
> 여기에 제품 결정을 새로 쓰지 않는다.

---

## 수정 사항이 기록되는 곳 — 우선순위

작업 내용은 원래 아래 다섯 곳에 나뉘어 기록된다. 이 문서는 그것들을 **가리키는
색인**이지, 대체물이 아니다.

| 무엇 | 어디 | 성격 |
|---|---|---|
| 변경의 이유와 근거 | **git commit message** | 영구. 가장 자세하다 |
| 변경 묶음의 요약·검증 결과 | **PR 본문** | 영구 |
| 코드가 왜 그렇게 생겼는지 | **해당 파일의 주석** | 영구. 코드와 함께 이동 |
| 현재 저장소의 결함·미구현 | [`CURRENT_STATE.md`](CURRENT_STATE.md) | 휘발성. 해소되면 삭제 |
| 마이그레이션 적용 상태 | [`../supabase/migrations/README.md`](../supabase/migrations/README.md) | Git 추적 ≠ 운영 적용 |
| 세션 단위 작업 색인 | **이 문서** | 누적 |

---

## 세션 기록

### 2026-08-13 · PR #52 (2차) — 보안 계약 결함 3건 정정

같은 PR·같은 브랜치에서 초판 계약의 보안 결함 세 가지를 정정했다. 셋 다 문구 문제가
아니라 **실제 모순**이었다. 문서만 변경, 소스·마이그레이션 없음.

| # | 결함 | 왜 실제 모순인가 | 결정 |
|---|---|---|---|
| A | "채팅에 write floor가 필요 없다" | 032의 write floor는 평문 강등 방어와 **R5 EPOCH**(032:163-182) 두 책임을 지는데 초판은 전자만 보고 판단했다. 채팅이 born-encrypted인 것은 후자와 무관하다 — 폐기·stale 기기가 옛 epoch로 계속 쓰는 것을 막지 못했다 | GLE1 헤더 **직접 검증**(Option A). 메타데이터 필드 증가 없음 |
| B | tombstone 표현 미정의 | 초판은 tombstone을 도입하고 그 상태가 어디 사는지, 누가 만들 수 있는지, 되돌릴 수 있는지를 전부 비워 뒀다. "전송 후 불변"과 tombstone UPDATE도 서로 모순인 채였다 | `ciphertext IS NULL`이 유일한 표현. **원작성자만**, **단방향** |
| C | `sender_user_id` CASCADE | `PRODUCT_V3.md` §14.4 "커플 소유/공유 객체는 남은 파트너가 있으면 유지된다"와 정면 충돌. 한쪽 탈퇴가 남은 파트너의 대화 절반을 파괴했다 | `ON DELETE SET NULL` |

**기각한 대안**

- **A / Option B(`key_epoch` 컬럼 복제):** 복제 컬럼은 헤더와 어긋날 수 있고 어긋나지
  않음을 증명하려면 결국 헤더를 읽어야 한다. "Option A + 중복 컬럼 + 정합성 검사"라
  엄격히 더 나쁘다. `daily_records`가 컬럼을 쓰는 것은 필드별 암호문이 여럿이고 평문
  행과 공존해야 하는 사정 때문이며 채팅에는 없는 사정이다.
- **B / `is_deleted`·`deleted_at` 추가:** 여섯 필드 예산을 늘리면서 얻는 것이 없다.
  `NULL`은 INSERT 검증 때문에 "malformed/pending"을 뜻할 수 없어 이미 모호하지 않다.
- **B / 수신자도 delete-for-both 허용:** 한쪽이 상대가 작성한 관계 히스토리를 일방적으로
  파괴할 수 있게 된다. 수신자의 실제 요구는 로컬 숨기기로 충족된다.
- **C / 작성자를 생존자로 이전:** 히스토리 위조다.

정직하게 남긴 한계: 서버는 암호문이 실제로 열리는지 확인할 수 없어, 커플 구성원은
복호화 불가능한 행을 밀어넣을 수 있다. 기밀성 우회가 아니라 신뢰 경계 안의 자해성
DoS이고 해법은 rate limit이다. 위협 모델에 19번으로 명시했다.

위협 모델 16 → **25가지**, 게이트 C1–C9 → **C1–C12**(C10 epoch / C11 tombstone /
C12 계정 삭제). 실제 DB 증명은 구현 시점의 몫이고 이 PR에서 구현하지 않았다.
**운영 변경 없음.**

---

### 2026-08-13 · PR #52 — 채팅 제품·데이터·E2EE 계약 (P4)

**목표:** 채팅을 만드는 것이 아니라, P5(daily_records E2EE)·P6(암호화 사진)이 채팅
구조를 재설계하지 않아도 되도록 그 전에 최소한의 올바른 계약을 고정하는 것.
**코드·스키마·마이그레이션 없음.**

| 파일 | 변경 |
|---|---|
| `docs/CHAT_PRODUCT_DATA_CONTRACT_V1.md` | 신규. 22개 절(§0–21), 약 630줄 |
| `docs/PRODUCT_V3.md` | §12.1이 계약을 가리키도록 한 줄 |
| `docs/ENGINEERING_ROADMAP.md` | P4 행에 산출물·게이트 C1–C9·P5 독립성 명시 |
| `docs/CURRENT_STATE.md` | 채팅 미구현 갱신, PR #50으로 해소된 행 삭제, #17 심각도 정정 |

#### 저장소 조사에서 나온 결정적 사실

채팅은 백지 상태다(테이블·라우트·UI·레거시 스키마 전부 없음). 그보다 중요한 발견은
**연결이 해제된 커플은 되살아날 수 없다**는 것이다. 초대 코드를 발행하는 세 경로가 모두
active 멤버십을 요구하고(`regenerate_invitation` 013:277-279, `create_invitation`
030:34, `create_couple_and_invitation`은 항상 새 couple_id 생성), 멤버십을 active로
되돌리는 유일한 방법이 초대 소비(001:357 / 002:18 / 006:111 / 015:219)이기 때문이다.
`disconnect_couple`은 양쪽을 모두 disconnected로 만든다.

→ **재연결은 항상 새 couple_id = 새 CSK 스코프**이며, 채팅이 관계 경계를 넘는 경로가
구조적으로 존재하지 않는다. 정책으로 고른 것이 아니라 코드가 이미 강제하는 사실이다.
초안에 "같은 커플이 재활성화되면 히스토리가 돌아온다"고 썼던 것은 **도달 불가능한
상태를 서술한 오류**였고 정정했다. `CURRENT_STATE` #17도 "누출 위험"이 아니라 "상태
일관성 문제"로 심각도를 낮췄다.

#### 핵심 결정

- **새 scope도 새 봉투 형식도 만들지 않는다.** 기존 CSK + GLE1을 쓰고, 채팅은 GLE1
  AAD가 이미 묶는 `object type` 하나를 추가할 뿐이다. A(공유 CSK) vs B(전용 스코프)를
  8개 기준으로 비교해 A를 선택했다 — 신뢰 경계가 동일해 **blast radius조차 줄지 않는데**
  프로토콜만 두 벌이 되기 때문.
- 서버가 보는 것은 6개 필드뿐: `message_id / couple_id / sender_user_id / ciphertext /
  ordinal / created_at`. `message_type`·`reply_to`·`context`·`nonce`·`crypto_version`·
  `sender_device_id`를 전부 암호문 또는 GLE1 헤더로 밀어냈고, 각 필드마다 "암호문으로
  옮길 수 있나 / 보존 정책"까지 표에 적었다.
- **write floor가 필요 없다**는 것을 명시. 032가 필요했던 이유는 daily_records에 평문
  컬럼이 이미 있었기 때문이고, 채팅은 태어날 때부터 암호화라 내려갈 곳이 없다.
- 수정은 V1 연기하되 **구조적 막다른 길이 아님**을 근거와 함께 기록. 미래 구현자에게
  "계약 개정 없이 ciphertext UPDATE를 추가하지 말 것"을 명문화했다.
- 순서는 서버 `ordinal`, 클라이언트 시계는 순서에 쓰지 않는다. 대기 메시지는 목록 맨
  아래에 두었다가 ordinal을 받으면 제자리로 — 시계를 믿고 잘못 확정하는 것보다 정직하다.

#### 삭제 설계를 뒤집은 것

초안은 하드 삭제였다(tombstone = "여기 메시지가 있었다"는 영구 메타데이터라고 판단).
두 가지가 그 판단을 뒤집었다:

1. **하드 삭제는 전파되지 않는다.** 이미 동기화해 간 상대는 삭제를 알 신호가 없어
   영원히 들고 있게 된다. 상대 화면에 반영되지 않는 삭제는 삭제가 아니다.
2. **published 테이블의 DELETE payload에는 RLS가 적용되지 않는다** —
   015가 `public.events`를 publication에서 뺀 바로 그 이유
   (`privacy-access-matrix.md` §F). 하드 삭제는 그 함정에 다시 들어간다.

그리고 privacy 비용은 작다: 서버는 그 행의 존재를 **이미** 알고 있었고, tombstone이 새로
알려주는 것은 "지워졌다"뿐이며 암호문은 실제로 사라진다. → tombstone으로 변경.

#### 검증

내부 §참조 전수 검사(22개 절, 미해결 0 — 초안에서 절 번호가 밀린 교차참조 약 20건을
찾아 수정), 로컬 md 링크 전수 확인, 계약의 사실 주장을 코드와 대조(GLE1 AAD·epoch
헬퍼·PRODUCT_V3 §20·오버헤드 108B·초대 3경로 line number·disconnect 양쪽 갱신·realtime
publication 목록), 위협 모델 16가지 통과, `git diff --check`. 코드 변경이 없어 전체
테스트는 돌리지 않았다.

---

### 2026-08-13 · PR #50 — 양방향 `이따 이야기하기` (P3) · 머지됨

**상태:** 머지됨 (`a92339e`). 커밋 `cbed079`(DB), `a626d2e`(제품). CI 14/14 통과.
마이그레이션 038은 **운영 미적용** — 배포 전 read-only 재확인 필요.

PRODUCT_V3 P3 완료. PR #49에서 "보안 마이그레이션이 필요하다"며 막아둔 항목이다.
파트너가 남의 기록에 쓰려면 `daily_records` 쓰기 권한을 넓혀야 하는데, 그 대신
메타데이터 전용 별도 테이블을 만들었다.

| 파일 | 변경 |
|---|---|
| `supabase/migrations/038_bilateral_talk_about_marks.sql` | 신규. `talk_about_marks` 테이블 + RLS 3개 + 컬럼 단위 INSERT grant |
| `supabase/migrations/README.md` | 038 ledger 행 추가 |
| `scripts/phase0/storage-authz-harness.mjs` | 실제 RLS actor 검증 28건 추가 |
| `src/lib/talkAbout.ts` | 신규. 데이터 레이어 |
| `src/lib/talkAboutList.ts` | 신규. 마크 × 기록 조인 (프라이버시 경계가 여기 있다) |
| `src/components/widgets/TalkAboutListWidget.tsx` | 신규. `오늘 이야기할 것` |
| `src/pages/RecordPage.tsx` | 기록 상세에 표시 버튼 |
| `src/lib/store.tsx`, `storeContext.ts`, `types/index.ts`, `widgets.tsx` | 상태·액션·위젯 등록 |
| 테스트 | `talkAboutList.test.ts`(13), `TalkAboutListWidget.test.tsx`(9), RecordPage +6 |

핵심 결정:
- 서버가 아는 것은 `record_id / couple_id / actor_user_id / created_at` **뿐**이다.
  본문·주제·요약을 담을 컬럼이 아예 없다.
- actor별 행(`UNIQUE (record_id, actor_user_id)`). 누가 표시했는지 남고, 내 표시를
  지워도 상대 것이 지워지지 않는다.
- 레거시 `daily_records.talk_about`은 **손대지 않았다**. 의미가 다르고, 마이그레이션은
  동의한 적 없는 사용자의 데이터를 만드는 일이 된다. PR 본문에 근거 기록.
- mutation 테스트 중 실제 결함 발견: active-membership 게이트가 `daily_records` RLS에
  가려 한 번도 검증되지 않고 있었다. 격리 assertion 추가로 해소.

---

### 2026-08-13 · PR #49 — 핵심 하루 루프 (P0-a → P2) · 머지됨

기록 → 상대방의 오늘 → 정확한 원본 → 대화의 앞 세 단계.

| 마일스톤 | 내용 |
|---|---|
| P0-a | 기록 탭에 제거 불가능한 작성 진입점(기존엔 지울 수 있는 홈 위젯 하나뿐이었다), 작성자 태그 입력 UI(읽는 화면만 5개 있고 쓰는 경로가 없었다), 기계 추론 감정의 기본값을 author-only로 전환 |
| P1 | 공유 기록 1건이어도 요약 생성, 키워드 기반 서사 창작 분기 제거, 침묵을 "평온함"으로 추론하던 문구 제거 |
| P2 | `?record=<id>` 내구성 있는 원본 주소 지정(기존엔 휘발성 스토어 상태라 새로고침·딥링크에서 소실) |

P3는 이 PR에서 보안 마이그레이션 필요를 이유로 의도적으로 미구현 후 문서화.

---

### 2026-08-13 · PR #48 — Phase 0 기준선 마이그레이션 정리 · 머지됨

028·029·030이 커밋되지 않은 채 작업 트리에만 있던 것을 추적 대상으로 편입하고,
증명을 붙였다. 검증 중 발견한 실제 결함 2건을 수정(028 trailing slash, 029 락 누락),
그리고 037을 새로 추가했다.

- `scripts/phase0/storage-authz-harness.mjs` 신규 — 실제 PostgreSQL 17 클러스터에
  001..038 전체를 적용하고 실제 RLS actor로 검증
- 037: 계정 삭제 시 disconnected/pending 파트너의 커플 키가 파괴되던 P1 수정

---

### 2026-08-13 · PR #47 — Product V3 canonical 문서 · 머지됨

하나의 혼재된 문서를 수명이 다른 셋으로 분리:
`PRODUCT_V3.md`(제품 의도, 안정) / `ENGINEERING_ROADMAP.md`(구현 순서) /
`CURRENT_STATE.md`(저장소 현실, 휘발성). 채팅·사진을 코어로 승격, 오디오·영상을
Premium Candidate로 강등, 기계 추론 감정 규칙 확정.

---

## 유지 규칙

- 세션이 끝나면 이 문서에 **한 항목**을 추가한다. 커밋 메시지를 여기 복사하지 않는다.
  링크와 요약이면 충분하다.
- 제품 방향이 바뀌면 `PRODUCT_V3.md`를 먼저 고치고, 여기에는 "고쳤다"만 남긴다.
- 운영 배포 상태를 여기에 쓰지 않는다. 마이그레이션 ledger가 유일한 출처다.
