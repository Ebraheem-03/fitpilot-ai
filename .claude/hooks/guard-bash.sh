#!/usr/bin/env bash
# PreToolUse(Bash): stop destructive or policy-breaking commands before they run.
set -u
source "$(dirname "$0")/_lib.sh"

input="$(cat)"
cmd="$(json_get "$input" tool_input.command)"
[ -z "$cmd" ] && exit 0

# normalise whitespace for matching
c="$(printf '%s' "$cmd" | tr '\n' ' ' | tr -s ' ')"

case "$c" in
  *"git push"*"--force"*|*"git push -f"*|*"git push"*" -f "*)
    block "force-push is not allowed. Use a new commit or ask the user." ;;
  *"git push"*" main"*|*"git push"*":main"*|*"git push origin HEAD:main"*)
    block "never push to main directly — push a feature branch and open a PR (/ship)." ;;
  *"--no-verify"*)
    block "--no-verify skips checks. Fix the failing hook/check instead." ;;
  *"git reset --hard"*|*"git clean -f"*|*"git checkout -- ."*|*"git restore ."*)
    block "this discards uncommitted work. Ask the user first, or stash." ;;
  *"rm -rf /"*|*"rm -rf ~"*|*"rm -rf \$HOME"*|*"rm -rf ."|*"rm -rf . "*|*"rm -rf *"*)
    block "broad recursive delete. Delete specific paths only." ;;
esac

# secrets: don't print .env files into the transcript
if printf '%s' "$c" | grep -Eq '(cat|less|more|head|tail|bat|sed|awk|grep|cp|scp)[^|;&]*\.env(\.|[[:space:]]|$)' \
  && ! printf '%s' "$c" | grep -q '\.env\.example'; then
  block "reading .env exposes secrets. Use .env.example for structure, or ask the user."
fi

# raw camera recordings never get committed (privacy, blueprint principle 5)
if printf '%s' "$c" | grep -Eq 'git add.*\.(mp4|webm|mov)'; then
  block "raw video must not be committed. Commit landmark JSON fixtures instead."
fi

exit 0
