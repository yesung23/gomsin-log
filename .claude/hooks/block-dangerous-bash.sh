#!/usr/bin/env bash
# PreToolUse guard for Bash commands in the GomsinLog repository.
#
# Deterministic refusals only. Each pattern below is something this project has
# explicitly forbidden and that no normal development loop needs. Anything
# ambiguous is deliberately NOT blocked here: a false refusal is worse than a
# prompt-level rule, because it stops legitimate work with no way forward.
#
# Contract: read the tool call as JSON on stdin. Exit 0 to allow. Exit 2 with a
# reason on stderr to deny.
set -uo pipefail

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.command??"");}
  catch{process.stdout.write("");}
});' 2>/dev/null)"

[ -z "$CMD" ] && exit 0

deny() {
  echo "BLOCKED by .claude/hooks/block-dangerous-bash.sh: $1" >&2
  echo "If this is genuinely required, the user must run it themselves or explicitly authorize it." >&2
  exit 2
}

# 1. Production / remote Supabase mutation. Linking or pushing applies migrations
#    to a real project; this repository forbids that from an automated loop.
case "$CMD" in
  *"supabase db push"*|*"supabase link"*|*"supabase db reset --linked"*|*"supabase migration up --linked"*)
    deny "remote Supabase migration application / project link (Production mutation)" ;;
esac

# 2. Destructive or history-rewriting git operations.
case "$CMD" in
  *"git push"*"--force"*|*"git push"*" -f"*) deny "force push" ;;
  *"git reset --hard"*)                      deny "git reset --hard (loses user work)" ;;
  *"git clean -f"*|*"git clean"*"-fd"*)      deny "git clean -f (deletes untracked user files)" ;;
  *"git checkout -- "*|*"git restore"*"--worktree"*) deny "discarding worktree changes" ;;
  *"git branch -D"*)                         deny "force branch delete" ;;
esac

# 3. Writing to the default branch, or merging. Both are explicitly reserved.
case "$CMD" in
  *"git push"*" master"*|*"git push"*" origin master"*) deny "direct push to master" ;;
  *"git merge"*)      deny "git merge (master merge and PR merge are reserved for the user)" ;;
  *"gh pr merge"*)    deny "gh pr merge (PR merge is reserved for the user)" ;;
esac

# 4. Frozen migration reuse. 041/042 are preserved-but-never-applied assets.
case "$CMD" in
  *"041_"*|*"042_"*)
    case "$CMD" in
      *rm*|*mv*|*cp*|*">"*|*tee*) deny "frozen migration 041/042 must not be reused or rewritten" ;;
    esac ;;
esac

# 5. Reading or printing credential material.
case "$CMD" in
  *"cat .env"*|*"cat "*"/.env"*|*"SERVICE_ROLE"*|*"service_role_key"*|*"printenv"*)
    deny "credential/secret material must never be read or printed" ;;
esac

exit 0
