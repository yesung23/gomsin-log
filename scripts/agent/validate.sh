#!/usr/bin/env bash
# Scope-proportional validation for GomsinLog.
#
#   validate.sh docs | app | security | migration
#
# Only invokes scripts that exist in package.json. Prints a PASS/FAIL summary and
# always restates what this environment cannot verify.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

SCOPE="${1:-app}"
FAILED=()
PASSED=()

has_script() { node -e "process.exit(require('./package.json').scripts['$1']?0:1)" 2>/dev/null; }

run() {
  local label="$1"; shift
  echo "── $label"
  if "$@" >/tmp/gomsin-validate.log 2>&1; then
    PASSED+=("$label")
  else
    FAILED+=("$label")
    tail -25 /tmp/gomsin-validate.log
  fi
}

run_npm() {
  if has_script "$1"; then run "npm run $1" npm run "$1"; else
    echo "── npm run $1: SCRIPT ABSENT — not run, not counted as pass"
  fi
}

echo "scope: $SCOPE"
run "git diff --check" git diff --check

case "$SCOPE" in
  docs) ;;
  app|security|migration)
    run_npm typecheck
    run_npm lint
    if has_script test; then run "npm test" npm test -- --run; fi
    run_npm build
    ;;
  *) echo "unknown scope: $SCOPE (use docs|app|security|migration)"; exit 2 ;;
esac

case "$SCOPE" in
  security|migration)
    run_npm test:p0
    run_npm test:phase0
    run_npm test:p5
    run_npm test:write-floor
    run_npm verify:native
    ;;
esac

[ "$SCOPE" = "migration" ] && run_npm test:rollback

echo
echo "== PASS =="; printf '  %s\n' "${PASSED[@]:-none}"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "== FAIL =="; printf '  %s\n' "${FAILED[@]}"
fi

cat <<'EOF'

== UNVERIFIED (cannot be proven in this environment) ==
  remote Supabase catalog · production migration state · staging
  physical iPhone: Secure Enclave / DeviceKeys / LCK / cold start / recovery
  iOS native build (needs full Xcode) · Android (needs SDK) · test:edge (needs deno)
  CloudKit entitlement / container
  Production: NOT APPLIED by this script.
EOF

[ ${#FAILED[@]} -eq 0 ] || exit 1
