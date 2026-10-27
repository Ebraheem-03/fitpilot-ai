---
name: new-exercise
description: Add a new supported exercise end to end — catalogue contract, ruleset + analyzer, tests, fixture folders, asset folder — following the exercise rule contract (blueprint §8).
argument-hint: "[exercise_id] e.g. dumbbell_biceps_curl"
disable-model-invocation: true
---

Add exercise **$ARGUMENTS** to FitPilot.

1. Read `data/exercise-catalog/bodyweight_squat.json`, `packages/exercise-rules/src/exercises/squat.ts` and its tests as the reference implementation, plus blueprint §8 "Exercise rule contract".
2. Create `data/exercise-catalog/$ARGUMENTS.json` satisfying `ExerciseContract` (file name must equal `id`). Choose camera view(s) and required landmarks deliberately; justify them in the PR.
3. Create `packages/exercise-rules/src/exercises/<name>.ts` with a `<NAME>_RULESET` (version 1, every threshold commented as uncalibrated) and an analyzer class with an explicit state machine (hysteresis + min rep duration). Export it from `src/index.ts`.
4. Document the rule contract in a header comment: required landmarks + view assumptions, features, confidence/validity conditions, observable condition per rule, permitted message, withhold conditions.
5. Tests in `packages/exercise-rules/test/<name>.test.ts`: exact rep counting, jitter does not double count, each cue is traceable (rule_id + measurements), unreliable tracking withholds everything.
6. Create `data/evaluation-fixtures/vision/$ARGUMENTS/` with a `.gitkeep` and `assets/exercises/<name>/` with a README noting the needed GLB.
7. Run `pnpm --filter @fitpilot/exercise-contracts test` and `pnpm --filter @fitpilot/exercise-rules test`; the API catalogue test must still pass (`cd services/api && uv run pytest`).
8. Update `docs/requirements/traceability.md` (FR-05/FR-06 rows).
