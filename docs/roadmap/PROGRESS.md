# Progress

Current milestone: **M0 — Foundation** (scaffold done 2026-10-27)
Next up: finish M0 exit condition, then the M1+M2 risk spike (3D squat + live squat counting).

> Claude: read this file at the start of a session (the SessionStart hook prints the top of it).
> Update it with `/handoff` at the end of a session. Keep it short — history lives in git.

## Milestones (blueprint §11)

### M0 — Foundation (wk 1–2)

- [x] Monorepo, pnpm + uv, lint, format, tests, CI workflow
- [x] Exercise contract (zod) + JSON Schema export + Python mirror with parity test
- [x] One seeded exercise (`bodyweight_squat`) served by `GET /api/v1/exercises`
- [x] ADRs 0001–0005 (0003, 0005 still _proposed_)
- [x] Seed of `exercise-rules`: angle, EMA, confidence gate, squat state machine (+ unit tests)
- [ ] Confirm ADR-0003: create Supabase project, wire Supabase Auth in web + JWT verify in API
- [ ] Alembic + first migration: `users`, `member_profiles`, `gyms`, `gym_memberships`
- [ ] `POST /profiles`, `GET /profiles/me` + cross-member denial test
- [ ] App shell (nav, role-aware layout) + design tokens
- **Exit:** app runs reproducibly; signed-in member can access own profile

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
- Avatar source/licence (self-rigged vs licensed asset) — decide at M1 start

## Session log (newest first, 1 line each)

- 2026-10-27 — Scaffold + Claude Code setup created.
