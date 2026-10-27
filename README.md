# FitPilot AI

> See the exercise. Do it in front of your camera. Get feedback that is grounded in what was actually measured.

AI personal-training platform combining an interactive **3D exercise trainer**, **in-browser pose analysis** (MediaPipe, nothing uploaded), **validated AI-generated plans and coaching**, and **trainer/gym oversight**. Built as a production-minded portfolio system: explicit requirements (FR-01…FR-13), contracts, tests as evidence, observability.

|                   |                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec              | [`docs/requirements/fitpilot-blueprint-v1.md`](docs/requirements/fitpilot-blueprint-v1.md) · [traceability](docs/requirements/traceability.md) |
| Architecture      | [`docs/architecture/overview.md`](docs/architecture/overview.md) · [ADRs](docs/decisions)                                                      |
| Progress          | [`docs/roadmap/PROGRESS.md`](docs/roadmap/PROGRESS.md)                                                                                         |
| Dev setup         | [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md)                                                                                     |
| Claude Code setup | [`docs/claude-code-setup.md`](docs/claude-code-setup.md)                                                                                       |

## Stack

Next.js 16 · React 19 · Tailwind 4 · Three.js / React Three Fiber · MediaPipe Pose Landmarker (Web Worker) · FastAPI · Pydantic 2 · SQLAlchemy 2 · Postgres + pgvector (Supabase) · Vitest · Playwright · pytest · GitHub Actions

## Quick start

```bash
cp .env.example .env
make setup      # pnpm install + uv sync
make dev        # http://localhost:3000
make dev-api    # http://localhost:8000/docs
make verify     # everything CI runs
```

## Repository layout

```
apps/web                    Next.js app (member · trainer · admin)
services/api                FastAPI (auth, plans, sessions, AI orchestration)
packages/exercise-contracts zod contracts shared by browser + API (→ JSON Schema)
packages/exercise-rules     vision pipeline stages 2–5, pure TS, unit-tested
data/exercise-catalog       approved exercises — the AI's only source of movements
data/evaluation-fixtures    annotated landmark sequences + AI eval cases
assets/exercises            GLB avatar animations
docs/                       requirements, architecture, ADRs, roadmap, runbooks
.claude/                    Claude Code agents, skills, hooks, settings
```

## Status

MVP in progress — see the Definition of Done checklist in [traceability](docs/requirements/traceability.md). Not a substitute for a qualified trainer; feedback is limited to what the camera can reliably measure.
