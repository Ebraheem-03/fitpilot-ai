#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit): protect secrets and generated files.
set -u
source "$(dirname "$0")/_lib.sh"

input="$(cat)"
file="$(json_get "$input" tool_input.file_path)"
[ -z "$file" ] && exit 0

root="$(project_dir)"
rel="${file#"$root"/}"

case "$rel" in
  .env|.env.*)
    [ "$rel" = ".env.example" ] && exit 0
    block "$rel holds secrets — the user edits it, not Claude." ;;
  pnpm-lock.yaml|*/pnpm-lock.yaml|services/api/uv.lock)
    block "$rel is generated. Change package.json / pyproject.toml and run pnpm install / uv sync." ;;
  data/exercise-catalog/_schema/*)
    block "$rel is generated from packages/exercise-contracts. Run: pnpm --filter @fitpilot/exercise-contracts export:jsonschema" ;;
  docs/requirements/fitpilot-blueprint-v1.md)
    block "the v1 blueprint is frozen. Propose changes in a new ADR or blueprint v1.1 file." ;;
  *.mp4|*.webm|*.mov)
    block "no video files in the repo (privacy)." ;;
esac

exit 0
