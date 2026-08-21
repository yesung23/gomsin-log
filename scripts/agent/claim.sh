#!/usr/bin/env bash
# 작업 점유 보드 — control-tower/Now.md 의 CLAIMS 블록만 고친다.
#
#   claim.sh <agent> "<scope>"     잡기 (겹치면 경고하고 exit 1)
#   claim.sh <agent> "<scope>" -f  겹쳐도 강행
#   claim.sh --release <agent>     놓기
#   claim.sh --list                보기
#
# 이 보드는 canonical이 아니다. 점유는 예의이지 잠금이 아니며, 실제 충돌은 git이
# 판정한다. SHA·PR 번호·CI 결과는 절대 쓰지 않는다.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

BOARD="control-tower/Now.md"
[ -f "$BOARD" ] || { echo "점유 보드가 없다: $BOARD" >&2; exit 1; }

MODE="claim"; AGENT=""; SCOPE=""; FORCE=0
case "${1:-}" in
  --list)    MODE="list" ;;
  --release) MODE="release"; AGENT="${2:-}" ;;
  "")        echo "usage: claim.sh <agent> \"<scope>\" | --release <agent> | --list" >&2; exit 2 ;;
  *)         AGENT="$1"; SCOPE="${2:-}"; [ "${3:-}" = "-f" ] && FORCE=1 ;;
esac

if [ "$MODE" = "claim" ] && [ -z "$SCOPE" ]; then
  echo "scope가 비어 있다. 무엇을 잡는지 한 줄로 적는다." >&2; exit 2
fi
if [ "$MODE" = "release" ] && [ -z "$AGENT" ]; then
  echo "--release 뒤에 agent 키가 필요하다." >&2; exit 2
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
NOW_UTC="$(date -u +%Y-%m-%dT%H:%MZ)"

BOARD="$BOARD" MODE="$MODE" AGENT="$AGENT" SCOPE="$SCOPE" BRANCH="$BRANCH" \
NOW_UTC="$NOW_UTC" FORCE="$FORCE" python3 - <<'PY'
import os, re, sys, datetime

board, mode = os.environ["BOARD"], os.environ["MODE"]
agent = re.sub(r"[^a-z0-9._-]+", "-", os.environ["AGENT"].strip().lower()).strip("-")
scope, branch = os.environ["SCOPE"].strip(), os.environ["BRANCH"]
now_utc, force = os.environ["NOW_UTC"], os.environ["FORCE"] == "1"

text = open(board, encoding="utf-8").read()
m = re.search(r"(<!-- CLAIMS:BEGIN -->\n)(.*?)(<!-- CLAIMS:END -->)", text, re.S)
if not m:
    sys.exit("CLAIMS 블록을 찾지 못했다. Now.md의 마커를 지우지 않았는지 확인한다.")

rows = []
for line in m.group(2).splitlines():
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) == 4 and cells[0] not in ("agent", "_(없음)_") and not set(cells[0]) <= set("-: "):
        rows.append(cells)

def age_hours(stamp):
    try:
        t = datetime.datetime.strptime(stamp, "%Y-%m-%dT%H:%MZ")
    except ValueError:
        return None
    return (datetime.datetime.strptime(now_utc, "%Y-%m-%dT%H:%MZ") - t).total_seconds() / 3600

def render(rows):
    out = ["| agent | scope | branch | since (UTC) |", "|---|---|---|---|"]
    out += ["| " + " | ".join(r) + " |" for r in rows] or ["| _(없음)_ | | | |"]
    return "\n".join(out) + "\n"

if mode == "list":
    if not rows:
        print("활성 점유 없음.")
    for r in rows:
        h = age_hours(r[3])
        flag = "  ← STALE (24h+)" if h is not None and h >= 24 else ""
        print(f"{r[0]:<14} {r[1]}  [{r[2]}] since {r[3]}{flag}")
    sys.exit(0)

if mode == "release":
    kept = [r for r in rows if r[0] != agent]
    if len(kept) == len(rows):
        print(f"'{agent}' 이름으로 잡힌 것이 없다. 보드는 그대로 둔다.")
        sys.exit(0)
    rows = kept
    print(f"놓았다: {agent}")
else:
    def tokens(s):
        return {w for w in re.split(r"[^0-9A-Za-z가-힣]+", s.lower()) if len(w) >= 3}
    mine = tokens(scope)
    clashes = [r for r in rows
               if r[0] != agent and (tokens(r[1]) & mine)
               and (age_hours(r[3]) or 0) < 24]
    if clashes and not force:
        print("겹치는 점유가 있다 — 그 AI의 리포트를 먼저 읽는다:", file=sys.stderr)
        for r in clashes:
            print(f"  {r[0]}: {r[1]}  [{r[2]}] since {r[3]}", file=sys.stderr)
        print("\n그래도 진행하려면 세 번째 인자로 -f 를 준다.", file=sys.stderr)
        sys.exit(1)
    rows = [r for r in rows if r[0] != agent]
    rows.append([agent, scope.replace("|", "／"), branch, now_utc])
    print(f"잡았다: {agent} → {scope}  [{branch}]")

open(board, "w", encoding="utf-8").write(text[:m.start(2)] + render(rows) + text[m.end(2):])
PY
