---
name: handoff
description: End-of-session handoff — update PROGRESS.md (ticked items, current milestone, next 3 actions, one-line session log) so the next session starts with accurate context.
disable-model-invocation: true
---

Write the session handoff.

1. Look at what changed this session: `git log --oneline` since the last session-log date in `docs/roadmap/PROGRESS.md`, plus `git status`.
2. In `docs/roadmap/PROGRESS.md`: tick finished items (only if their tests exist and pass), update "Current milestone" and "Next up" with the next 1–3 concrete actions, add any new open decisions, and prepend one line to "Session log" (`YYYY-MM-DD — what moved, what's blocked`).
3. Keep the file under ~120 lines: collapse finished milestones to a single summary line.
4. If there is uncommitted work, list it and ask whether to commit it as WIP on the current branch.
