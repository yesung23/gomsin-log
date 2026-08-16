# Claude Code 오케스트레이션 (곰신로그)

이 폴더는 **반복되는 지침을 올바른 레이어에 배치**한다. 프롬프트를 길게 만드는 것이
목적이 아니다.

| 레이어 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `CLAUDE.md` | 모든 세션에서 항상 참인 규칙 | 절차, 휘발성 상태 |
| `skills/` | 특정 작업에서만 필요한 절차 | canonical 문서 본문 복사 |
| `hooks/` | 코드로 결정 가능한 금지 | 판단이 필요한 회색지대 |
| `docs/CURRENT_STATE.md` · live Git | 휘발성 사실 | 제품 전략 |

## Skills — 얇은 래퍼일 뿐이다

절차의 **원본은 [`docs/skills/`](../docs/skills/README.md)** 이며 Codex·Kiro와 공유한다.
`.claude/skills/*/SKILL.md`는 frontmatter(trigger 조건) + "원본을 읽어라" 4줄뿐이다.

| Skill | 원본 | 사용 시점 |
|---|---|---|
| `gomsin-control-tower` | `docs/skills/control-tower.md` | 세션 시작, 상태 복구, DIRECTION CHECK |
| `gomsin-feature-build` | `docs/skills/feature-build.md` | 기능 구현·비사소한 버그 수정 |
| `gomsin-security-review` | `docs/skills/security-review.md` | 인증·E2EE·RLS·커플 lifecycle |
| `gomsin-migration-gate` | `docs/skills/migration-gate.md` | migration 작성·검증 |
| `gomsin-release-validation` | `docs/skills/release-validation.md` | 종료 전 검증과 unverified 분류 |

절차를 고칠 때는 **원본만** 고친다. 래퍼는 경로가 바뀔 때만 손댄다. 같은 규칙을 도구마다
복사하면 반드시 갈라진다.

## Hooks (deterministic, PreToolUse)

`block-dangerous-bash.sh` — 원격 Supabase migration/link, force push, `reset --hard`,
`clean -f`, worktree 폐기, force branch delete, master 직접 push, `git merge`,
`gh pr merge`, frozen 041/042 조작, secret 읽기.

`block-protected-writes.sh` — frozen 041/042 쓰기, 기존 migration 재작성,
credential 파일 쓰기.

오탐 가능성이 큰 규칙은 **차단 hook으로 만들지 않는다.** 회색지대는 Skill의 규칙으로
남긴다. 새 forward migration·일반 소스·테스트·문서 쓰기는 막지 않는다.

PostToolUse는 두지 않는다 — 저장할 때마다 도는 검사는 느리고, 이 저장소는 이미
typecheck/lint/test를 종료 전에 범위별로 실행한다.

Stop hook도 두지 않는다. 모든 작업에 full suite를 강제하면 문서 한 줄 수정도 100초가
걸린다. 대신 `gomsin-release-validation`이 변경 범위에 맞는 검증을 선택한다.

## Subagent 정책

**기본 사용하지 않는다.** 다음에만 사용한다.

- 탐색 범위가 커서 main context가 오염될 때
- 독립적인 보안 검증이 필요할 때 (구현자와 다른 세션)
- 많은 파일을 read-only 조사할 때

Explorer는 read-only가 기본이다. 작은 구현을 여러 agent로 쪼개지 않는다. 쓰기는
한 번에 한 소유자만 한다(병렬 쓰기 금지). 읽기만 병렬화한다.

## Agent Teams

Claude Code **2.1.220에는 team/swarm 기능이 없다** (`claude --help`에 해당 항목 없음).
따라서 정책상 **OFF**이며, 지원되더라도 기본 OFF를 유지한다. 독립적인 세 영역 이상을
동시에 조사하며 서로의 가설을 반증할 가치가 있을 때만 재검토한다. 단순 기능 구현에는
쓰지 않는다. 멀티에이전트 리뷰가 필요하면 `claude ultrareview`가 이미 있다.

## Plan Mode

고위험 변경에서 먼저 plan과 self-critique를 수행한다: 암호 신뢰모델, 권한/인가,
migration, 데이터 손실 위험, 대규모 구조 변경.

```bash
claude --permission-mode plan
```

일반 UI 수정·작은 버그에는 강제하지 않는다.

## MCP

이 프로젝트 작업에 필요한 MCP는 **없다.** 현재 사용자 계정에 연결된 서버(Notion,
Gmail, Drive, Slack 등)는 곰신로그 개발과 무관하므로 이 저장소 작업에서 사용하지
않는다. GitHub live state는 `gh` CLI로 충분하다.

**Production write capability를 자동 개발 루프에 연결하지 않는다.** 원격 Supabase
접근이 필요하면 read-only로, 사용자 승인 아래에서만 한다.

## 지속 메모리

휘발성 저장소 상태를 memory에 저장하지 않는다.

| 사실 | 소유자 |
|---|---|
| PR 번호 · HEAD · SHA · CI | live Git/`gh` (작업 시점 확인) |
| active blocker · 미구현 | `docs/CURRENT_STATE.md` |
| migration 적용 상태 | `supabase/migrations/README.md` |
| next task · 중단 지점 | `docs/WORK_LOG.md` 최신 항목 |

memory에는 안정적인 규약만 둔다. 상태는 매번 다시 확인한다.
