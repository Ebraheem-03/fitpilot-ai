# packages/exercise-rules — vision analysis stages 2–5 (blueprint §8)

- Pure TypeScript, **no DOM / browser APIs / React** — this runs in a Web Worker and in Vitest identically.
- Pipeline per frame: `assessTracking` (gate) → features (`jointAngle`, distances, velocities) → `Ema` smoothing → explicit state machine with hysteresis + min-duration → versioned rules → cues.
- Unreliable tracking: return `features: null`, `cues: []`, don't advance the state machine.
- Every cue: `rule_id`, `ruleset_version`, `message_id`, `measurements`. Cue text describes an observable movement, never a medical/safety diagnosis.
- Thresholds live in the exercise's `*_RULESET` const with a version; changing a threshold bumps the version and must cite the fixture evaluation that justified it.
- Tests: synthetic-frame unit tests for logic **plus** regression tests replaying `data/evaluation-fixtures/vision/<exercise>/` landmark files against their labels (rep precision/recall, cue false positives). Use the `/new-exercise` skill to add an exercise.
