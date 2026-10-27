---
name: verify
description: Run the full FitPilot quality gate (format, lint, typecheck, JS tests, Python lint/type/tests) and summarise failures with likely causes. Use before claiming any task is done.
allowed-tools: Bash(make verify) Bash(pnpm *) Bash(uv run *)
---

Run `make verify` from the repo root.

- If it passes, report one line: what ran and that it passed.
- If it fails, group failures by tool/package, show the first relevant error for each with file:line, state the likely cause, and propose (or, if you are mid-task, apply) the fix. Re-run until green.
- Never mark a test skipped, loosen a type, or add `# type: ignore` / `eslint-disable` to get green without saying so explicitly and why.
- If `node_modules` or `.venv` is missing, run `make setup` first.
