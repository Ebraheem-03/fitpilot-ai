# Progress

Current milestone: **M3 — Integrated AI coaching ✅ done 2026-11-03.** M4 next.
Next up: `/kickoff-milestone M4`. Your actions: enable **Zero Data Retention** in the Groq console (ADR-0006 §1), `make bench-phone` on a mid-range phone (ADR-0010), and record shallow and forward-lean squats so the cue thresholds can be calibrated (`data/evaluation-fixtures/README.md`).

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

### M2 — Live vision engine ✅ done 2026-10-28

**Exit:** "a member can perform a supported squat while the application tracks and counts repetitions, with explicit handling of unreliable tracking." **Proven by** `live-coaching.spec.ts` EXIT (real model in the worker, mannequin fake camera: 5/5 reps, count frozen while hidden, no outbound requests) + `live-coaching-states.spec.ts`. Worker + lite model + self-hosted runtime (ADR-0010); squat ruleset v3 calibrated on 25 Pexels clips (counting P 1.00 / R 1.00, refusal 12/14); live page with guidance, confidence and failure states; security + code reviews fixed (#34–#42). Open: phone benchmark (you).

### M3 — Integrated AI coaching ✅ done 2026-11-03

**Exit (verbatim, §11):** "the member can receive a plan, follow a demonstration, complete a tracked workout, and see a saved session summary." **Proven by** `apps/web/tests/e2e/workout-journey.spec.ts` EXIT (#66), green ×3 locally and in CI. Steps: fake-provider plan → squat 3D demo plays from the runner → consented tracked set on the mannequin feed (6/6 reps, count frozen while nobody is in view, no non-GET request while the camera runs, nothing off-origin) → manual sets + a skip → complete → reload → saved summary with the tracked set, `squat.depth.shallow` cues with measurements, the `no_person` span, manual sets and the skip → a second member sees none of it.

- [x] S0 Groq spike → **ADR-0006 accepted**: `gpt-oss-120b`, low effort, 100% valid after one repair (#46)
- [x] S1 contracts: catalogue widened (7 exercises; `animation` optional, `prescription`, `Equipment`), session events + batch + summary, `CUE_RULES` shared with Python (#45); `TrainingPlan` (#50)
- [x] S2 cue engine (`CueSelector`), squat v4 with `squat.torso.forward_lean`, cue gate (0 false cues on 53 judged reps) (#47, follow-ups #53)
- [x] S3 live cues + recorder + post-set summary; cue latency median 5–7 ms (#49)
- [x] S4 LLM layer (groq/fake/ollama, budget guards, telemetry) + plan API (validate → repair once → `needs_review`, versions, idempotency) (#50); no DB connection held during the LLM call (#54, #55)
- [x] S5 AI eval suite: 20 synthetic profiles, offline in CI, live `make eval-ai`, prompt-hash guard; low effort confirmed (#52)
- [x] S6 sessions API: ingest (idempotent, consent-gated, declared measurements only), server-side summary, `performance_records`, consent endpoints, delete (#48)
- [x] S7 **ADR-0011** + per-member IndexedDB outbox, nothing sent while the camera runs, consent UI, privacy copy (#44, #51)
- [x] S8 plan pages, workout runner, summary, history (#56)
- [x] S9 EXIT e2e (#66). Milestone code review + security audit: no Blockers; fixes in #67 (plan cap 5/day, sequence grants, fake provider refused outside dev, medical-wording check, server `progress`), #68 + #70 (shared-device sign-out with keep/discard, no cycle between live-coaching and workouts, runner seeded from server, no lost events on re-sign-in), #69 (env fails closed, default privileges revoked)

Evidence: hosted DB at `0007`. Live eval `docs/evaluation/plans-plan-v1.md` (35/35 valid after repair, 0 constraint violations, p50 4.5 s, ≈$0.001/plan list price, $0 billed).
Accepted limitations: cue thresholds (depth 120°, lean 60°) are **uncalibrated**. No real rep has a shallow or forward-lean judgement, so the gate proves the rules stay quiet, not that they fire. A failed camera attempt's genuinely shown cues and counted reps stay in the summary (ADR-0011). Budget guards are per process (one worker only). The medical-wording check can send a legitimate plan to `needs_review`.
Deferred from M3: controlled plan modification and adjustments → M4 (FR-02/FR-10) · trainer review of `needs_review` plans, human escalation path and **re-consent before trainers can read gym-tagged sessions** → M5 (FR-06, FR-11; bump `TRACKING_CONSENT_VERSION`) · pose-tracking failures as server-side diagnostic events → M5 (FR-13, needs a consent decision) · server-side pause state (pause is client-only) · Dependabot PRs #57–#65 (re-vendor + re-pin MediaPipe per ADR-0010 before taking `tasks-vision` 1.2.0; vitest 5 is a major).

### M4 — Full member experience (wk 9–10)

### M5 — Gym operations + hardening (wk 11–12)

## Open decisions

- API host (Render vs Railway vs Fly) — decide at M5 (ADR-0005)

## Session log (newest first, 1 line each)

- 2026-11-03 — M3 done (#43–#70): plans via Groq (ADR-0006 accepted), sessions + outbox + consent (ADR-0011), cue engine + live cues, runner + summary, eval suite, EXIT e2e; milestone reviews fixed; hosted DB at 0007.
- 2026-10-28 — M1 planned and done (#26–#32): generated avatar (ADR-0009), contract timeline, viewer + library, exit e2e; reviews fixed; racy M0 cross-member e2e fixed.
- 2026-10-28 — M0 merged (#15–#24), hosted migrations applied, spike test user removed.
- 2026-10-28 — M0 S2–S8: DB+RLS, JWKS auth, profiles API, logging, web auth, shell/onboarding/profile; reviews fixed.

- 2026-10-27 — Scaffold + Claude Code setup created.
