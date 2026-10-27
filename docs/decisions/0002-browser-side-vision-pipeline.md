# ADR-0002: Pose estimation and rule evaluation run in the browser, in a Web Worker

- **Status:** accepted
- **Date:** 2026-10-27
- **Requirements:** FR-04, FR-05, FR-06, NFR-Pose processing (15–30 fps), NFR-Feedback latency (≤250 ms median), NFR-Privacy

## Context

Real-time feedback needs sub-second latency; raw video must stay on device by default (principle 5).

## Decision

- MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`) runs in a dedicated Web Worker; main thread only renders.
- Stages 2–5 of the analysis pipeline (blueprint §8) are pure TypeScript in `packages/exercise-rules` with no DOM dependency, so they run in the worker and in Vitest identically.
- The server receives only derived session events (`packages/exercise-contracts/src/session-events.ts`), never frames.
- The vision engine sits behind an interface (`PoseSource`) so alternative estimators can be benchmarked.

## Consequences

- Rule logic is unit-testable and replayable from recorded landmark JSON fixtures.
- Performance depends on the member's device → must measure fps and degrade gracefully (lower model complexity, lower inference rate) and say so in the UI.
- First task in M2: benchmark worker vs main-thread on the M1 MacBook and a mid-range phone; record results in `docs/architecture/benchmarks.md`.
