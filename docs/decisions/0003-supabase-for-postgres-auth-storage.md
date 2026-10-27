# ADR-0003: Supabase for Postgres, Auth and object storage

- **Status:** proposed (confirm in M0)
- **Date:** 2026-10-27
- **Requirements:** FR-01, FR-11, NFR-Security, blueprint §5 "managed auth service"

## Context

The blueprint wants PostgreSQL (+ optional pgvector), a managed identity provider to avoid custom auth, and object storage for GLB assets. Budget: free tiers.

## Options considered

| Option                             | Pros                                                                                  | Cons                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Supabase (free)                    | Postgres 17 + pgvector, Auth (JWT), Storage, RLS, official MCP server for Claude Code | Free projects pause after inactivity; vendor coupling on auth |
| Neon + Clerk + R2                  | Strong DX each                                                                        | Three vendors, three dashboards                               |
| Self-hosted Postgres + custom auth | Full control                                                                          | Highest risk, rejected by blueprint                           |

## Decision

Supabase. FastAPI verifies Supabase JWTs and remains the authorization authority (role, tenant, trainer assignment checks happen in the API, not only in RLS). RLS is enabled as defence in depth. Local dev uses `docker compose up db` (pgvector image) or the Supabase CLI.

## Consequences

- Schema managed by Alembic in `services/api` (single migration source of truth); do not edit tables in the Supabase dashboard.
- Authorization tests must cover member↔member and trainer↔unassigned-member denial (FR-01, FR-11 acceptance criteria).
