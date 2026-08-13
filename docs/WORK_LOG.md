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

### 2026-08-13 · PR #52 — 채팅 제품·데이터 계약 (P4)

**목표:** 채팅을 만드는 것이 아니라, P5(daily_records E2EE)·P6(암호화 사진)이
채팅 구조를 재설계하지 않아도 되도록 그 전에 최소한의 올바른 계약을 고정하는 것.
**코드·스키마·마이그레이션 없음.**

| 파일 | 변경 |
|---|---|
| `docs/CHAT_PRODUCT_DATA_CONTRACT_V1.md` | 신규. 18개 절, 약 490줄 |
| `docs/PRODUCT_V3.md` | §12.1이 계약 문서를 가리키도록 한 줄 |
| `docs/ENGINEERING_ROADMAP.md` | P4 행에 산출물과 게이트 G1–G6 링크 |
| `docs/CURRENT_STATE.md` | 채팅 미구현 사실 갱신 + PR #50으로 해소된 행 삭제 |

핵심 결정:
- **새 scope도 새 봉투 형식도 만들지 않는다.** 기존 CSK + GLE1을 그대로 쓰고,
  채팅은 GLE1 AAD가 이미 묶고 있는 `object type` 하나를 추가할 뿐이다. 이것이
  "P5/P6이 와도 재설계 불필요"의 실제 근거다 — 예측을 잘해서가 아니라 봉투가 원래
  object-type-agnostic이기 때문.
- 전용 chat scope를 **거부**했다. 신뢰 경계가 커플 기록과 완전히 동일하므로 분리해서
  얻는 보안이 0인데 epoch 기계·envelope·rotation을 한 벌 더 만들게 된다.
- 서버가 보는 것은 6개 필드뿐: `id / couple_id / sender_user_id / ciphertext /
  ordinal / created_at`. `message_type`·`reply_to`·`context`·`key_epoch`를 전부
  암호문 안으로 밀어냈고, 각각 왜 서버가 몰라도 되는지를 표로 남겼다.
- **write floor가 필요 없다**는 것을 명시. 032가 필요했던 이유는 `daily_records`에
  평문 컬럼이 이미 있었기 때문이고, 채팅은 태어날 때부터 암호화라 내려갈 곳이 없다.
- 수정은 V1 연기하되 **구조적 막다른 길이 아님**을 근거와 함께 기록(GLE1이 이미
  `content_revision`을 묶는다). 나중에 붙이는 것은 제품 결정이지 재설계가 아니다.
- 순서는 서버 `ordinal`이 정하고 클라이언트 시계는 쓰지 않는다. 다만 Phase 1A에는
  인증된 히스토리 루트가 없어 **악의적 서버의 보류·재정렬을 탐지할 수 없다**는 한계를
  숨기지 않고 적었다. "E2EE니까 순서도 안전"으로 잘못 읽히면 사용자 기대를 배신한다.
- 맥락 참조(`daily_record` / `talk_about`)는 암호문 안 불투명 id. 해결 불가한 참조는
  자리표시자 없이 조용히 사라진다 — P3의 `buildTalkAboutTopics`에서 이미 검증한 규칙.
- 삭제는 세 가지를 분리하고, "상대 기기에서도 완전히 삭제되었습니다"는 **쓰지 않는다**고
  못박았다. 강제할 수 없는 약속이다.

자체 검증 12가지 경우를 표로 통과시켰고, 그 과정에서 재연결 의미가 미정의라는 실제
의존성을 발견했다 — `disconnect_couple`이 `crypto_pairings`를 UNLINKED로 전이시키지
않아(`CURRENT_STATE` #17) "같은 커플 재연결"과 "새 커플"을 구분할 권위 있는 상태가 없다.
계약이 대신 결정하지 않고 **게이트 G3**로 올렸다.

검증: 내부 §참조 전수 검사(18개 절, 미해결 0), 계약의 사실 주장을 canonical 문서·
소스와 대조(GLE1 AAD·epoch 헬퍼·PRODUCT_V3 §20·오버헤드 108B), `git diff --check`.
코드 변경이 없어 전체 테스트는 돌리지 않았다.

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
