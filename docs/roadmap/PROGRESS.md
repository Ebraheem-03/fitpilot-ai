# Progress

Current milestone: **M0 — Foundation** (scaffold done, plan agreed 2026-10-27)
Next up: M0 spike S0 (auth token handoff), then slices 1–8 below.

> Claude: read this file at the start of a session (the SessionStart hook prints the top of it).
> Update it with `/handoff` at the end of a session. Keep it short — history lives in git.

## Milestones (blueprint §11)

### M0 — Foundation (wk 1–2)

- [x] Monorepo, pnpm + uv, lint, format, tests, CI workflow
- [x] Exercise contract (zod) + JSON Schema export + Python mirror with parity test
- [x] One seeded exercise (`bodyweight_squat`) served by `GET /api/v1/exercises`
- [x] ADRs 0001–0005 (0003, 0005 still _proposed_)
- [x] Seed of `exercise-rules`: angle, EMA, confidence gate, squat state machine (+ unit tests)

**Exit (verbatim, §11):** "the application runs reproducibly and a signed-in member can access their own profile."
Proven by: S7's e2e test (sign up → create profile → sign out → sign in → see own profile) green in CI, plus `make verify` green on a fresh clone.

Estimates: S ≤ ½ day · M 1–2 days · L 3+ days. Owner "main" = main session (no frontend subagent exists); tests by `test-engineer`.

- [ ] **S0 spike: auth token handoff (riskiest unknown, time-box 1 day)** (#6) · FR-01 · `backend-engineer` + main · M · deps: none
  - Questions: does the new Supabase project sign with asymmetric keys (JWKS, ES256) or the legacy HS256 secret (`config.supabase_jwt_secret` assumes HS256)? How does Next 16 (`proxy.ts`, not `middleware.ts`) + `@supabase/ssr` keep the session cookie and pass the access token to FastAPI? Can pytest mint valid tokens offline with a local keypair? How does Playwright authenticate in CI (local Supabase CLI stack vs dedicated test project)?
  - Done when: throwaway branch signs in on web, calls the API with a bearer token, and the API verifies it; findings recorded and ADR-0003 → _accepted_; ADR-0007 drafted.
  - Needs from you: create the Supabase project (and authorise the `supabase` MCP); Claude can't do the OAuth step here.
- [ ] **S1 Reproducible baseline** (#7) · NFR-Portability, FR-13 · `test-engineer` · S · deps: none
  - Tests: `make verify` runs everything CI runs (it currently skips `mypy app`); CI `api` job gets a Postgres 17 service container; fresh-clone `make setup && make verify` is green; `.env.example` lists the Supabase vars.
  - Files: `Makefile`, `.github/workflows/ci.yml`, `.env.example`, `docs/runbooks/local-dev.md`
- [ ] **S2 DB foundation + first migration** (#8) · FR-01, FR-11 (schema only) · `backend-engineer` · M · deps: S1
  - Tests: `alembic upgrade head` then `downgrade base` round-trip on real Postgres; `alembic check` reports no model/migration drift; **RLS is enabled on every `public` table** (Supabase's Data API exposes `public` to the anon key, so default-deny is required); pytest fixture with per-test transaction rollback.
  - Files: `services/api/app/models/{base,user,profile,gym}.py`, `app/core/db.py`, `alembic/`, `tests/conftest.py`
  - Tables: `users` (keyed by Supabase `sub`, `role`, status), `member_profiles` (goals, experience, availability, equipment, preferences), `gyms`, `gym_memberships`.
- [ ] **S3 API authentication dependency** (#9) · FR-01, NFR-Security · `backend-engineer` · M · deps: S0, S2
  - Tests: missing, malformed, expired, wrong-issuer/audience and bad-signature tokens → 401; a valid token provisions a `users` row just in time, only once (idempotent); the role comes from the DB, never from client-editable token claims.
  - Files: `app/core/security.py`, `app/api/deps.py`, `app/repositories/users.py`, `tests/test_auth.py`
- [ ] **S4 Profiles API** (#10) · FR-01 · `backend-engineer`, reviewed by `security-privacy-reviewer` · M · deps: S3
  - Tests: `POST /api/v1/profiles` creates the caller's profile (a repeat call is idempotent or returns 409, decided in the slice); `GET /api/v1/profiles/me` → 200 own / 404 none / 401 anonymous; **member B's token never returns A's profile**; a `user_id`/`role` in the body is ignored or rejected (no mass assignment); invalid enums/lengths → 422.
  - Files: `app/api/v1/profiles.py`, `app/services/profiles.py`, `app/repositories/profiles.py`, `app/schemas/profile.py`, `tests/test_profiles.py`
- [ ] **S5 Observability baseline** (#11) · FR-13 · `backend-engineer` · S · deps: S3
  - Tests: JSON log lines carry `event`, `request_id`, `user_id` (UUID only), status and latency; a 401 produces an `auth.rejected` event; captured logs contain no token, email or profile fields.
  - Files: `app/core/logging.py`, request-id middleware in `app/main.py`, `tests/test_logging.py`
- [ ] **S6 Web auth flows** (#12) · FR-01 · main + `test-engineer` · M · deps: S0
  - Tests: Playwright sign-up, sign-in and sign-out; an unauthenticated visit to `/app/*` redirects to `/sign-in`; a bad password shows an accessible error. This uses the CI auth strategy chosen in S0.
  - Files: `apps/web/src/proxy.ts`, `src/lib/supabase/{server,client}.ts`, `src/app/(auth)/{sign-in,sign-up}/`, `tests/e2e/auth.spec.ts`
- [ ] **S7 App shell, design tokens, own-profile page (exit test)** (#13) · FR-01, NFR-Accessibility · main + `test-engineer` · L · deps: S4, S6
  - Tests: Vitest component tests show the nav differs for member, trainer and admin (adds `@testing-library/react` + jsdom); a skip link and keyboard-only navigation work; an axe check has no serious violations; **exit e2e: sign up → minimal onboarding form → sign out → sign in → `/app/profile` shows the saved profile**.
  - Files: `src/app/globals.css` (`@theme` tokens, light/dark), `src/app/(app)/layout.tsx`, `src/features/shell/`, `src/features/onboarding/`, `src/lib/api.ts`, `tests/e2e/profile.spec.ts`
- [ ] **S8 Close-out** (#14) · all · `code-reviewer`, `security-privacy-reviewer` · S · deps: S1–S7
  - Independent review; update `traceability.md` (FR-01 → 🟨, with the cross-member test linked); confirm ADR-0003/0007/0008; `/handoff`.

**Out of scope for M0 (deferred):** password-recovery UI (Supabase's email flow is enough for now) → M4 · health constraints/limitations + consent capture (health-adjacent data, needs privacy review) → M4 · data export/deletion → M5 · `trainer_assignments` and trainer/admin endpoints → M5 · role management UI (roles are seeded by a script in M0) · social login/MFA · deployment (ADR-0005) → M5 · `packages/ui` extraction · all 3D/vision work (M1/M2).

**ADRs:** accept **ADR-0003** after S0 (record JWKS vs HS256 and the RLS default-deny rule) · **ADR-0007** identity and roles (Supabase `sub` ↔ `users`, DB as role authority, just-in-time provisioning) · **ADR-0008** how the web gets API types (OpenAPI → `openapi-typescript` vs zod in `exercise-contracts`) · CI e2e auth strategy goes in ADR-0003 or 0007.

### M1 — 3D trainer (wk 3–4)

- [ ] Rigged avatar → GLB pipeline (Blender, Mixamo-style rig) documented in `assets/README.md`
- [ ] R3F viewer: play/pause/replay/reset, orbit, phase labels synced to clip time
- [ ] Squat clip + instructions from the catalogue; graceful missing-asset state
- **Exit:** user can open, play, pause, replay and understand the squat demo

### M2 — Live vision engine (wk 5–6)

- [ ] Benchmark PoseLandmarker in worker vs main thread (record in `docs/architecture/benchmarks.md`)
- [ ] Camera permission, preview, placement guidance, skeleton overlay, confidence display
- [ ] Record + annotate ≥10 squat clips → landmark JSON fixtures (no video in git)
- [ ] Vision regression runner: rep count precision/recall vs annotations
- **Exit:** tracked squat reps counted; unreliable tracking handled explicitly

### M3 — Integrated AI coaching (wk 7–8)

### M4 — Full member experience (wk 9–10)

### M5 — Gym operations + hardening (wk 11–12)

## Open decisions

- API host (Render vs Railway vs Fly) — decide at M5 (ADR-0005)
- LLM provider: Groq free tier proposed (ADR-0006) — confirm at M3 start via eval validity/repair rates
- Avatar source/licence (self-rigged vs licensed asset) — decide at M1 start

## Session log (newest first, 1 line each)

- 2026-10-27 — Scaffold + Claude Code setup created.
