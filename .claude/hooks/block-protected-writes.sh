#!/usr/bin/env bash
# PreToolUse guard for file writes (Write/Edit) in the GomsinLog repository.
#
# Only refuses paths this project has explicitly frozen or classified as secret.
# Ordinary source, test, doc, and new-migration paths are untouched.
set -uo pipefail

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);const i=j.tool_input??{};
    process.stdout.write(i.file_path??i.path??i.notebook_path??"");}
  catch{process.stdout.write("");}
});' 2>/dev/null)"

[ -z "$FILE" ] && exit 0

deny() {
  echo "BLOCKED by .claude/hooks/block-protected-writes.sh: $1" >&2
  exit 2
}

BASE="$(basename "$FILE")"

# Frozen migrations: preserved for traceability, never applied, never rewritten.
case "$BASE" in
  041_*|042_*) deny "migration 041/042 is frozen — create a new forward migration instead" ;;
esac

# Already-applied migrations must not be edited in place; add a forward file.
case "$FILE" in
  *supabase/migrations/*.sql)
    if [ -f "$FILE" ]; then
      deny "existing migration $BASE must not be rewritten — add the next numbered forward migration"
    fi ;;
esac

# Credential material.
case "$BASE" in
  .env|.env.*|*.pem|*.p8|*.p12|*.keystore|*.jks) deny "credential file must not be written by an agent" ;;
esac

exit 0
