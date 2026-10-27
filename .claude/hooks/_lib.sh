#!/usr/bin/env bash
# Shared helpers for FitPilot hooks. Hooks get the event JSON on stdin.

# json_get <json> <dot.path>  — jq if present, else python3, else empty string.
json_get() {
  local json="$1" path="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r ".${path} // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
print("" if d is None else d)' "$path" 2>/dev/null
  fi
}

project_dir() { printf '%s' "${CLAUDE_PROJECT_DIR:-$(pwd)}"; }

# block <reason> — PreToolUse: exit 2 blocks the tool call, stderr is shown to Claude.
block() { echo "Blocked by FitPilot hook: $1" >&2; exit 2; }
