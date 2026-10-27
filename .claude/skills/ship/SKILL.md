---
name: ship
description: Verify, commit, push the current feature branch and open a GitHub pull request using the repo's PR template.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh pr *) Bash(make verify)
---

Ship the current branch.

1. Refuse if on `main`; suggest a branch name instead.
2. Run `make verify`. Stop and report if it fails.
3. Show `git status` and `git diff --stat main...HEAD`. Stage only intended files (never `.env*`, videos, build output).
4. Commit with a conventional message (`feat(scope): summary`) whose body lists the FR ids and the evidence (tests added).
5. `git push -u origin <branch>` (will ask permission).
6. `gh pr create --base main --title "<conventional title>" --body "<body>"` with a body following `.github/pull_request_template.md`: What, FR ids, Evidence checklist ticked honestly.
7. Print the PR URL and `gh pr checks` status. Do not merge — merging is the user's call.
