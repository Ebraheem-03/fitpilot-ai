# Progress

Current milestone: **M2 — Live vision engine** (planned 2026-10-28). M1 done 2026-10-28.
Next up: M2 S0 spike — PoseLandmarker in a Web Worker under Next 16: fps/latency on the MacBook + a mid-range phone → ADR-0010. Then S1 (regression runner) and S2 (capture tool) in parallel, so you can record clips (S3) early.

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

**Exit (verbatim, §11):** "a member can perform a supported squat while the application tracks and counts repetitions, with explicit handling of unreliable tracking."
**Proven by (planned):** (1) `apps/web/tests/e2e/live-coaching.spec.ts` EXIT: fixture-replay `PoseSource` drives the real UI + worker pipeline → displayed rep count equals the clip's labels; tracking loss shows "tracking not reliable" and freezes the count; stop releases the camera. (2) Real MediaPipe in the worker with Chrome's fake camera (no person in frame) → "no person detected", 0 reps. (3) Vision regression over ≥10 real annotated clips meets the provisional gate: rep precision ≥ 0.95, recall ≥ 0.90, 0 reps counted inside `untrackable_ranges_ms`.

Already in the repo: `packages/exercise-rules` v1 (`assessTracking`, `jointAngle`, `Ema`, `SquatAnalyzer`, left side only, thresholds uncalibrated; 8 synthetic tests) · `MEDIAPIPE_POSE_INDEX` + `SessionEvent` contracts (incl. `TrackingDegradedEvent`) · `@mediapipe/tasks-vision` dependency · Playwright fake-camera flags · fixture format in `data/evaluation-fixtures/README.md` (no fixtures yet) · ADR-0002 (worker, `PoseSource`). Not there yet: anything in `features/live-coaching`, a worker, CSP/`Permissions-Policy` headers.

- [ ] **S0 spike → ADR-0010** (FR-04, NFR pose processing) · vision-engineer · M · deps: none. Throwaway page: module worker loads self-hosted WASM + `pose_landmarker_{lite,full}` under Next 16/Turbopack; measure fps, p50/p95 inference ms and main-thread long tasks for worker vs main thread, CPU vs GPU delegate, `ImageBitmap` transfer vs `VideoFrame`. Devices: M1 MacBook (Chrome + Safari) and a mid-range phone (**you open a URL on your phone**). Decide model variant, delegate, asset hosting, frame transport, degradation policy, test-time `PoseSource` injection. Accept: numbers in `benchmarks.md`, ADR-0010 accepted; if worker can't hit ~15 fps on the phone, re-plan before S5.
- [ ] **S1 fixture contract + vision regression runner** (FR-05) · vision-engineer (+ test-engineer) · M · deps: none. Zod schemas for `*.landmarks.json` / `*.labels.json`; runner replays each clip through the analyzer and reports rep precision/recall (rep matched if counted within its `start_ms…end_ms` + tolerance), reps inside untrackable ranges, frames withheld. Accept: runner unit tests on synthetic clips (perfect, double-count, missed rep, tracking gap) with known metrics; `pnpm --filter @fitpilot/exercise-rules test:vision` runs in `make verify`; malformed fixture fails loudly.
- [ ] **S2 local capture + annotation tool** (FR-05, principle 5) · vision-engineer · M · deps: S0. Dev-only page (404 in production builds): pick a local video file → same worker in VIDEO mode at a fixed timestep → download `landmarks.json`; scrub + mark rep start/bottom/end and untrackable ranges → `labels.json`. Never uploads, never writes video. Accept: component test (no network calls, export validates against S1 schemas); prod-build test that the route 404s.
- [ ] **S3 record + annotate ≥10 squat clips** (FR-05) · **you** record, vision-engineer annotates/QA · M · deps: S2. Matrix: side view facing left + right, 2 distances, normal + dim light, loose + fitted clothing, slow/fast tempo, a few shallow reps, plus negatives (walking out of frame mid-set, front view, partial body). Only landmark/label JSON lands in `data/evaluation-fixtures/vision/bodyweight_squat/`; videos stay on your disk. Accept: all fixtures validate; README lists the coverage matrix and consent note.
- [ ] **S4 squat analyzer v2, calibrated** (FR-05) · vision-engineer · L · deps: S1, S3. Side auto-selection (more visible side, not hard-coded left); wrong-view detection (front view ⇒ withhold, reason `unsupported_view`); implausible-jump rejection; mid-rep tracking loss abandons the rep after a gap; time-based smoothing (fps-independent); `TrackingDegradedEvent` reason derivation. Thresholds tuned against S3 → bump `SQUAT_RULESET.version` + catalogue `ruleset_version`, cite the fixture metrics in the ruleset comment. Accept: new synthetic tests TDD-first; v1 behaviour kept reproducible; regression gate (precision ≥ 0.95, recall ≥ 0.90) green in CI.
- [ ] **S5 live engine: worker, `PoseSource`, session state machine** (FR-04) · vision-engineer · L · deps: S0 (S4 can land later; uses v1 until then). `features/live-coaching/{worker,engine}`: typed worker protocol; `MediaPipePoseSource` + `FixtureReplayPoseSource`; camera/session state machine (idle → explaining → requesting → denied · unsupported · no-camera · model-failed → previewing → tracking ⇄ unreliable → paused → stopped); frame pump with backpressure (drop while busy); tracking status (no person, out of frame, low visibility, low light via sampled luma, low fps); `Permissions-Policy: camera=(self)` + CSP for worker/WASM. Accept: unit tests for every transition incl. denial, track ended, worker crash/restart, model load failure; stop/unmount ends all tracks; no frame or landmark data posted to the network.
- [ ] **S6 live squat page UI** (FR-04, NFR a11y) · vision-engineer (+ test-engineer) · M · deps: S5. Route `/app/exercises/[id]/live` (+ entry from the squat page): explainer before the permission prompt (what's processed, nothing leaves the device), placement guidance (side-on, full body, distance checks), mirrored preview + skeleton overlay, confidence meter, phase + rep counter with `aria-live`, explicit "tracking not reliable — reps paused" state, pause/resume/stop, no-camera alternative (link to the 3D demo). Accept: component tests per state; axe clean; keyboard-only; phone width.
- [ ] **S7 exit e2e + benchmarks** (FR-04, FR-05) · test-engineer · M · deps: S4, S6. EXIT spec (1) + (2) above; denial path via un-granted permission; latency from landmarks → displayed count (target ≤ 250 ms median) and fps recorded in `benchmarks.md`. Accept: green in CI on main.
- [ ] **S8 client diagnostics (deferred from M1)** (FR-13) · backend-engineer · S · deps: S5. Contract-first `ClientDiagnosticEvent` (viewer load failure, model load failure, fps bucket, tracking-degraded counts — no landmarks, no PII) → authenticated, rate-limited `POST /api/v1/diagnostics` → structured log. Accept: parity test; pytest for auth, cross-user not needed (write-only), PII rejected by schema. _Cut line: first to defer if M2 runs long._
- [ ] **S9 independent code review + security/privacy review** (camera handling, CSP, dev-tool gating, fixture content) · code-reviewer, security-privacy-reviewer · S · deps: S7.

Out of scope for M2: real-time cue display, cue selection/cooldown, post-set summary (FR-06 → M3) · session persistence + `SessionEvent` ingestion API (FR-07 → M3) · curl + push-up analyzers (FR-05 → M4) · front-view squat analysis · audio cues · syncing the 3D demo with the live session.
ADRs: **ADR-0010** (pose runtime: model variant, delegate, asset hosting, frame transport, degradation, test injection) from S0. Amend ADR-0002 only if S0 rejects the worker.

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
