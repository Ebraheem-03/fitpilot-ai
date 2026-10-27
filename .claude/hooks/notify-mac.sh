#!/usr/bin/env bash
# Notification: macOS banner when Claude needs input or permission. No-op elsewhere.
set -u
source "$(dirname "$0")/_lib.sh"
input="$(cat)"
msg="$(json_get "$input" message)"
command -v osascript >/dev/null 2>&1 || exit 0
msg="${msg//\"/\'}"
osascript -e "display notification \"${msg:-Claude needs your input}\" with title \"FitPilot · Claude Code\"" >/dev/null 2>&1
exit 0
