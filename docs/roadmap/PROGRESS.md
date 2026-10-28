# Progress

Current milestone: **M2 — Live vision engine** (planned 2026-10-28). M1 done 2026-10-28.
Next up: S9 reviews of S5–S7. **Blocked on you:** recording squat clips (S3), which S4 calibration needs, and a phone run of `/dev/pose-bench` (ADR-0010).

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
**Proven by (planned, per ADR-0010):** (1) `apps/web/tests/e2e/live-coaching.spec.ts` EXIT: the real model in the real worker, fed by Chrome's fake camera playing a generated video of the M1 mannequin squatting (no real person; known rep count). The displayed rep count must equal it; blank segments must show "tracking not reliable" and freeze the count; stop must release the camera. (2) Real model with Chrome's default fake camera (no person) → "no person detected", 0 reps. (3) Vision regression over ≥10 real annotated clips meets the provisional gate: rep precision ≥ 0.95, recall ≥ 0.90, 0 reps counted inside `untrackable_ranges_ms`.

Already in the repo: `packages/exercise-rules` v1 (`assessTracking`, `jointAngle`, `Ema`, `SquatAnalyzer`, left side only, thresholds uncalibrated; 8 synthetic tests) · `MEDIAPIPE_POSE_INDEX` + `SessionEvent` contracts (incl. `TrackingDegradedEvent`) · `@mediapipe/tasks-vision` dependency · Playwright fake-camera flags · fixture format in `data/evaluation-fixtures/README.md` (no fixtures yet) · ADR-0002 (worker, `PoseSource`). Not there yet: anything in `features/live-coaching`, a worker, CSP/`Permissions-Policy` headers.

- [x] **S0 spike → ADR-0010** — worker + classic WASM (Turbopack emits classic workers), self-hosted runtime + sha-pinned models (`scripts/vendor-mediapipe.mjs`), lite model, `auto` delegate (CPU on software GL: GPU there ran at ≤10 fps and starved the page), warm-up in init (cold first inference up to 7.6 s), `ImageBitmap` transport. M1 Pro: worker lite 55–59 fps, page stays at 120 rAF/s; main-thread inference drops it to 61–110. WebKit + prod build OK. Numbers in `benchmarks.md`. **Phone run pending (you)**.
- [x] **S1 fixture contract + vision regression runner** (#36) — `LandmarkFixture`/`ClipLabels`/`VisionGate` (TS-only), `evaluateClip`/`aggregate`, loader fails loudly (malformed, unpaired, stray files), gate per exercise folder runs in `pnpm test`; gate scores only the runtime model's fixtures and can't pass vacuously.
- [x] **S2 local capture + annotation tool** (#37) — `/dev/capture` (dev-only): local video or synthetic mannequin → runtime worker at a fixed timestep → `landmarks.json`; rep/untrackable annotation → `labels.json`; no uploads (tested). First fixtures: `mannequin_side_{lite,full}` (6 loops, 1 hidden). Lite + analyzer v1: 5/5 reps, 0 counted while hidden. **Full model: 0/5**, because its left-leg estimate collapses (5–40°) when the legs overlap side-on → S4 needs a plausibility check + side fallback.
- [ ] **S3 record + annotate ≥10 squat clips** (FR-05) · **you** record, vision-engineer annotates/QA · M · deps: S2. Matrix: side view facing left + right, 2 distances, normal + dim light, loose + fitted clothing, slow/fast tempo, a few shallow reps, plus negatives (walking out of frame mid-set, front view, partial body). Only landmark/label JSON lands in `data/evaluation-fixtures/vision/bodyweight_squat/`; videos stay on your disk. Accept: all fixtures validate; README lists the coverage matrix and consent note.
- [ ] **S4 squat analyzer v2, calibrated** (FR-05) · vision-engineer · L · deps: S1, S3. Side auto-selection (more visible side, not hard-coded left); wrong-view detection (front view ⇒ withhold, reason `unsupported_view`); implausible-jump rejection; mid-rep tracking loss abandons the rep after a gap; time-based smoothing (fps-independent); `TrackingDegradedEvent` reason derivation. Thresholds tuned against S3 → bump `SQUAT_RULESET.version` + catalogue `ruleset_version`, cite the fixture metrics in the ruleset comment. Accept: new synthetic tests TDD-first; v1 behaviour kept reproducible; regression gate (precision ≥ 0.95, recall ≥ 0.90) green in CI.
- [x] **S5 live engine** — `features/live-coaching/engine`: session machine (explicit start, permission, warm-up, pause/stop, named failures, one worker restart), `TrackingMonitor` (searching/tracking/unreliable + why: no person, out of frame, low visibility, low light, slow device; settle time; fps window, analysis withheld < 8 fps), `LiveEngine` with injected browser deps (`requestVideoFrameCallback`, `ImageBitmap`, luma sampling), `FixtureReplayPoseSource` for tests; stall watchdog (no analysed frame for 2 s ⇒ "camera picture has stopped updating"); one frame in flight end to end. Headers: `Permissions-Policy: camera=(self)`, narrow CSP (`worker-src`, `frame-ancestors 'none'`). **Privacy fix:** MediaPipe posts usage metrics to Google from the worker with no opt-out → the worker refuses cross-origin requests (ADR-0010 §9).
- [x] **S6 live squat page** — `/app/exercises/[id]/live` (linked from the squat page): on-device explainer before the permission prompt, mirrored preview + skeleton, guidance per tracking issue, confidence meter, rep counter that says "Reps paused — tracking not reliable", pause/resume/stop, error states with retry, non-camera path; camera off on leave. Component tests per state; axe + phone width + keyboard in e2e.
- [x] **S7 exit e2e + benchmarks** — EXIT green ×3 locally: real model in the worker, Chrome fake camera playing the generated mannequin feed (`fake-camera.setup.ts`), 5/5 reps, count frozen while hidden, 0 outbound requests, grab→published latency median 17 ms (end-to-end estimate ≈ 100 ms, ≤ 250). States spec: no person (real model, default fake camera), blocked camera, a11y/phone/keyboard.
- [ ] **S8 client diagnostics (deferred from M1)** (FR-13) · backend-engineer · S · deps: S5. Contract-first `ClientDiagnosticEvent` (viewer load failure, model load failure, fps bucket, tracking-degraded counts — no landmarks, no PII) → authenticated, rate-limited `POST /api/v1/diagnostics` → structured log. Accept: parity test; pytest for auth, cross-user not needed (write-only), PII rejected by schema. _Cut line: first to defer if M2 runs long._
- [x] **S9 reviews** — security/privacy (#38): approved, 4 Low fixed (cross-origin request check of any method, worker XHR/socket guard, dev bench guard, worker leak on stop mid-start). Code review (#38): changes requested → fixed (stall watchdog, airtight backpressure, bitmap close, double start, analyzer exceptions, focus management, stable engine effect, honest latency label).

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
