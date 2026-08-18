# 공용 절차서 (Codex · Kiro · Claude Code)

절차의 **원본은 이 폴더**다. 도구별 설정은 이 파일들을 가리키는 얇은 래퍼이며, 내용을
복사하지 않는다. 같은 규칙을 세 번 적으면 반드시 갈라진다.

| 절차 | 원본 | 언제 |
|---|---|---|
| 상태 복구·방향 확인 | [`control-tower.md`](control-tower.md) | 세션 시작, 비사소한 작업 전 |
| 기능 구현 | [`feature-build.md`](feature-build.md) | 기능·비사소한 버그 |
| 보안 검토 | [`security-review.md`](security-review.md) | 인증·E2EE·RLS·커플 lifecycle |
| migration | [`migration-gate.md`](migration-gate.md) | `supabase/migrations` 변경 |
| 종료 전 검증 | [`release-validation.md`](release-validation.md) | commit·PR·완료 보고 전 |

## 도구별 진입점

| 도구 | 자동 로드 | 절차 호출 |
|---|---|---|
| **Codex** | `AGENTS.md` | 이 폴더를 직접 읽는다. subagent는 `.codex/agents/*.toml` |
| **Kiro** | `.kiro/steering/*.md` | 이 폴더를 직접 읽는다. subagent는 `.kiro/agents/*.json` |
| **Claude Code** | `CLAUDE.md` | `$gomsin-<name>` Skill (`.claude/skills/`)이 이 폴더를 읽는다 |

세 도구 모두 `AGENTS.md`의 엔지니어링 계약을 따른다. Claude Code는 `CLAUDE.md`가
`AGENTS.md`를 가리킨다.

## 공유되는 사실 (도구와 무관)

"어디까지 했는지"는 도구 설정이 아니라 저장소가 소유한다. 어떤 도구로 이어받아도 같은
답이 나와야 한다.

| 질문 | 소유자 |
|---|---|
| 어디까지 했나 · 중단 지점 · 다음 작업 | `docs/WORK_LOG.md` 최신 항목 |
| 현재 결함·미구현·blocker | 저장소 코드, 그 다음 `docs/CURRENT_STATE.md` |
| 다음 순서·gate | `docs/ENGINEERING_ROADMAP.md` |
| migration 적용 상태 | `supabase/migrations/README.md` |
| PR·HEAD·CI | live Git / `gh` — **작업 시점에 다시 확인** |

휘발성 사실을 도구별 메모리에 저장하지 않는다. 도구를 바꾸면 그 메모리는 사라지지만
위 파일들은 남는다.

## 도구 간 인계

한 도구가 남긴 작업을 다른 도구가 이어받을 때:

1. `docs/WORK_LOG.md` 최신 항목의 `STOPPED AT` / `REMAINING` / `NEXT ACTION`을 읽는다.
2. `scripts/agent/live-state.sh`로 실제 branch·HEAD·PR을 확인한다. 문서의 SHA는
   checkpoint일 뿐이다.
3. 다른 세션이 그 위에 커밋했는지 `git log`로 확인한다. **덮어쓰지 않는다.**
4. 이어서 작업하고 `WORK_LOG`에 항목을 하나 추가한다.

## 유지 규칙

- 절차가 바뀌면 이 폴더의 원본만 고친다.
- 도구 래퍼는 경로가 바뀔 때만 손댄다.
- 특정 브랜치 이름·PR 번호를 절차서에 넣지 않는다. 그것은 `CURRENT_STATE`와 live Git이
  소유한다.
