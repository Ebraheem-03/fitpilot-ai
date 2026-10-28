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

**Coverage and gaps:**

- The set includes portrait and landscape video; plain, home, gym, forest, beach and pier settings; backlit and dim light; loose and fitted clothing; an older adult; a person with a prosthetic leg; a second person in frame; slow tempo with holds; and bends that aren't squats.
- About 10 distinct people, mostly women.
- No "walks out of frame mid-set" clip, so that path is covered by the mannequin's hidden loop.
- No phone propped at hip height in an ordinary room.
- No held-out set yet: thresholds were calibrated on these clips, so check new recordings against them before trusting them as general.

## ai/

Versioned member profiles + requests + expected properties for the AI eval suite (blueprint §10). Synthetic people only — no real personal data.
