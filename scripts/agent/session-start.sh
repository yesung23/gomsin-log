#!/usr/bin/env bash
# 모든 AI가 같은 상태에서 세션을 시작하기 위한 단일 명령.
#
#   bash scripts/agent/session-start.sh
#
# 읽기 전용. 출력하는 것: live 브랜치/HEAD/PR · 다음에 만들 것 · 지금 누가 무엇을
# 잡고 있나 · 최근 세션 · 최근 agent report. 절차 전체는 docs/AI_SESSION_PROTOCOL.md.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

rule() { printf '\n\033[1m%s\033[0m\n' "── $1"; }

rule "0. 어디서"
echo "repo: $(pwd)"
echo "user: $(git config user.name 2>/dev/null || echo '?') · $(date '+%Y-%m-%d %H:%M %Z')"

rule "1. LIVE 상태 — 문서가 아니라 이것을 믿는다"
bash scripts/agent/live-state.sh 2>&1 | sed 's/^/  /'

rule "2. 다음에 무엇을 만드나 — control-tower/Current Gate.md"
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("control-tower/Current Gate.md")
if not p.exists():
    print("  Current Gate.md 없음"); raise SystemExit
t = p.read_text(encoding="utf-8")
for title in ("## What to build next", "## Standing constraints"):
    m = re.search(re.escape(title) + r"\n(.*?)(?=\n## |\Z)", t, re.S)
    if m:
        print(f"  {title}")
        for line in m.group(1).strip().splitlines():
            print("    " + line)
        print()
PY

rule "3. 지금 누가 무엇을 잡고 있나 — control-tower/Now.md"
bash scripts/agent/claim.sh --list 2>&1 | sed 's/^/  /'
echo "  (잡기: bash scripts/agent/claim.sh <agent> \"<scope>\")"

rule "4. 최근 세션 3개 — docs/WORK_LOG.md"
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("docs/WORK_LOG.md")
if not p.exists():
    print("  WORK_LOG.md 없음"); raise SystemExit
t = p.read_text(encoding="utf-8")
heads = [(m.start(), m.group(1).strip()) for m in re.finditer(r"^### (.+)$", t, re.M)]
for _, h in heads[-3:]:
    print("  · " + h)
if heads:
    body = t[heads[-1][0]:]
    m = re.search(r"^#### STOPPED AT\n(.*?)(?=\n#### |\n### |\Z)", body, re.S | re.M)
    if m:
        print("\n  최신 세션의 STOPPED AT:")
        for line in m.group(1).strip().splitlines()[:14]:
            print("    " + line)
PY

rule "5. 최근 agent report 5개 — control-tower/reports/"
found=$(find control-tower/reports -name '*.md' ! -name 'README.md' 2>/dev/null \
  | xargs -I{} stat -f '%m %N' {} 2>/dev/null | sort -rn | head -5 | cut -d' ' -f2-)
if [ -n "$found" ]; then printf '  %s\n' $found; else echo "  (없음)"; fi

rule "6. 시작 전에 확정할 것"
cat <<'EOF'
  CURRENT PHASE / ACTIVE STEP / ACTIVE PR·BRANCH / VERIFIED BASE·HEAD
  LAST GATE / CURRENT BLOCKER / NEXT GATE / DO NOT ADVANCE UNTIL
  확인할 수 없는 항목은 추측하지 말고 UNVERIFIED로 남긴다.

  절차 전체:  docs/AI_SESSION_PROTOCOL.md
  권한 순서:  control-tower/AI_ENTRYPOINT.md
  종료할 때:  docs/WORK_LOG.md 항목 + control-tower/reports/<agent>/ 리포트
              그 다음  bash scripts/agent/ct-sync.sh push "ct: <agent> <요약>"
EOF
