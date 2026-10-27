# ADR-0001: Modular monolith in a pnpm + uv monorepo

- **Status:** accepted
- **Date:** 2026-10-27
- **Requirements:** NFR-Maintainability, NFR-Portability

## Context

Solo developer, 12-week plan, three runtimes (browser TS, Node build tooling, Python API). The blueprint (§5) rejects microservices for v1 and requires shared contracts between browser and backend (§12).

## Decision

One repository: `apps/web` (Next.js), `services/api` (FastAPI), `packages/*` (shared TS). pnpm workspaces for JS, uv for Python. Contracts live in `packages/exercise-contracts` (zod) and are exported to JSON Schema in `data/exercise-catalog/_schema`, which the Python mirror is tested against.

## Consequences

- One PR can change contract + browser + API together; CI runs everything.
- Python cannot import TS types directly — the parity test is the guard. Revisit with codegen (datamodel-code-generator) if the contract count grows.
