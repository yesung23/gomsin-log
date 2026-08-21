#!/usr/bin/env bash
# Obsidian이 이 저장소의 control-tower/ 를 vault로 열게 한다 (macOS).
#
#   bash scripts/agent/obsidian-open-vault.sh          등록 + 다른 control-tower 사본 등록 해제
#   bash scripts/agent/obsidian-open-vault.sh --list    현재 등록된 vault 보기
#
# 왜 필요한가: control-tower/ 사본이 여러 개 있으면 Obsidian이 낡은 쪽을 열고, AI들은
# 최신 기억을 못 본다. 실제로 그렇게 됐었다. 이 스크립트는 이 저장소 안의 vault 하나만
# 남긴다. **Obsidian을 완전히 종료(⌘Q)한 뒤 실행한다** — 실행 중이면 종료할 때 덮어쓴다.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

CFG="$HOME/Library/Application Support/obsidian/obsidian.json"
[ -f "$CFG" ] || { echo "Obsidian 설정을 찾지 못했다: $CFG" >&2; exit 1; }

if pgrep -x Obsidian >/dev/null 2>&1 && [ "${1:-}" != "--list" ]; then
  echo "Obsidian이 실행 중이다. ⌘Q로 완전히 종료한 뒤 다시 실행한다." >&2
  echo "(종료하지 않으면 Obsidian이 종료할 때 이 변경을 덮어쓴다.)" >&2
  exit 1
fi

VAULT="$(pwd)/control-tower"
[ -d "$VAULT" ] || { echo "vault 폴더가 없다: $VAULT" >&2; exit 1; }

CFG="$CFG" VAULT="$VAULT" MODE="${1:-apply}" python3 - <<'PY'
import json, os, shutil, hashlib, time

cfg, vault, mode = os.environ["CFG"], os.environ["VAULT"], os.environ["MODE"]
d = json.load(open(cfg, encoding="utf-8"))
vaults = d.setdefault("vaults", {})

if mode == "--list":
    for k, v in vaults.items():
        print(f"  {'* ' if v.get('open') else '  '}{v.get('path')}   [{k}]")
    raise SystemExit

shutil.copy2(cfg, cfg + ".bak-" + time.strftime("%Y%m%d-%H%M%S"))

dropped = [v["path"] for k, v in list(vaults.items())
           if v.get("path", "").rstrip("/") != vault and
              os.path.basename(v.get("path", "").rstrip("/")) == "control-tower"]
vaults = {k: v for k, v in vaults.items()
          if v.get("path", "").rstrip("/") == vault or
             os.path.basename(v.get("path", "").rstrip("/")) != "control-tower"}

vid = next((k for k, v in vaults.items() if v.get("path", "").rstrip("/") == vault),
           hashlib.sha256(vault.encode()).hexdigest()[:16])
for v in vaults.values():
    v["open"] = False
vaults[vid] = {"path": vault, "ts": int(time.time() * 1000), "open": True}

d["vaults"] = vaults
json.dump(d, open(cfg, "w", encoding="utf-8"), ensure_ascii=False)

print(f"등록: {vault}")
for p in dropped:
    print(f"등록 해제(낡은 사본): {p}")
print("\nObsidian을 다시 열면 이 vault가 열린다. 먼저 [[Start Here]] 를 읽는다.")
PY
