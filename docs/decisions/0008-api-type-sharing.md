# ADR-0008: Sharing API types with the web app

- **Status:** accepted (2026-10-28) · revisit at M3 kickoff
- **Date:** 2026-10-28
- **Requirements:** FR-01, NFR-Maintainability

## Context

The web app calls FastAPI from server components and needs the request/response shapes. M0 has two resources (`/users/me`, `/profiles`) and four small enums. Exercise and session-event contracts already flow TS → JSON Schema → Python (ADR-0001). API-owned resources are defined in Pydantic, so they would need to flow the other way.

## Options considered

| Option                                                               | Pros                                                            | Cons                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Hand-written TS mirror + parity test**                             | Zero tooling; readable types; the test catches enum drift in CI | Field-shape drift (not just enums) is only caught by e2e               |
| OpenAPI → `openapi-typescript` codegen                               | Exact types for every endpoint; scales with the API             | Generated file + CI step to keep fresh; awkward for two endpoints      |
| Move profile/user contracts into `packages/exercise-contracts` (zod) | One source like exercises                                       | Inverts ownership: the API validates, so Pydantic should be the source |

## Decision

For M0, keep `apps/web/src/lib/api-types.ts` hand-written. `services/api/tests/test_web_enum_parity.py` fails CI when any enum (goal, experience, equipment, role) diverges from the Pydantic definitions. Response shapes are exercised end-to-end by `tests/e2e/profile.spec.ts`.

Switch to OpenAPI codegen when the API exposes more than about 5 resources or the first nested response model lands. That is expected at M3 (training plans).

## Consequences

- Adding an enum value requires editing both sides; the parity test reports which side is wrong.
- Revisit this ADR at `/kickoff-milestone M3`.
