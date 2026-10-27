#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit): format the touched file so diffs stay clean.
# Never blocks: formatting failures are reported to Claude via stderr + exit 2 only for lint errors on .py.
set -u
source "$(dirname "$0")/_lib.sh"

input="$(cat)"
file="$(json_get "$input" tool_input.file_path)"
[ -z "$file" ] || [ ! -f "$file" ] && exit 0
root="$(project_dir)"

case "$file" in
  "$root"/services/api/*.py)
    if command -v uv >/dev/null 2>&1; then
      (cd "$root/services/api" && uv run --quiet ruff format "$file" >/dev/null 2>&1 \
        && uv run --quiet ruff check --fix "$file" >/tmp/fitpilot-ruff.$$ 2>&1) \
        || { echo "ruff found issues in $file:" >&2; tail -20 /tmp/fitpilot-ruff.$$ >&2; rm -f /tmp/fitpilot-ruff.$$; exit 2; }
      rm -f /tmp/fitpilot-ruff.$$
    fi ;;
  *.ts|*.tsx|*.js|*.mjs|*.json|*.css|*.md|*.yml|*.yaml)
    if [ -x "$root/node_modules/.bin/prettier" ]; then
      "$root/node_modules/.bin/prettier" --write --log-level warn "$file" >/dev/null 2>&1 || true
    fi ;;
esac
exit 0
