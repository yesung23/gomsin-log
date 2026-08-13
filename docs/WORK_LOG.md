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

### 2026-08-13 · 새 PR — 프로젝트 핸드오프 + 장기 비즈니스/메모리 방향

Claude 사용이 앞으로 제한된다는 전제로, 다른 AI(Codex, Kiro, Gemini 등)나
사람이 CLAUDE.md/AGENTS.md 다음으로 읽고 저장소를 이어받을 수 있도록 하는
순수 문서화 작업. **코드·마이그레이션·기능 구현 없음. PR #52와 무관 — 별도
브랜치·별도 PR.**

**저장소 진실 재확인 (문서를 쓰기 전):** `origin/master` HEAD `a92339e`.
열린 PR 9개 확인 — #52(P4 채팅 계약, OPEN/MERGEABLE/CI 14/14)는 활성
작업이고, #2–#9는 `kiro/*`·`codex/*` 브랜치가 서로를 베이스로 하는 오래된
체인으로 이번 작업에서 내용을 검증하지 않아 핸드오프 문서에 레거시로
표시했다. 마이그레이션 원장을 다시 읽다가 **035·036이 저장소에 존재하고
`ENGINEERING_ROADMAP.md`가 마이그레이션 체인에 명시적으로 포함시키는데도
`supabase/migrations/README.md`의 파일 목록 표에 행이 없는 문서 갭**을
발견해 두 행을 추가했다(내용 파악 후 "신규 / 어디에도 미적용"으로 표기 —
운영 상태를 새로 조사하지 않았고 조사할 수도 없는 문서 정리 작업이므로
추정하지 않았다).

| 파일 | 변경 |
|---|---|
| `docs/PROJECT_HANDOFF_2026-08-13.md` | 신규. 다른 AI를 위한 지도: 문서 전체 인벤토리(카테고리·상태·언제 읽는가), 저장소 진실 스냅샷, 완료된 단계, 보안 모델 요약(링크만), 프로덕션 진실(Git ≠ 배포), 열린 블로커 인벤토리 |
| `docs/BUSINESS_MEMORY_ROADMAP_V1.md` | 신규. 장기 방향 — 아래 참고 |
| `docs/PRODUCT_V3.md` | §12.3만 수정. 오디오/영상을 "활성 로드맵 아님"에서 "P6 이후 유료 미디어 확장"으로 — 순서는 그대로, 방향 확신만 변경. 세부는 새 로드맵 문서로 링크 |
| `docs/ENGINEERING_ROADMAP.md` | "로드맵에 없는 것" 절의 오디오/영상 문구를 같은 취지로 수정 |
| `docs/CURRENT_STATE.md` | "수익화/구독: 코드 없음" 행에 새 로드맵 문서 링크 한 줄 추가 |
| `supabase/migrations/README.md` | 035·036 원장 표 누락 발견 → 행 추가 (위 참고) |

#### 신규 장기 비즈니스 방향 (전부 `BUSINESS_MEMORY_ROADMAP_V1.md`가 canonical)

포지셔닝이 "커플 앱"에서 "함께하지 못한 시간까지 안전하게 보관하고, 나중엔
손에 잡히는 기억으로 만들어주는 사적인 기억 보관소"로 확장된다. 4개 수익
축(커스터마이징 / 유료 미디어 저장 / Book Studio / 실물 메모리북),
Free·Plus·Archive 3단 구독(가격·용량은 전부 검증 전 가설), 관리형 클라우드
(Cloudflare R2 류) + 얇은 인가 게이트웨이 우선하고 자체 서버는 지금 사지
않는다는 인프라 방향, POD 외주 실물 책, "오늘의 책갈피"(AI가 아니라
사용자가 직접 무엇이 기억할 가치가 있는지 표시), Book Studio는 결정론적
Stage 1이 먼저이고 AI Stage 2는 실물책 수요 확인 후. **보안(E2EE)과 코어
루프는 어떤 경우에도 유료화하지 않는다는 원칙이 문서 전체를 관통한다.**
AI Book Studio·인쇄 각각에 대해 명시적 opt-in과 E2EE 경계로부터의 export
경고를 요구했다 — 관계 아카이브 전체를 조용히 외부 모델에 올리는 흐름은
금지.

**검증하지 않은 것:** 가격·용량·시간 한도(전부 명시적으로 가설), POD
벤더 견적, 클라우드 비용 실측치. 이번 작업에서 코드/가격 로직을 만들지
않았고 만들 수도 없다 — 순수 방향 문서다.

**프로덕션 mutation 없음.** 조회도 하지 않았다.

---

### 2026-08-13 · PR #50 — 양방향 `이따 이야기하기` (P3)
**상태:** OPEN, 미머지. 브랜치 `feat/bilateral-talk-about`.
커밋 `cbed079`(DB), `a626d2e`(제품). CI 14/14 통과.
마이그레이션 038은 **운영 미적용**.

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
