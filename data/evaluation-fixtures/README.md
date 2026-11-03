# Evaluation fixtures

## vision/

Annotated landmark sequences for vision regression tests (FR-05, blueprint §14). **No video files in git** (`.gitignore` enforces it). The schemas are `LandmarkFixture`, `ClipLabels` and `VisionGate` in `packages/exercise-contracts/src/vision-fixtures.ts`.

```
vision/<exercise_id>/gate.json                   # acceptance gate for this exercise
vision/<exercise_id>/<clip_id>.landmarks.json    # per-frame landmarks exported from PoseLandmarker
vision/<exercise_id>/<clip_id>.labels.json       # human annotation
```

`gate.json` judges two jobs separately on the runtime model's fixtures. **Counting** is precision and recall on `supported` clips. **Refusal** is the share of `supported: false` clips on which nothing at all is counted. It also requires `min_recorded_clips` real recordings. Run it with `pnpm --filter @fitpilot/exercise-rules test:vision` (also part of `test`, so `make verify` and CI run it). Each exercise folder needs a registered analyzer in `test/vision/regression.test.ts`. A malformed or unpaired file fails the run; nothing is skipped silently.

`landmarks.json`: produced by the capture tool (`/dev/capture`, M2 S2), never typed by hand. `p` packs `landmark_names.length × [x, y, z, visibility]`; `null` means no person was detected in that frame.

```json
{
  "format_version": 1,
  "clip_id": "squat_side_001",
  "exercise_id": "bodyweight_squat",
  "source": {
    "kind": "recording",
    "model": "pose_landmarker_lite",
    "tasks_vision_version": "1.1.1",
    "width": 640,
    "height": 480,
    "fps": 30
  },
  "landmark_names": ["nose", "left_shoulder", "…"],
  "frames": [
    { "t_ms": 0, "p": [0.51, 0.22, -0.1, 0.99, "…"] },
    { "t_ms": 33, "p": null }
  ]
}
```

`labels.json`:

```json
{
  "format_version": 1,
  "clip_id": "squat_side_001",
  "exercise_id": "bodyweight_squat",
  "camera_view": "side",
  "facing": "left",
  "supported": true,
  "conditions": { "lighting": "normal", "clothing": "fitted", "distance_m": 2.5 },
  "reps": [{ "start_ms": 1200, "bottom_ms": 1900, "end_ms": 2700, "full_depth": true }],
  "untrackable_ranges_ms": [[5000, 6200]],
  "annotated_by": "owner"
}
```

- `supported: false` marks a setup the exercise doesn't support (for example, a front-view squat). The analyzer must withhold there, so every counted rep is a false positive and missed labels don't count.
- A rep counted inside `untrackable_ranges_ms` (person out of frame or occluded) fails the gate.
- Matching: a counted rep is a true positive if it completes within `[start_ms − tol, end_ms + tol]` of an unmatched label (`gate.match_tolerance_ms`).
- `annotated_by` holds initials or a role, never a full name.

#### Cue annotations (`cue_labels`, M3 S2)

Optional, and only on `supported` clips. Per feedback rule, the indices of the reps on which a person expects the cue and the reps on which the cue would be wrong. Reps in neither list are unjudged for that rule.

```json
"cue_labels": {
  "rules": [
    {
      "rule_id": "squat.depth.shallow",
      "method": "from_rep_labels",
      "expected_reps": [1],
      "not_expected_reps": [0, 2],
      "notes": "…"
    }
  ]
}
```

- `method` says where the judgement came from. `by_eye` means a person watched the video or frame sheets. `from_rep_labels` means it was derived mechanically from a by-eye rep label (for example `full_depth`). `synthetic_ground_truth` means the generated mannequin, whose motion is known by construction.
- A cue is attributed to the labelled rep whose tolerance window contains it and whose end is nearest. A cue of an annotated rule outside every labelled rep, or a second one on the same rep, is a stray and always counts as wrong.
- The cue gate (`gate.cues`) scores the analyzer's raw cues, before cooldown could hide any. The false-positive rate is false cues ÷ (`not_expected` reps + stray cues). It must stay at or below `max_false_positive_rate`, over at least `min_judged_negatives` judged reps, and every declared rule must be judged on at least one rep. Two checks always apply, with or without annotations: **no cue inside `untrackable_ranges_ms`, and no cue on an unsupported clip**. A meta-test confirms that a ruleset which cues every rep fails the gate.

Coverage goal per exercise: varied camera distance and angle, lighting, clothing and body proportions. Record only people who consented. Only the derived JSON is committed. Landmarks carry no image, but they are still body data, so record yourself or people who agreed to have their movement published.

### Recording protocol (bodyweight squat, M2 S3)

Pexels stock footage (below) is now the main source. Use this protocol to add your own recordings, especially a phone propped at hip height in an ordinary room, which stock footage doesn't cover.

Record yourself, or people who agreed to have their movement data published. Use a phone or laptop camera at hip height, landscape, about 30 fps. Each clip is 6–10 reps with a few seconds of standing before and after. Keep the videos on your disk; only the JSON from `/dev/capture` is committed.

| #     | Camera | Facing in image | Distance | Light                   | Clothing | Notes                                                                                                                       |
| ----- | ------ | --------------- | -------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1     | side   | left            | 2.5 m    | normal                  | fitted   | steady tempo                                                                                                                |
| 2     | side   | right           | 2.5 m    | normal                  | fitted   | steady tempo                                                                                                                |
| 3     | side   | left            | 3.5 m    | normal                  | loose    | fast tempo                                                                                                                  |
| 4     | side   | right           | 1.8 m    | normal                  | loose    | slow tempo                                                                                                                  |
| 5     | side   | left            | 2.5 m    | dim (one lamp)          | fitted   |                                                                                                                             |
| 6     | side   | right           | 2.5 m    | backlit (window behind) | fitted   |                                                                                                                             |
| 7     | side   | left            | 2.5 m    | normal                  | fitted   | about half the reps deliberately shallow                                                                                    |
| 8     | side   | right           | 2.5 m    | normal                  | fitted   | walk out of frame mid-set for ~3 s, then back                                                                               |
| 9     | ~45°   | left            | 2.5 m    | normal                  | fitted   | three-quarter view; label `supported: false` (the catalogue supports side only). S4 calibration decides whether to widen it |
| 10    | front  | camera          | 2.5 m    | normal                  | fitted   | `supported: false`: the analyzer must count nothing                                                                         |
| 11–12 | side   | either          | 2.5 m    | normal                  | any      | a second person if available (different body proportions)                                                                   |

Then, for each clip: run `make dev`, open `/dev/capture`, pick the file, set the clip id (`squat_side_001`, …), and click **Extract landmarks**. Set the camera, facing, lighting, clothing and distance fields, and set "supported" to off for row 10. Scrub through the video and mark each rep's start, bottom and end, plus any untrackable span (row 8). Download both JSON files into `vision/bodyweight_squat/`. Repeat with the model set to "full" (suffix `_full`) so S4 can compare the two models.

The cue rules most need positive examples: row 7 (shallow reps), and a side-view set with about half the reps leaning the chest well forward. `/dev/capture` doesn't write `cue_labels` yet. While watching the video, add them to `labels.json` by hand with `"method": "by_eye"`, and copy them into the `_full` labels.

### Pexels clips (M2 S3)

The recorded fixtures come from 25 stock videos on [Pexels](https://www.pexels.com/license/). The Pexels licence allows free use and modification without attribution, and forbids redistributing the videos themselves. **Only derived landmark numbers and labels are committed. The videos are not in the repo.** Credit is given here anyway. Each clip was downloaded at the smallest size with a short side of at least 360 px, run through `/dev/capture` with both models (`pexels_<id>` = lite, `pexels_<id>_full` = full), then deleted.

| Fixture           | Pexels video                                                                                            | Creator            | View                        | Labelled reps |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------- | ------------- |
| `pexels_2785531`  | [2785531](https://www.pexels.com/video/woman-in-pink-and-gray-sports-gear-exercising-outdoors-2785531/) | cottonbro studio   | side                        | 3             |
| `pexels_4065452`  | [4065452](https://www.pexels.com/video/a-man-doing-stretching-near-the-lake-4065452/)                   | Pavel Danilyuk     | side                        | 5             |
| `pexels_4065502`  | [4065502](https://www.pexels.com/video/sunrise-training-young-man-early-morning-4065502/)               | Pavel Danilyuk     | side                        | 5             |
| `pexels_4367447`  | [4367447](https://www.pexels.com/video/man-working-out-at-the-gym-4367447/)                             | Pavel Danilyuk     | three_quarter (unsupported) | 0             |
| `pexels_4764175`  | [4764175](https://www.pexels.com/video/video-of-woman-doing-squats-4764175/)                            | Gustavo Fring      | front (unsupported)         | 0             |
| `pexels_4838146`  | [4838146](https://www.pexels.com/video/trainer-explaining-an-exercise-to-a-woman-4838146/)              | Anna Shvets        | side                        | 0             |
| `pexels_4838220`  | [4838220](https://www.pexels.com/video/woman-doing-squats-4838220/)                                     | Anna Shvets        | three_quarter (unsupported) | 0             |
| `pexels_4921641`  | [4921641](https://www.pexels.com/video/a-man-working-out-in-the-gym-4921641/)                           | Antoni Shkraba     | side                        | 3             |
| `pexels_5025965`  | [5025965](https://www.pexels.com/video/woman-doing-a-squat-exercise-5025965/)                           | olia danilevich    | side                        | 8             |
| `pexels_5034334`  | [5034334](https://www.pexels.com/video/woman-working-out-on-the-outdoors-5034334/)                      | Ketut Subiyanto    | side                        | 3             |
| `pexels_5034577`  | [5034577](https://www.pexels.com/video/woman-doing-squat-exercise-5034577/)                             | Ketut Subiyanto    | front (unsupported)         | 0             |
| `pexels_6022680`  | [6022680](https://www.pexels.com/video/man-with-prosthetic-leg-doing-squats-6022680/)                   | Kampus Production  | front (unsupported)         | 0             |
| `pexels_6326764`  | [6326764](https://www.pexels.com/video/man-doing-squats-6326764/)                                       | Pavel Danilyuk     | front (unsupported)         | 0             |
| `pexels_6874797`  | [6874797](https://www.pexels.com/video/elderly-woman-doing-squats-outdoor-6874797/)                     | Pavel Danilyuk     | three_quarter (unsupported) | 0             |
| `pexels_7117089`  | [7117089](https://www.pexels.com/video/daytime-workout-of-a-woman-7117089/)                             | KATRIN BOLOVTSOVA  | side                        | 3             |
| `pexels_7426039`  | [7426039](https://www.pexels.com/video/man-doing-exercise-7426039/)                                     | Kindel Media       | side                        | 4             |
| `pexels_7691062`  | [7691062](https://www.pexels.com/video/a-woman-doing-squat-exercises-7691062/)                          | cottonbro studio   | front (unsupported)         | 0             |
| `pexels_7786192`  | [7786192](https://www.pexels.com/video/person-doing-workout-7786192/)                                   | Soldevier          | three_quarter (unsupported) | 0             |
| `pexels_8027704`  | [8027704](https://www.pexels.com/video/man-working-out-at-home-8027704/)                                | MART PRODUCTION    | side (unsupported)          | 0             |
| `pexels_8402111`  | [8402111](https://www.pexels.com/video/a-woman-doing-squats-8402111/)                                   | RDNE Stock project | three_quarter (unsupported) | 0             |
| `pexels_8837118`  | [8837118](https://www.pexels.com/video/a-woman-doing-squats-8837118/)                                   | MART PRODUCTION    | side                        | 4             |
| `pexels_8837221`  | [8837221](https://www.pexels.com/video/a-woman-in-activewear-doing-squats-at-home-8837221/)             | MART PRODUCTION    | side                        | 5             |
| `pexels_9001924`  | [9001924](https://www.pexels.com/video/a-woman-doing-squats-9001924/)                                   | olia danilevich    | side (unsupported)          | 0             |
| `pexels_9058264`  | [9058264](https://www.pexels.com/video/an-elderly-man-doing-exercise-9058264/)                          | SHVETS production  | front (unsupported)         | 0             |
| `pexels_39171909` | [39171909](https://www.pexels.com/video/man-performing-squats-in-gym-with-weight-machine-39171909/)     | Bennit Antony      | three_quarter (unsupported) | 0             |

**How the labels were made.** Rep times were read by eye from 0.2 s frame sheets (larger frames where the thumbnails were too small to judge). They were never taken from landmark traces or analyzer output, so the gate isn't checking the analyzer against itself. The rules:

- A rep is labelled when its **bottom and its return to standing are both visible**, even if the descent began before the clip.
- A hold that never stands back up is not a rep.
- `end_ms` is the moment the person is upright again.
- Front-on, three-quarter (≈45°), and head- or feet-cut-off clips are `supported: false`. The catalogue supports a whole-body side view only, so any rep counted on them is a false count.

**How the cue labels were made (M3 S2).** The source videos had been deleted, so no new by-eye judgement was possible, and none of these labels came from landmark traces or analyzer output:

- `squat.depth.shallow` on the Pexels clips is `from_rep_labels`. It is derived from the by-eye `full_depth` field above, so a full-depth rep is `not_expected`. All 48 labelled reps are full depth, so the set has **no positive (shallow) example**.
- `squat.torso.forward_lean` on the Pexels clips is **not judged on any rep**. The entry exists with empty lists, so only stray cues (outside every labelled rep) are scored.
- On the mannequin side clips, both rules are `synthetic_ground_truth`, and every rep is `not_expected`. Each rep reaches the authored full depth, and the authored trunk hinge is pelvis 18° + spine 10° + chest 8° (`packages/avatar/src/clips/squat.ts`). The lean measures about 29°.
- Still missing: shallow reps and reps with a strong forward lean judged by eye. Until those exist, the gate can show that the rules stay quiet when they should, but it can't show that they fire when they should.

**Coverage and gaps:**

- The set includes portrait and landscape video; plain, home, gym, forest, beach and pier settings; backlit and dim light; loose and fitted clothing; an older adult; a person with a prosthetic leg; a second person in frame; slow tempo with holds; and bends that aren't squats.
- About 10 distinct people, mostly women.
- No "walks out of frame mid-set" clip, so that path is covered by the mannequin's hidden loop.
- No phone propped at hip height in an ordinary room.
- No held-out set yet: thresholds were calibrated on these clips, so check new recordings against them before trusting them as general.

## ai/

Versioned member profiles + requests + expected properties for the AI eval suite (blueprint §10). Synthetic people only — no real personal data.

### ai/plans/ (plan generation, FR-02, M3 S5)

```
ai/plans/suite.json            # suite_version, gate, profiles with expected properties
ai/plans/offline-replies.json  # scripted fake-provider replies for the offline run
```

A profile holds exactly the five fields the plan generator may see (`PlanInputs`), plus what a good result must look like. **Expected properties, never exact plans**: the model may pick any valid plan.

```json
{
  "id": "p02_strength_intermediate_dumbbells",
  "description": "Dumbbells should show up in the plan.",
  "inputs": {
    "primary_goal": "strength",
    "experience_level": "intermediate",
    "days_per_week": 4,
    "session_minutes": 45,
    "equipment": ["dumbbells"]
  },
  "expect": { "outcome": "active", "min_fill": 0.5, "uses_equipment": ["dumbbells"] }
}
```

- `inputs` use the profile enums (`Goal`, `ExperienceLevel`, `Equipment`), days 1–7, minutes up to 180. Any other field fails the loader, so a name or a health note can't slip in.
- `expect.outcome`:
  - `active`: feasible. The plan must be accepted (first try or after the one repair); escalating it counts as a false escalation.
  - `needs_review`: infeasible. The generator must escalate. `p20` asks for 5-minute sessions, which the 5-minute warm-up already fills. That's below the API's 10-minute floor on purpose, to prove infeasible input is never silently accepted. The loader allows minutes under 10 only for `needs_review` profiles.
  - `either`: both are acceptable (7 days × 10 min). Reported, not scored for escalation.
- `expect.min_fill` (optional): the shortest day's estimated minutes ÷ `session_minutes` should reach this. `expect.uses_equipment` (optional): owned equipment the plan should use at least once. Both are **reported, not gated**: the prompt asks for 60–100% fill but doesn't require any equipment.
- Hard constraints (catalogue, equipment, days, session length, prescription) apply to every profile and aren't listed. The scorer re-checks every accepted plan independently of `plans/validation.py`.
- `gate` is the pass bar for a run (`services/api/app/services/evaluation/plan_suite.py::gate_failures`). It can't pass vacuously: it needs `min_scored_plans` scored plans and at least one escalation-expected plan.
- The loader fails on duplicate ids, two profiles with identical inputs, `uses_equipment` the profile doesn't own, or a suite without an escalation-expected profile.
- Changing a profile, the expectations or the gate means bumping `suite_version`.

`offline-replies.json` maps a profile id to the replies for one `generate_plan` call, in order. Once they run out, the rule-based fake planner answers. Kinds: `planner` (optionally with `mutate`: `drop_day`, `unknown_exercise`, `add_dumbbells`, `overlong`), `json_validate_failed`, `rate_limited` (`retry_after_s`), `busy`, `unavailable`. The scripted outcomes are known (invalid → repaired, invalid → escalated, a recovered 429), so `tests/test_eval_plans.py` asserts the exact metrics and the scorer itself is tested.

Runs: offline in `make verify` (pytest). Live with `make eval-ai` (Groq, never in CI), which writes `docs/evaluation/plans-<prompt_version>.{md,json}`.
