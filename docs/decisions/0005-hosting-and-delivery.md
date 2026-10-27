# ADR-0005: Hosting — Vercel (web), container host (API), Supabase (data), GitHub Actions (CI)

- **Status:** proposed (confirm before M5)
- **Date:** 2026-10-27
- **Requirements:** NFR-Portability, NFR-Availability, FR-13

## Proposal

| Piece           | Host                               | Why                                                             |
| --------------- | ---------------------------------- | --------------------------------------------------------------- |
| `apps/web`      | Vercel Hobby                       | First-class Next.js, preview deploy per PR, official MCP server |
| `services/api`  | Render / Railway / Fly.io (Docker) | Same Dockerfile everywhere; pick on free-tier terms at M5       |
| DB/Auth/Storage | Supabase                           | ADR-0003                                                        |
| Errors          | Sentry (free)                      | Frontend + API, has an MCP server for Claude Code triage        |
| LLM traces      | Langfuse cloud (free)              | Latency/cost/eval traces (FR-13)                                |
| CI              | GitHub Actions                     | `.github/workflows/ci.yml`                                      |

## Consequences

Free API hosts sleep when idle → first request is slow; acceptable for a portfolio demo, documented in the runbook. Re-evaluate before any pilot.
