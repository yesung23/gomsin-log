> **도구 중립 절차서.** Codex·Kiro·Claude Code가 모두 이 파일을 원본으로 읽는다.
> 각 도구의 설정은 이 파일을 가리키는 얇은 래퍼일 뿐이므로, 내용을 도구별로
> 복사하지 않는다. 수정은 여기서 한 번만 한다. 도구별 진입점은 `docs/skills/README.md`.

# Control Tower — 상태 복구와 방향 확인

대화 기억은 source of truth가 아니다. 저장소와 live Git이 소유한다.

## 1. Canonical 복구 (이 순서대로 읽는다)

1. `CLAUDE.md`
2. `docs/PRODUCT_V3.md`
3. `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — 고객·문제정의·제품범위·AI 역할·수익화·가격·
   저장/클라우드·미디어·Memory Product·KPI·시장확장에 영향이 있을 때만
4. `docs/ENGINEERING_ROADMAP.md`
5. `docs/CURRENT_STATE.md`
6. `docs/WORK_LOG.md` 최신 관련 항목 (전체를 읽지 않는다)
7. `docs/PROJECT_HANDOFF_2026-08-13.md`
8. `AGENTS.md` — engineering 작업일 때
9. 작업과 직접 관련된 specialist 문서 하나 이상

모든 Markdown을 읽지 않는다. 무관한 역사 문서는 건너뛴다.

## 2. Live 검증 (문서의 과거 SHA보다 우선)

```bash
scripts/agent/live-state.sh
```

문서에 적힌 PR·HEAD·CI는 checkpoint일 뿐이다. 항상 live 값을 다시 확인한다.

## 3. Start checkpoint 보고

확인할 수 없는 항목은 추측하지 않고 `UNVERIFIED`로 남긴다.

- CURRENT PHASE / ACTIVE STEP
- ACTIVE PR / BRANCH
- VERIFIED BASE / HEAD
- LAST GATE / NEXT GATE
- CURRENT BLOCKER
- DO NOT ADVANCE UNTIL

## 4. DIRECTION CHECK

구현·문서 수정 전에 기록한다. 해당 없으면 `NOT APPLICABLE`.

- Product source checked:
- Business source checked / NOT APPLICABLE:
- Engineering source checked:
- Current-state checked:
- Latest relevant Work Log checked:
- Does this task conflict with canonical direction? YES / NO
- If YES, what conflict?

`YES`이면 **구현 전에 멈추고** 충돌과 선택지를 사용자에게 보고한다.

## 5. Abandoned-strategy guard

다음이 요청에 다시 등장하면 `DIRECTION CONFLICT`로 표시하고 멈춘다. 상세 목록은
`AGENTS.md` §17이 소유한다.

저장용량 구독 · 고화질/긴 영상 유료 게이트 · E2EE 유료화 · 구독 우선 BM ·
AI 자동 추억 선정 · 관계점수/애정도/이별예측 · 체류시간·다운로드 KPI ·
CloudKit 구현 완료 주장 · 음성·영상 완료 주장 · 자체 Chat 재활성화

## 6. 세션 종료

`docs/WORK_LOG.md`에 항목 하나. 실행한 검증과 실행하지 않은 검증을 구분한다.
READ-ONLY 리뷰어는 저장소를 수정하지 않고 `READY-TO-COPY WORK_LOG ENTRY`만 출력한다.
