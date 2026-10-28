# Progress

Current milestone: **M1 — 3D trainer** (planned 2026-10-28). M0 done 2026-10-28.
Next up: M1 S2 (generator + `assets:check`) and S3 (playback controller), in parallel.

> Claude: read this file at the start of a session (the SessionStart hook prints the top of it).
> Update it with `/handoff` at the end of a session. Keep it short — history lives in git.

## Milestones (blueprint §11)

### M0 — Foundation (wk 1–2) ✅ done 2026-10-28

- [x] Monorepo, pnpm + uv, lint, format, tests, CI workflow
- [x] Exercise contract (zod) + JSON Schema export + Python mirror with parity test
- [x] One seeded exercise (`bodyweight_squat`) served by `GET /api/v1/exercises`
- [x] ADRs 0001–0005 (0003, 0005 still _proposed_)
- [x] Seed of `exercise-rules`: angle, EMA, confidence gate, squat state machine (+ unit tests)

**Exit (verbatim, §11):** "the application runs reproducibly and a signed-in member can access their own profile."
Proven by: S7's e2e test (sign up → create profile → sign out → sign in → see own profile) green in CI, plus `make verify` green on a fresh clone.

Estimates: S ≤ ½ day · M 1–2 days · L 3+ days. Owner "main" = main session (no frontend subagent exists); tests by `test-engineer`.

- [x] **S0 spike: auth token handoff (riskiest unknown, time-box 1 day)** (#6) · FR-01 · `backend-engineer` + main · M · deps: none
  - Questions: does the new Supabase project sign with asymmetric keys (JWKS, ES256) or the legacy HS256 secret (`config.supabase_jwt_secret` assumes HS256)? How does Next 16 (`proxy.ts`, not `middleware.ts`) + `@supabase/ssr` keep the session cookie and pass the access token to FastAPI? Can pytest mint valid tokens offline with a local keypair? How does Playwright authenticate in CI (local Supabase CLI stack vs dedicated test project)?
  - **Result (2026-10-27):** done on `spike/s0-auth-handoff`: real sign-up → server component → API verified via JWKS; project signs with ES256. Findings in ADR-0003 (accepted); ADR-0007 drafted.
  - Done when: throwaway branch signs in on web, calls the API with a bearer token, and the API verifies it; findings recorded and ADR-0003 → _accepted_; ADR-0007 drafted.
  - Needs from you: create the Supabase project (and authorise the `supabase` MCP); Claude can't do the OAuth step here.
- [x] **S1 Reproducible baseline** (#7) · NFR-Portability, FR-13 · `test-engineer` · S · deps: none
  - Tests: `make verify` runs everything CI runs (it currently skips `mypy app`); CI `api` job gets a Postgres 17 service container; fresh-clone `make setup && make verify` is green; `.env.example` lists the Supabase vars.
  - Files: `Makefile`, `.github/workflows/ci.yml`, `.env.example`, `docs/runbooks/local-dev.md`
- [x] **S2 DB foundation + first migration** (#8) · FR-01, FR-11 (schema only) · `backend-engineer` · M · deps: S1
  - Tests: `alembic upgrade head` then `downgrade base` round-trip on real Postgres; `alembic check` reports no model/migration drift; **RLS is enabled on every `public` table** (Supabase's Data API exposes `public` to the anon key, so default-deny is required); pytest fixture with per-test transaction rollback.
  - Files: `services/api/app/models/{base,user,profile,gym}.py`, `app/core/db.py`, `alembic/`, `tests/conftest.py`
  - Tables: `users` (keyed by Supabase `sub`, `role`, status), `member_profiles` (goals, experience, availability, equipment, preferences), `gyms`, `gym_memberships`.
- [x] **S3 API authentication dependency** (#9) · FR-01, NFR-Security · `backend-engineer` · M · deps: S0, S2
  - Tests: missing, malformed, expired, wrong-issuer/audience and bad-signature tokens → 401; a valid token provisions a `users` row just in time, only once (idempotent); the role comes from the DB, never from client-editable token claims.
  - Files: `app/core/security.py`, `app/api/deps.py`, `app/repositories/users.py`, `tests/test_auth.py`
- [x] **S4 Profiles API** (#10) · FR-01 · `backend-engineer`, reviewed by `security-privacy-reviewer` · M · deps: S3
  - Tests: `POST /api/v1/profiles` creates the caller's profile (a repeat call is idempotent or returns 409, decided in the slice); `GET /api/v1/profiles/me` → 200 own / 404 none / 401 anonymous; **member B's token never returns A's profile**; a `user_id`/`role` in the body is ignored or rejected (no mass assignment); invalid enums/lengths → 422.
  - Files: `app/api/v1/profiles.py`, `app/services/profiles.py`, `app/repositories/profiles.py`, `app/schemas/profile.py`, `tests/test_profiles.py`
- [x] **S5 Observability baseline** (#11) · FR-13 · `backend-engineer` · S · deps: S3
  - Tests: JSON log lines carry `event`, `request_id`, `user_id` (UUID only), status and latency; a 401 produces an `auth.rejected` event; captured logs contain no token, email or profile fields.
  - Files: `app/core/logging.py`, request-id middleware in `app/main.py`, `tests/test_logging.py`
- [x] **S6 Web auth flows** (#12) · FR-01 · main + `test-engineer` · M · deps: S0
  - Tests: Playwright sign-up, sign-in and sign-out; an unauthenticated visit to `/app/*` redirects to `/sign-in`; a bad password shows an accessible error. This uses the CI auth strategy chosen in S0.
  - Files: `apps/web/src/proxy.ts`, `src/lib/supabase/{server,client}.ts`, `src/app/(auth)/{sign-in,sign-up}/`, `tests/e2e/auth.spec.ts`
- [x] **S7 App shell, design tokens, own-profile page (exit test)** (#13) · FR-01, NFR-Accessibility · main + `test-engineer` · L · deps: S4, S6
  - Tests: Vitest component tests show the nav differs for member, trainer and admin (adds `@testing-library/react` + jsdom); a skip link and keyboard-only navigation work; an axe check has no serious violations; **exit e2e: sign up → minimal onboarding form → sign out → sign in → `/app/profile` shows the saved profile**.
  - Files: `src/app/globals.css` (`@theme` tokens, light/dark), `src/app/(app)/layout.tsx`, `src/features/shell/`, `src/features/onboarding/`, `src/lib/api.ts`, `tests/e2e/profile.spec.ts`
- [x] **S8 Close-out** (#14) · all · `code-reviewer`, `security-privacy-reviewer` · S · deps: S1–S7
  - Independent review; update `traceability.md` (FR-01 → 🟨, with the cross-member test linked); confirm ADR-0003/0007/0008; `/handoff`.

**Out of scope for M0 (deferred):** password-recovery UI (Supabase's email flow is enough for now) → M4 · health constraints/limitations + consent capture (health-adjacent data, needs privacy review) → M4 · data export/deletion → M5 · `trainer_assignments` and trainer/admin endpoints → M5 · role management UI (roles are seeded by a script in M0) · social login/MFA · deployment (ADR-0005) → M5 · `packages/ui` extraction · all 3D/vision work (M1/M2).

**ADRs:** accept **ADR-0003** after S0 (record JWKS vs HS256 and the RLS default-deny rule) · **ADR-0007** identity and roles (Supabase `sub` ↔ `users`, DB as role authority, just-in-time provisioning) · **ADR-0008** how the web gets API types (OpenAPI → `openapi-typescript` vs zod in `exercise-contracts`) · CI e2e auth strategy goes in ADR-0003 or 0007.

### M1 — 3D trainer (wk 3–4)

**Exit (verbatim, §11):** "the user can open, play, pause, replay, and understand the squat demonstration."
FR-03 acceptance: "A member can open a squat exercise, see the avatar demonstrate it, replay the movement, and follow its instructions without the 3D viewer blocking the rest of the application."
Proven by: S7's exit e2e (sign in → exercise library → squat → play / pause / replay / reset, phase label follows clip time, instructions readable while the GLB is still loading) green in CI, plus `make verify` (incl. `assets:check`).

Already in the repo: `three` 0.186, `@react-three/fiber` 9, `drei` 10 installed but unused · `features/exercise-viewer/` empty · `assets/README.md` pipeline notes, no assets · `bodyweight_squat.json` has `animation_asset: "squat.glb"`, `phases` (names only, **no timings**), instructions and technique notes · `GET /api/v1/exercises[/{id}]` serves the catalogue · no exercise pages or nav entry on the web · no Blender or gltf tooling on this machine.

- [x] **S0 spike: avatar source, licence and headless render (riskiest unknown, time-box 1 day)** · FR-03 · `threed-engineer` + main · M · deps: none
  - Questions: which avatar can live in a **public** repo? Compare (a) a procedural mannequin generated by a script (CC0 by construction, reproducible, no Blender, but looks robotic), (b) a CC0 rigged character (Quaternius/Kenney-style) with a squat authored or retargeted in Blender, and (c) Mixamo character + "Air Squat" (best motion, but Adobe's terms forbid redistributing raw assets, which a public GLB arguably does). Is the squat good enough on the §15 checks (joint ranges plausible, no foot slide or floor clipping, clean loop seam)? Is it < 3 MB compressed? Does a GLB load in R3F inside Next 16 via `next/dynamic({ ssr: false })` and render a non-blank frame in headless Chromium (SwiftShader) in CI? How big is the lazy three/R3F chunk?
  - Done when: a throwaway branch shows one candidate squat GLB playing in a Next page, with a Playwright screenshot from CI; licence evidence recorded; **ADR-0009** (avatar source, licence, asset location) accepted.
  - **Result (2026-10-28):** (c) Mixamo is ruled out (no redistribution of raw files) and (b) lists no squat and needs Blender, so (a) won: a generated CC0 mannequin with an IK-authored squat (`packages/avatar` on `spike/m1-s0-avatar`). Renders in headless Chromium via `next/dynamic`; glTF-Validator 0 errors; ankle drift 0.009 cm; GLB 490 KiB (120 KiB gzip); lazy 3D chunk 260 KiB gzip. **ADR-0009 accepted.**
- [x] **S1 Animation timeline in the exercise contract** · FR-03 · main + `backend-engineer` (Python mirror) · S · deps: S0 (real durations; can be drafted earlier)
  - Tests: `ExerciseContract` gains `animation: { asset, clip, duration_s, phases: [{ phase, start_s, end_s, instruction_indices }] }` (replaces `animation_asset`; squat → version 2); the zod validator rejects gaps or overlaps, a timeline that doesn't cover `duration_s`, phase ids not in `phases`, and out-of-range instruction indices; `export:jsonschema` → `app/schemas/exercise.py` → parity test green; the catalogue loader in the API still serves `bodyweight_squat`.
  - Files: `packages/exercise-contracts/src/exercise.ts` (+ test), `data/exercise-catalog/{bodyweight_squat.json,_schema/*}` (generated), `services/api/app/schemas/exercise.py`, parity test.
- [x] **S2 Production squat GLB + asset check in CI** · FR-03, NFR-Portability · `threed-engineer` · M–L · deps: S0, S1
  - Tests: `pnpm assets:check` (part of `make verify` and CI) fails when a catalogue `animation.asset` file is missing, glTF-Validator reports errors, the file is ≥ 3 MB, the named clip is absent, the clip duration differs from `duration_s` by > 0.05 s, required bones are missing, or sampled foot bones go below the floor / drift > 2 cm horizontally while planted. Provenance + licence file sits next to the asset; if the GLB is generated, regenerating it gives the same hash.
  - Files: `packages/avatar/{src,test}` (generator from the spike + unit tests for IK, bone lengths and joint ranges, `assets:check` CLI), `apps/web/public/exercises/bodyweight_squat/squat.glb` (build output), `assets/exercises/bodyweight_squat/README.md` (provenance, CC0), `assets/README.md`, `ci.yml`.
- [x] **S3 Playback controller (pure TS, TDD)** · FR-03 · `threed-engineer` + `test-engineer` · S · deps: S1
  - Tests (Vitest, no WebGL): states `loading → ready → playing ⇄ paused → ended`; `replay` from any state restarts at 0 and plays; `reset` returns to 0 paused; `seek` clamps; `phaseAt(t)` matches the contract timeline at boundaries; the current instruction follows the phase; `prefers-reduced-motion` ⇒ no autoplay; keyboard map (Space play/pause, R replay, Home reset, ←/→ seek).
  - Files: `apps/web/src/features/exercise-viewer/playback.ts` (+ `.test.ts`).
- [ ] **S4 R3F viewer + accessible controls** · FR-03, NFR-Accessibility · `threed-engineer` · M · deps: S3 (spike GLB is enough to start; S2 for the final asset)
  - Tests: component tests with the Canvas/three layer stubbed show that the buttons and keys drive the controller, that the buttons have names and `aria-pressed`, that the phase label sits in a polite live region, and that the scrubber is a labelled slider. View presets (front / side / 45°) + bounded orbit; `frameloop="demand"` while paused or off-screen; viewer loaded via `next/dynamic({ ssr: false })` inside Suspense.
  - Files: `features/exercise-viewer/{ExerciseViewer.tsx,AvatarModel.tsx,ViewerControls.tsx,PhaseTimeline.tsx}` (+ tests).
- [ ] **S5 Graceful failure states** · FR-03 · `threed-engineer` + `test-engineer` · S–M · deps: S4
  - Tests: each case shows a fallback panel that keeps the instructions and phase list, plus a retry where it makes sense, and never shows a blank area or crashes the page: GLB 404, corrupt GLB, incompatible GLB (clip missing or duration mismatch with the contract), WebGL unavailable, slow load (skeleton + still-usable page). Component tests for each, plus one e2e using `page.route` to 404 the GLB.
  - Files: `features/exercise-viewer/{ViewerErrorBoundary.tsx,compat.ts,ViewerFallback.tsx}` (+ tests).
- [ ] **S6 Exercise library + squat detail page** · FR-03 (metadata + asset references) · main + `test-engineer` · M · deps: S1 (page), S4 (viewer slot)
  - Tests: `/app/exercises` lists the catalogue from the API (name, target muscles, equipment); `/app/exercises/[id]` shows metadata, instructions, technique considerations and phases, with the viewer in a slot that doesn't block render; an id not in the catalogue → `notFound()`; member nav gains "Exercises" (AppNav test updated); API types regenerated per ADR-0008.
  - Files: `src/app/app/exercises/{page.tsx,[id]/page.tsx}`, `src/features/exercise-library/`, `src/lib/{api.ts,api-types.ts}`, `src/features/shell/nav.ts`.
- [ ] **S7 Exit e2e, a11y and performance evidence** · FR-03, NFR-Accessibility, NFR-Responsiveness · `test-engineer` · M · deps: S5, S6
  - Tests: **exit e2e: sign in → Exercises → Squat → canvas renders → Play → phase label advances → Pause holds the time → Replay restarts from 0 → Reset**; with the GLB delayed via `page.route`, the instructions and nav stay usable (non-blocking); keyboard-only run; axe has no serious violations; mobile viewport project. Viewer chunk size, GLB size and time-to-first-frame recorded in `docs/architecture/benchmarks.md`.
  - Files: `apps/web/tests/e2e/exercise-viewer.spec.ts`, `docs/architecture/benchmarks.md`.
- [ ] **S8 Close-out** · all · `code-reviewer`, `security-privacy-reviewer` (asset licence, no third-party fetches at runtime) · S · deps: S1–S7
  - Independent review; `traceability.md` FR-03 → ✅ with tests linked; ADR-0009 confirmed; `/handoff`.

**Out of scope for M1 (deferred):** biceps-curl and push-up clips → M4 (MVP DoD needs all three, so the S2 pipeline must be repeatable) · syncing with a _selected workout_ (no workouts until M3; M1 syncs animation ↔ phases ↔ instructions only) → M3 · storing GLBs in Supabase Storage / CDN (served from `public/` in M1, per ADR-0009) → M5 if needed · user-controlled playback speed, mirrored/side-by-side camera comparison, multiple avatars, character editor (§FR-03 rules this out) · trainer-authored instructions · client telemetry for viewer errors (FR-13 web events) → M2 with the vision events · any camera/pose work → M2.

**ADRs:** **ADR-0009** avatar source, licence and asset location (`public/` vs Supabase Storage; Git LFS or not; generated vs authored) after S0. A separate ADR only if S0 shows the viewer needs a non-R3F renderer or a CDN. The contract change in S1 follows the contracts-first rule and needs no ADR.

### M2 — Live vision engine (wk 5–6)

- [ ] Benchmark PoseLandmarker in worker vs main thread (record in `docs/architecture/benchmarks.md`)
- [ ] Camera permission, preview, placement guidance, skeleton overlay, confidence display
- [ ] Record + annotate ≥10 squat clips → landmark JSON fixtures (no video in git)
- [ ] Vision regression runner: rep count precision/recall vs annotations
- **Exit:** tracked squat reps counted; unreliable tracking handled explicitly

### M3 — Integrated AI coaching (wk 7–8)

### M4 — Full member experience (wk 9–10)

### M5 — Gym operations + hardening (wk 11–12)

**M0 evidence (2026-10-28):** `make verify` green (66 API tests incl. Postgres integration, 21 web unit), `make e2e` 13/13 vs local Supabase (EXIT test: sign up → onboard → sign out → sign in → own profile; cross-member denial; axe). Independent code + security reviews done; all should-fix items addressed (#24). Merged to main via #15–#24 (main `8451ea4`, CI green incl. e2e). Hosted Supabase: migrations 0001–0002 applied via the IPv4 session pooler (RLS on all tables, 0 anon/authenticated grants).

## Open decisions

- API host (Render vs Railway vs Fly) — decide at M5 (ADR-0005)
- LLM provider: Groq free tier proposed (ADR-0006) — confirm at M3 start via eval validity/repair rates
- Avatar source/licence (self-rigged vs licensed asset) — decide at M1 start

## Session log (newest first, 1 line each)

- 2026-10-28 — M0 merged (#15–#24), hosted migrations applied, spike test user removed.
- 2026-10-28 — M0 S2–S8: DB+RLS, JWKS auth, profiles API, logging, web auth, shell/onboarding/profile; reviews fixed.

- 2026-10-27 — Scaffold + Claude Code setup created.
