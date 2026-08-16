#!/usr/bin/env bash
# Live repository state for GomsinLog session recovery.
#
# Read-only. Prints the volatile facts that documents must never be trusted for:
# branch, HEAD, working-tree cleanliness, active migration numbers, and open PRs.
# Never prints secrets, tokens, or file contents.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

echo "== branch / HEAD =="
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD

echo
echo "== tracked changes (untracked omitted) =="
git status --short --untracked-files=no || true

echo
echo "== recent commits =="
git log --oneline -5 || true

echo
echo "== active migrations (last 6; 041/042 are frozen and absent by design) =="
ls supabase/migrations/*.sql 2>/dev/null | tail -6 || echo "none"

echo
echo "== open PRs =="
if command -v gh >/dev/null 2>&1; then
  gh pr list --state open \
    --json number,headRefName,headRefOid,isDraft,baseRefName,mergeStateStatus \
    -q '.[] | "PR#\(.number) \(.headRefName) @\(.headRefOid[0:7]) draft=\(.isDraft) base=\(.baseRefName) \(.mergeStateStatus)"' \
    2>/dev/null | head -12 || echo "gh present but PR query failed — treat PR state as UNVERIFIED"
else
  echo "gh absent — treat PR/CI state as UNVERIFIED"
fi

echo
echo "== remote Supabase catalog / production migration state =="
echo "UNVERIFIED — not queried by this script and never mutated by it."
