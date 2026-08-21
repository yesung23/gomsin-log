#!/usr/bin/env bash
# 공유 기억(control-tower/, WORK_LOG, 세션 프로토콜)만 GitHub으로 주고받는다.
#
#   ct-sync.sh                 상태 — 무엇이 바뀌었고 remote와 얼마나 벌어졌나
#   ct-sync.sh pull            remote의 기억을 가져온다
#   ct-sync.sh push "<msg>"    기억만 커밋하고 push
#
# NAS·CouchDB·Gitea 대신 GitHub이 전송로다. Obsidian Git 플러그인은 쓰지 않는다 —
# 이 vault는 코드 저장소의 하위 폴더라 플러그인이 저장소 전체를 자동 커밋한다.
# 이 스크립트는 아래 경로 밖의 파일을 절대 stage 하지 않는다.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

MEMORY_PATHS=(control-tower docs/WORK_LOG.md docs/AI_SESSION_PROTOCOL.md)
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
CMD="${1:-status}"

memory_dirty() { git status --porcelain -- "${MEMORY_PATHS[@]}"; }

divergence() {
  local up; up="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -z "$up" ]; then echo "  upstream 없음 — 첫 push는 -u 가 필요하다"; return; fi
  git fetch --quiet origin "$BRANCH" 2>/dev/null || true
  echo "  upstream: $up · $(git rev-list --left-right --count "$up...HEAD" 2>/dev/null \
    | awk '{print "behind "$1", ahead "$2}')"
}

case "$CMD" in
  status)
    echo "branch: $BRANCH"; divergence
    echo; echo "공유 기억의 변경:"
    d="$(memory_dirty)"; [ -n "$d" ] && echo "$d" | sed 's/^/  /' || echo "  (없음)"
    o="$(git status --porcelain --untracked-files=no | grep -v -E '^.. (control-tower/|docs/WORK_LOG\.md|docs/AI_SESSION_PROTOCOL\.md)' || true)"
    if [ -n "$o" ]; then
      echo; echo "기억 밖의 변경 — 이 스크립트는 건드리지 않는다:"; echo "$o" | sed 's/^/  /'
    fi
    ;;

  pull)
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      echo "working tree가 더럽다. 먼저 커밋하거나 stash 한 뒤 다시 실행한다." >&2
      git status --short --untracked-files=no | sed 's/^/  /' >&2
      exit 1
    fi
    git pull --rebase --ff-only 2>/dev/null || git pull --rebase || exit 1
    echo "가져왔다. 이어서:  bash scripts/agent/session-start.sh"
    ;;

  push)
    MSG="${2:-}"
    [ -z "$MSG" ] && { echo 'usage: ct-sync.sh push "ct: <agent> <요약>"' >&2; exit 2; }
    [ "$BRANCH" = "master" ] && { echo "master에는 직접 push하지 않는다." >&2; exit 1; }
    [ -z "$(memory_dirty)" ] && { echo "공유 기억에 커밋할 변경이 없다."; exit 0; }

    git add -- "${MEMORY_PATHS[@]}" || exit 1
    STRAY="$(git diff --cached --name-only | grep -v -E '^(control-tower/|docs/WORK_LOG\.md|docs/AI_SESSION_PROTOCOL\.md)' || true)"
    if [ -n "$STRAY" ]; then
      echo "기억 밖의 파일이 stage됐다 — 중단하고 되돌린다:" >&2; echo "$STRAY" | sed 's/^/  /' >&2
      git reset --quiet HEAD -- "${MEMORY_PATHS[@]}"; exit 1
    fi
    git commit --quiet -m "$MSG" || exit 1
    echo "커밋: $(git log --oneline -1)"
    if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
      git push || exit 1
    else
      git push -u origin "$BRANCH" || exit 1
    fi
    echo "push 완료 — 다른 AI는 ct-sync.sh pull 로 받는다."
    ;;

  *) echo "usage: ct-sync.sh [status|pull|push \"<msg>\"]" >&2; exit 2 ;;
esac
