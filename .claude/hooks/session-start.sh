#!/usr/bin/env bash
# SessionStart: stdout is added to Claude's context. Keep it short.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0

echo "## FitPilot session context"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git branch --show-current 2>/dev/null)"
  echo "- branch: ${branch:-detached}"
  [ "$branch" = "main" ] && echo "- ⚠ on main: create a feature branch (feat/<fr>-<slug>) before editing."
  dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo "- uncommitted files: $dirty"
  echo "- last commits:"; git log --oneline -3 2>/dev/null | sed 's/^/  /'
fi
[ -f .env ] || echo "- note: no .env yet (cp .env.example .env)"
[ -d node_modules ] || echo "- note: deps not installed (make setup)"
echo "- current milestone: $(grep -m1 '^Current milestone' docs/roadmap/PROGRESS.md 2>/dev/null | sed 's/Current milestone: //')"
exit 0
