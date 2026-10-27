# FitPilot AI

AI personal-training platform: 3D exercise demos (R3F) + in-browser pose analysis (MediaPipe) + grounded AI coaching + gym/trainer operations. Portfolio project built like a production system — scope, contracts, tests and evidence over demos.

@docs/roadmap/PROGRESS.md

## Where things are

- Spec (source of truth, FR-01…FR-13): `docs/requirements/fitpilot-blueprint-v1.md` — read the relevant FR section before implementing anything. Traceability: `docs/requirements/traceability.md`.
- Architecture + boundaries: `docs/architecture/overview.md`. Decisions: `docs/decisions/` (ADR-NNNN).
- `apps/web` Next.js 16 · `services/api` FastAPI · `packages/exercise-contracts` zod contracts · `packages/exercise-rules` vision analysis (pure TS) · `data/exercise-catalog` approved exercises · `data/evaluation-fixtures` vision + AI eval data. Sub-folders have their own CLAUDE.md.

## Commands

- `make setup` · `make dev` (web :3000) · `make dev-api` (api :8000) · `make db` (local Postgres)
- `make verify` = format check + lint + typecheck + all tests (JS + Python). Run it before saying work is done.
- Single package: `pnpm --filter @fitpilot/exercise-rules test` · API: `cd services/api && uv run pytest`

## Non-negotiable product rules (blueprint §3)

1. Feedback is grounded in measurements. A cue shown to a user must come from a versioned rule in `packages/exercise-rules` and carry `rule_id` + the measurements that triggered it. The LLM never invents form corrections.
2. Exercise catalogue is the source of truth. AI selects from `data/exercise-catalog`, never invents movements.
3. Unreliable tracking ⇒ say so and withhold feedback. Never fabricate.
4. Trainers can always review/override; escalation paths exist.
5. Privacy: camera frames stay in the browser; no raw video stored or uploaded; no PII in logs, fixtures or prompts beyond what's authorized.
6. Every workflow has a test. "The demo looked right" is not evidence.

## Engineering conventions

- TDD for logic: write/extend the failing test first, especially state machines, validators and authorization.
- Contracts first: change `packages/exercise-contracts` → run `export:jsonschema` → update `services/api/app/schemas` → parity test passes.
- Backend authorization on every resource; tests prove another user is denied.
- Thresholds in rules are versioned and documented as _uncalibrated_ until validated against annotated fixtures.
- Conventional commits (`feat(vision): …`, `fix(api): …`), reference FR ids in the body. Small PRs on branches `feat/<fr>-<slug>`; never commit to `main` directly.
- New architectural choice ⇒ `/adr`. Finishing a session ⇒ `/handoff`.
- Prefer current docs over memory: use the Context7 MCP (or `node_modules/next/dist/docs`) for Next 16, R3F, MediaPipe, FastAPI APIs.

## Working with me

- Plan first for anything spanning >2 files (Plan mode or `/kickoff-milestone`). Use subagents in `.claude/agents/` for specialist work and independent review.
- Don't edit generated files (`data/exercise-catalog/_schema/*`, lockfiles) by hand; hooks will block it.
- When unsure about scope, check the FR priority (P0 > P1 > P2) and the current milestone in PROGRESS.md; defer rather than ship superficially.
