# Claude Code setup for FitPilot AI

Everything Claude Code needs to work on this repo like a small FDE team: what is committed in the repo, what you already have on your account, what to add, and the daily loop.

## 1. What's in the repo (`.claude/` + friends)

### Memory / instructions

| File                                             | Loaded                       | Purpose                                                                  |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------ |
| `CLAUDE.md`                                      | every session                | Product rules, commands, conventions; imports `docs/roadmap/PROGRESS.md` |
| `apps/web/CLAUDE.md` (+ `AGENTS.md`)             | when working in the web app  | Next 16 caveats, worker/3D rules                                         |
| `services/api/CLAUDE.md`                         | when working in the API      | layering, authz, AI boundaries                                           |
| `packages/exercise-rules/CLAUDE.md`              | when working on vision rules | pipeline + rule contract                                                 |
| `CLAUDE.local.md` (create yourself, git-ignored) | your machine only            | personal notes                                                           |

### Subagents — `.claude/agents/`

| Agent                       | Model             | Use for                                                                       |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `vision-engineer`           | opus              | MediaPipe worker, `exercise-rules`, fixtures, vision regression (FR-04/05/06) |
| `threed-engineer`           | sonnet            | R3F viewer, GLB pipeline, animation controls (FR-03)                          |
| `backend-engineer`          | sonnet            | FastAPI, Alembic, authz, tenant scoping, idempotency                          |
| `ai-engineer`               | opus              | plan/nutrition generation, coaching tools, evals (FR-02/08/09/13)             |
| `test-engineer`             | sonnet            | unit/integration/e2e/vision-regression/security tests                         |
| `code-reviewer`             | sonnet, read-only | independent diff review against FRs + product rules                           |
| `security-privacy-reviewer` | opus, read-only   | access control, PII, LLM injection, secrets                                   |

Invoke by name ("use the vision-engineer to …") or let Claude delegate. `vision-engineer`, `ai-engineer` and `code-reviewer` keep project memory of recurring findings.

### Skills / slash commands — `.claude/skills/`

| Command                               | What it does                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/kickoff-milestone M1`               | Plan a milestone into FR-traced slices, riskiest spike first; optionally creates GitHub issues |
| `/implement-fr FR-05 squat depth cue` | Branch → contracts → failing tests → code → verify → review agents → traceability              |
| `/new-exercise dumbbell_biceps_curl`  | Catalogue entry + ruleset + analyzer + tests + fixture/asset folders                           |
| `/adr <title>`                        | Next numbered ADR with options/trade-offs                                                      |
| `/verify`                             | Full quality gate, summarised                                                                  |
| `/ship`                               | Verify → commit → push branch → open PR (never merges)                                         |
| `/handoff`                            | Update PROGRESS.md for the next session                                                        |
| `/trace [FR-XX]`                      | Read-only audit: acceptance criteria ↔ tests                                                   |
| _(auto)_ `vision-rule-contract`       | Loads itself when editing `packages/exercise-rules/**`                                         |

### Hooks — `.claude/settings.json` → `.claude/hooks/`

| Event                  | Script              | Effect                                                                                                             |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SessionStart           | `session-start.sh`  | Injects branch, dirty files, last commits, current milestone; warns if on `main`                                   |
| PreToolUse Bash        | `guard-bash.sh`     | Blocks force-push, push to main, `--no-verify`, `reset --hard`, broad `rm -rf`, printing `.env`, committing videos |
| PreToolUse Edit/Write  | `protect-paths.sh`  | Blocks edits to `.env*`, lockfiles, generated JSON Schemas, the frozen blueprint, video files                      |
| PostToolUse Edit/Write | `format-file.sh`    | Prettier on TS/JSON/MD/CSS; ruff format + fix on Python (feeds lint errors back to Claude)                         |
| Notification           | `notify-mac.sh`     | macOS banner when Claude needs you                                                                                 |
| SessionEnd             | `session-ledger.sh` | Appends a line to `.claude/ledger/sessions.md` (git-ignored)                                                       |

Hooks need `jq` **or** `python3` (`brew install jq` recommended).

### Permissions (`.claude/settings.json`)

Allowed without asking: pnpm/uv/make test-lint-typecheck, read-only git + `git add/commit/switch`, read-only `gh`. Asks first: `git push`, PR create/merge, adding deps, docker, rebase/reset, edits to CI workflows/settings/.mcp.json. Denied: reading/editing `.env*`, force-push, `curl | sh`. Personal overrides go in `.claude/settings.local.json` (git-ignored).

### MCP servers — `.mcp.json` (approve once when Claude Code asks)

| Server       | Why                                                                                         | Auth                                        |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `context7`   | Current docs for Next 16, R3F, MediaPipe, FastAPI — stops stale-API code                    | none (add a free API key for higher limits) |
| `playwright` | Claude drives a real browser: check the 3D viewer renders, debug camera UI, write e2e tests | none                                        |
| `supabase`   | Inspect schema, run read queries, check logs/advisors while building auth + DB              | OAuth in browser via `/mcp`                 |

## 2. Add later, when the milestone needs it

| When                     | Server     | Command (run in the repo)                                                                                    |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------ |
| M5 deploy web            | Vercel     | `claude mcp add --transport http vercel https://mcp.vercel.com` then `/mcp` to log in                        |
| M5 errors                | Sentry     | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`                                          |
| M5 API host (if Railway) | Railway    | `claude mcp add railway railway mcp` (needs Railway CLI ≥ 5.44 + `railway login`)                            |
| Optional                 | GitHub MCP | Not needed — the `gh` CLI covers issues/PRs/CI. Add `https://api.githubcopilot.com/mcp/` only if you want it |
| Optional                 | Figma      | Already enabled as a plugin on your account; use if you design screens in Figma                              |

Use `--scope project` to commit a server for the repo, `--scope user` for all your projects. Never put tokens in `.mcp.json`; use `${VAR}` expansion.

## 3. What you already have on your account and how it fits

- **Engineering plugin** — `architecture` (ADRs), `system-design`, `testing-strategy`, `code-review`, `debug`, `deploy-checklist` (before M5 deploys), `incident-response`, `documentation`, `tech-debt`, `standup`. Directly useful.
- **Design plugin** — `design-critique`, `accessibility-review` (NFR-Accessibility), `ux-copy` (feedback cue wording, empty/error states), `design-handoff`, `design-system`.
- **Figma plugin** — design-to-code and diagrams if you mock screens in Figma.
- **Setup-audit plugin** — run it after a week of use to tune this config (permissions, cost, repeated mistakes).
- **GitHub-growth plugin** — `gh-repo-polish` once M2 works (README hero GIF, topics, social preview); `gh-profile` to pin FitPilot.
- **LinkedIn-growth plugin** — build-in-public posts per milestone (`li-post`, `li-carousel` for the architecture).
- **Built-in skills** — `frontend-design` for the UI direction; `skill-creator` to turn any workflow you repeat into a new skill.
- **Connectors** (claude.ai) — Google Calendar to time-block milestones; Drive for consented test recordings (keep them out of git); Gmail/Docs/Sheets not needed for building.
- **Not needed for this project** — SEO, marketing, Postiz, study-planner.

## 4. Getting started

### On the MacBook

1. Open Terminal in the project folder and install tooling once: `brew install jq uv gh` and `corepack enable` (Node 22+ needed).
2. Create the GitHub repo and push: `gh auth login` (once), then `gh repo create Ebraheem-03/fitpilot-ai --public --source=. --remote=origin --push`.
3. `cp .env.example .env` and `make setup`, then `make verify` — everything should pass.
4. Start Claude Code in the folder: `claude`. Approve the project MCP servers when asked; run `/mcp` and log in to Supabase when you get to auth.
5. Protect `main` on GitHub (Settings → Branches → require PR + CI) so `/ship` → PR → merge is the only path.
6. First prompt: `/kickoff-milestone M0` (finish Supabase auth + profile), then `/kickoff-milestone M1`.

### On the iPhone

1. In the Claude app, open **Code** to see and steer Claude Code sessions you start in the cloud on this repo (useful for kicking off `/trace` or reviews away from the desk); local terminal sessions stay on the Mac.
2. Test the live camera flow on the phone: run `pnpm --filter @fitpilot/web dev --experimental-https` on the Mac, open `https://<mac-ip>:3000` in Safari on the same Wi-Fi, accept the certificate, allow camera.
3. GitHub mobile app → watch PR checks and approve merges.

## 5. The daily loop

`claude` → read the SessionStart summary → `/implement-fr …` (or Plan mode for bigger work) → `/verify` → `/ship` → review the PR (CI + `code-reviewer` output) → merge on GitHub → `/handoff`.
