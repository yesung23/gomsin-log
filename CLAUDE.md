# CLAUDE.md — 작업 규칙

앞으로 너가 작업하는 모든 내용을 별도의 md파일에 작성해줘

→ 그 파일은 **[`docs/WORK_LOG.md`](docs/WORK_LOG.md)** 다. 세션이 끝날 때마다
항목 하나를 추가한다.

---

## 수정 사항을 어디에 적는가

작업 기록은 원래 여러 곳에 나뉜다. `WORK_LOG.md`는 그것들을 가리키는 색인이지
대체물이 아니다. 같은 내용을 두 번 쓰지 않는다.

| 무엇 | 어디 |
|---|---|
| 변경의 이유·근거 (가장 자세함) | git commit message |
| 변경 묶음의 요약·검증 결과 | PR 본문 |
| 코드가 왜 그렇게 생겼는지 | 해당 파일의 주석 |
| 현재 저장소의 결함·미구현 | `docs/CURRENT_STATE.md` |
| 마이그레이션 적용 상태 | `supabase/migrations/README.md` |
| 세션 단위 작업 색인 | `docs/WORK_LOG.md` |

## 문서 우선순위 (충돌 시)

1. **제품 의도** → `docs/PRODUCT_V3.md`
2. **구현 순서** → `docs/ENGINEERING_ROADMAP.md`
3. **현재 구현 사실** → 저장소 코드가 이긴다. 문서가 아니라 코드를 확인한다
4. **암호 프로토콜** → `docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`
5. **프라이버시·법적 판단** → `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`
6. **엔지니어링 계약** → `AGENTS.md`
7. **시각 디자인** → `docs/DESIGN_V2.md`

## 문서 탐색 규칙

- **ONE FACT → ONE AUTHORITATIVE HOME.** 이미 소유자가 있는 사실을 다른 문서에
  복사하지 말고 링크한다.
- 일반 작업의 기본 읽기 순서는 `CLAUDE.md` → `docs/PRODUCT_V3.md` →
  `docs/ENGINEERING_ROADMAP.md` → `docs/CURRENT_STATE.md` → 작업과 직접 관련된
  specialist 문서다. `docs/PROJECT_HANDOFF_2026-08-13.md`는 온보딩용 지도이며,
  일반 세션에서 모든 역사 문서를 읽게 하는 목록이 아니다.

## 기록할 때 지킬 것

- **"적용됨"과 "커밋됨"을 섞지 않는다.** 마이그레이션 파일이 저장소에 있다는 사실은
  운영 적용의 증거가 아니다. 운영 상태를 적을 때는 확인 방법과 날짜를 함께 남긴다.
- 검증하지 않은 것을 검증했다고 쓰지 않는다. 실행한 테스트와 실행하지 않은 테스트를
  구분해서 적는다.
- 실패한 것은 실패했다고 적는다.
