#!/usr/bin/env bash
# 작업 종류별로 AI에게 줄 파일 목록을 낸다. 정의의 집은 control-tower/Context Packs.md
# 하나이며, 이 스크립트는 그 파일을 파싱할 뿐 자체 목록을 갖지 않는다.
#
#   context-pack.sh --list          팩 이름 전부
#   context-pack.sh common          목록 + 존재·추적 검사
#   context-pack.sh release --paths 경로만 (파이프용)
#
# 어떤 팩도 권위를 주지 않는다. 현재 구현 사실은 코드와 live GitHub가 문서를 이긴다.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

SRC="control-tower/Context Packs.md"
[ -f "$SRC" ] || { echo "팩 정의가 없다: $SRC" >&2; exit 1; }

SRC="$SRC" PACK="${1:---list}" FMT="${2:-}" python3 - <<'PY'
import os, re, subprocess, sys

src, want, fmt = os.environ["SRC"], os.environ["PACK"], os.environ["FMT"]
text = open(src, encoding="utf-8").read()

packs, order = {}, []
for m in re.finditer(r"<!--\s*pack:\s*(\S+?)(?:\s+extends:\s*(\S+?))?\s*-->(.*?)<!--\s*/pack\s*-->",
                     text, re.S):
    key, ext, body = m.group(1), m.group(2), m.group(3)
    items = []
    for line in body.splitlines():
        p = re.match(r"\s*(?:\d+\.|[-*])\s+`([^`]+)`", line)
        if p:
            items.append((p.group(1), "optional" in line))
    packs[key] = {"extends": ext, "items": items}
    order.append(key)

if want in ("--list", "-l"):
    print("정의된 팩:")
    for k in order:
        ext = f"  (+ {packs[k]['extends']})" if packs[k]["extends"] else ""
        print(f"  {k:<10} {len(packs[k]['items'])}개{ext}")
    print(f"\n정의의 집: {src}")
    raise SystemExit

if want not in packs:
    sys.exit(f"그런 팩이 없다: {want}\n있는 것: {', '.join(order)}")

seen, resolved = set(), []
def collect(k):
    if k in seen: return
    seen.add(k)
    if packs[k]["extends"]: collect(packs[k]["extends"])
    for path, opt in packs[k]["items"]:
        if path not in [r[0] for r in resolved]:
            resolved.append((path, opt))
collect(want)

tracked = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split("\n"))

if fmt == "--paths":
    for path, _ in resolved:
        print(path)
    raise SystemExit

print(f"== pack: {want} ({len(resolved)} files) ==\n")
missing = untracked = 0
for path, opt in resolved:
    tag = "  [선택 · NON-CANONICAL]" if opt else ""
    if not os.path.exists(path):
        print(f"  ❌ 없음      {path}{tag}"); missing += 1
    elif path not in tracked:
        print(f"  ⚠️  UNTRACKED {path}{tag}   ← 다른 AI는 git으로 받을 수 없다"); untracked += 1
    else:
        print(f"  ok          {path}{tag}")

print()
if missing:   print(f"  ❌ 실재하지 않는 경로 {missing}건 — '{src}'를 고친다")
if untracked: print(f"  ⚠️  추적되지 않는 파일 {untracked}건 — 커밋하지 않으면 이 팩은 이 기기에서만 성립한다")
print("\n  여기에 `bash scripts/agent/session-start.sh` 출력을 함께 준다.")
print("  문서는 의도를, 그 출력은 지금 사실을 싣는다. 코드와 live GitHub가 문서를 이긴다.")
PY
