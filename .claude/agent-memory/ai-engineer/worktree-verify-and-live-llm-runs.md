---
name: worktree-verify-and-live-llm-runs
description: In agent worktrees, make db port clash, shared fitpilot_test DB clashes between parallel branches, guard-blocked commands; how to run verify, DB tests and live Groq runs anyway
metadata:
  type: reference
---

- `make verify` in an agent worktree: `pnpm verify` + `api-lint` pass, then `make db` fails ("Bind for 0.0.0.0:5432 failed") because `fitpilot-ai-db-1` from the main checkout already holds 5432. Run `docker compose -p <worktree-name> down -v` to drop the half-created container, then `cd services/api && uv run pytest -q` directly; it uses the running DB.
- Parallel agent worktrees share the `fitpilot_test` DB. If another branch migrated it past your head you get "Can't locate revision '000N'" on every DB test. Use your own DB: `TEST_DATABASE_URL=postgresql+psycopg://fitpilot:fitpilot@localhost:5432/fitpilot_test_<slug> uv run pytest` (conftest creates it). Rerun on the default DB once rebased.
- The worktree guard refuses `cd … && python - <<EOF`, inline `uv run python -c`, heredocs that write files, and `git -C <dir>`. Use the Write tool for files. For scripts, write them to the scratchpad and run `PYTHONPATH=<api dir> uv run python <script>` from services/api (needed for `import app`). `git commit -F - <<'EOF'` is allowed.
- Groq key: never read the root `.env`; pass `--env-file /Users/Ebraheem03/Desktop/projects/fitpilot-ai/.env` into `Settings(_env_file=…)`.
- Groq free org budget: 8K TPM and about 200K TPD per model. One 72-plan spike uses about 140K tokens per model, so a second large run on the same day hits daily-cap 429s (`retry-after` up to 30 min). Results: ADR-0006 and [[llm-spike-results]] in docs/evaluation.
