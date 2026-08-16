# 공용 절차서 사용 (Kiro)

Kiro는 Codex·Claude Code와 **같은 절차서**를 쓴다. 원본은 이 저장소의
[`docs/skills/`](../../docs/skills/README.md)이며, 도구별로 복사하지 않는다.

| 상황 | 읽을 파일 |
|---|---|
| 세션 시작 · 상태 복구 · 방향 확인 | `docs/skills/control-tower.md` |
| 기능 구현 · 비사소한 버그 수정 | `docs/skills/feature-build.md` |
| 인증 · E2EE · RLS · 커플 lifecycle | `docs/skills/security-review.md` |
| `supabase/migrations` 변경 | `docs/skills/migration-gate.md` |
| commit · PR · 완료 보고 전 | `docs/skills/release-validation.md` |

비사소한 작업은 **먼저 `control-tower.md`를 읽고** 상태를 복구한 뒤 시작한다. 대화 기억은
source of truth가 아니다.

## 다른 도구가 남긴 작업 이어받기

이 저장소는 Codex·Kiro·Claude Code가 번갈아 작업한다. 다른 세션이 이미 같은 브랜치에
커밋했을 수 있다.

1. `docs/WORK_LOG.md` 최신 항목의 `STOPPED AT` / `REMAINING` / `NEXT ACTION`
2. `scripts/claude/live-state.sh` — 실제 branch·HEAD·PR (문서의 SHA는 checkpoint일 뿐)
3. `git log --oneline -5` — 내가 마지막으로 본 이후 추가된 커밋

**남의 작업을 덮어쓰지 않는다.** 예상과 HEAD가 다르면 먼저 그 사실을 보고한다.

## 이 저장소에서 실제로 나온 실수

- 보호 함수가 구현되어 있는데 **어떤 사용자 경로에서도 호출되지 않았다.** "코드가 존재한다"와
  "실제로 사용된다"를 구분해 보고한다(호출자를 직접 세어 본다).
- 복구가 필요한 상태를 `catch {}`가 "일시적 실패"로 바꿔 사용자가 복구 경로에 도달하지
  못했다.
- stale `master`에서 baseline을 잡고 "all gates green"을 주장했다. baseline은 **실제
  변경 중인 브랜치**에서 잡고 SHA를 함께 적는다.

## 보고

실행한 검증과 실행하지 않은 검증을 구분한다. Production은 항상 `NOT APPLIED` 또는
`UNVERIFIED`로 명시한다. 세션 종료 시 `docs/WORK_LOG.md`에 항목 하나를 남긴다.
READ-ONLY 리뷰어는 저장소를 수정하지 않고 `READY-TO-COPY WORK_LOG ENTRY`만 출력한다.
