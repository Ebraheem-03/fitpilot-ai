#!/usr/bin/env bash
# SessionEnd: append one line per session to a local, git-ignored ledger (.claude/ledger/sessions.md).
# Useful for your own retros and portfolio write-ups; /handoff writes the curated summary to PROGRESS.md.
set -u
source "$(dirname "$0")/_lib.sh"
input="$(cat)"
root="$(project_dir)"
mkdir -p "$root/.claude/ledger"
sid="$(json_get "$input" session_id)"
reason="$(json_get "$input" reason)"
cd "$root" || exit 0
branch="$(git branch --show-current 2>/dev/null)"
head="$(git log -1 --format='%h %s' 2>/dev/null)"
dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
printf -- '- %s | %s | branch=%s | head=%s | uncommitted=%s | end=%s\n' \
  "$(date '+%Y-%m-%d %H:%M')" "${sid:0:8}" "$branch" "$head" "$dirty" "$reason" >> .claude/ledger/sessions.md
exit 0
