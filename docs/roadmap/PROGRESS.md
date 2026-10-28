# Progress

Current milestone: **M2 — Live vision engine** (not yet planned). M1 done 2026-10-28.
Next up: `/kickoff-milestone M2` — riskiest unknown: PoseLandmarker fps in a Web Worker on target devices; then the camera permission flow and recording ≥10 annotated squat clips (needs you to record).

> Claude: read this file at the start of a session (the SessionStart hook prints the top of it).
> Update it with `/handoff` at the end of a session. Keep it short — history lives in git.

## Milestones (blueprint §11)

### M0 — Foundation ✅ done 2026-10-28

Monorepo + CI, exercise contract with parity, DB + RLS, JWKS auth, profiles API, logging, web auth, shell/onboarding/profile. Evidence: EXIT e2e (sign up → onboard → sign out → sign in → own profile), cross-member denial, axe; independent code + security reviews; merged #15–#24. ADRs 0003, 0007, 0008 accepted.

### M1 — 3D trainer ✅ done 2026-10-28

**Exit (verbatim, §11):** "the user can open, play, pause, replay, and understand the squat demonstration." **Proven by** `apps/web/tests/e2e/exercise-viewer.spec.ts` EXIT (real WebGL: open → reset → play, phase advances → pause, time holds → end → replay; rendered frame changes with clip time), green in CI on main.

- [x] S0 spike → **ADR-0009**: generated CC0 mannequin + IK-authored clips (Mixamo can't ship in a public repo; Quaternius has no squat). (#27)
- [x] S1 `animation` timeline in the exercise contract, zod + pydantic validators, squat v2 (#28)
- [x] S2 `packages/avatar` generator + joint-range tests + asset gate (validator, size, bones, clip/duration, foot slide, floor, byte-stable) (#29)
- [x] S3 playback state machine (#30) · S4+S5 viewer, accessible controls, classified fallbacks with retry/watchdog (#31)
- [x] S6+S7 exercise library + squat page, exit e2e, a11y, phone width, benchmarks (`docs/architecture/benchmarks.md`) (#32)
- [x] S8 independent code review (changes requested → fixed) + security review (proxy scope narrowed) (#32)

Evidence: `make verify` green (web 94, avatar 83, contracts 11, rules 8, API 79); `make e2e` 23/23. Page entry JS 13 KiB gz without three.js; lazy 3D 257 KiB gz; GLB 490 KiB (120 KiB gz).
Deferred from M1: curl + push-up clips → M4 (add a `MotionDefinition` per `assets/README.md`) · syncing with a selected workout → M3 · viewer error telemetry → M2 with vision events · GLB `Content-Encoding` on Vercel → M5.

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

## Session log (newest first, 1 line each)

- 2026-10-28 — M1 planned and done (#26–#32): generated avatar (ADR-0009), contract timeline, viewer + library, exit e2e; reviews fixed; racy M0 cross-member e2e fixed.
- 2026-10-28 — M0 merged (#15–#24), hosted migrations applied, spike test user removed.
- 2026-10-28 — M0 S2–S8: DB+RLS, JWKS auth, profiles API, logging, web auth, shell/onboarding/profile; reviews fixed.

- 2026-10-27 — Scaffold + Claude Code setup created.
