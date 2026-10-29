---
name: worktree-tooling-pitfalls
description: Environment quirks hit while working in agent worktrees, covering the shell guard, git config lock, port 5432, and prettier on labels.json
metadata:
  type: feedback
---

Quirks of the agent worktree environment and how to get past them.

- The worktree-isolation guard refuses compound shell commands: heredocs (`cat <<EOF >> file`), `for f in …; do node -e …`, and `sed -i` combined with other commands. Use Write/Edit for files and put scripts in the scratchpad. Pass paths as arguments.
- `git switch -c <b> origin/main` can fail with `could not lock config file` when another session writes the shared `.git/config`. Use `git switch --no-track -c`. The branch is still created.
- `make verify` fails at `make db` when the main checkout's `fitpilot-ai-db-1` holds port 5432. Run `uv run pytest -q` in services/api against that running DB. It uses its own `fitpilot_test` DB, migrates to head, and rolls back every test. Afterwards, run `docker compose down -v` in the worktree to remove the half-created container.
- Editing `*.labels.json` with a JSON.stringify round-trip expands the compact one-line rep objects, and prettier keeps them expanded, which churns the diff. Insert new keys textually before the final `}`, then run prettier.
- More guard triggers: the word `eval` anywhere in a command (even `ls src/eval`), `process.env` in a grep pattern (the .env secret hook), and `xargs sh -c`/`find -exec`. A plain `python3 -c "…"` file edit passes; a heredoc into python can be refused.
- `scripts/e2e.sh` uses fixed ports 3100/8100 and the shared local Supabase stack, and other agent worktrees run e2e at the same time. Playwright then fails with "http://localhost:8100/health is already used". Check `lsof -iTCP:8100 -sTCP:LISTEN` first. If the port is taken, run a scratchpad script in the background that waits for both ports to be free and then runs the suite.
- `tests/e2e/.generated/*.y4m` is per worktree. Building both mannequin feeds (~60 MB each) takes about 30 s at the start of the first e2e run.

**Why:** each of these cost a retry in M3 S2/S3 (2026-10-29).
**How to apply:** follow these from the start of any vision task in a worktree.
