# Evaluation fixtures

## vision/

Annotated landmark sequences for vision regression tests (FR-05, blueprint §14). **No video files in git** (`.gitignore` enforces it). The schemas are `LandmarkFixture`, `ClipLabels` and `VisionGate` in `packages/exercise-contracts/src/vision-fixtures.ts`.

```
vision/<exercise_id>/gate.json                   # acceptance gate for this exercise
vision/<exercise_id>/<clip_id>.landmarks.json    # per-frame landmarks exported from PoseLandmarker
vision/<exercise_id>/<clip_id>.labels.json       # human annotation
```

Run it with `pnpm --filter @fitpilot/exercise-rules test:vision` (also part of `test`, so `make verify` and CI run it). Each exercise folder needs a registered analyzer in `test/vision/regression.test.ts`. A malformed or unpaired file fails the run; nothing is skipped silently.

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

Record yourself, or people who agreed to have their movement data published. Use a phone or laptop camera at hip height, landscape, about 30 fps. Each clip is 6–10 reps with a few seconds of standing before and after. Keep the videos on your disk; only the JSON from `/dev/capture` is committed.

| #     | Camera | Facing in image | Distance | Light                   | Clothing | Notes                                                     |
| ----- | ------ | --------------- | -------- | ----------------------- | -------- | --------------------------------------------------------- |
| 1     | side   | left            | 2.5 m    | normal                  | fitted   | steady tempo                                              |
| 2     | side   | right           | 2.5 m    | normal                  | fitted   | steady tempo                                              |
| 3     | side   | left            | 3.5 m    | normal                  | loose    | fast tempo                                                |
| 4     | side   | right           | 1.8 m    | normal                  | loose    | slow tempo                                                |
| 5     | side   | left            | 2.5 m    | dim (one lamp)          | fitted   |                                                           |
| 6     | side   | right           | 2.5 m    | backlit (window behind) | fitted   |                                                           |
| 7     | side   | left            | 2.5 m    | normal                  | fitted   | about half the reps deliberately shallow                  |
| 8     | side   | right           | 2.5 m    | normal                  | fitted   | walk out of frame mid-set for ~3 s, then back             |
| 9     | ~45°   | left            | 2.5 m    | normal                  | fitted   | three-quarter view                                        |
| 10    | front  | camera          | 2.5 m    | normal                  | fitted   | `supported: false`: the analyzer must count nothing       |
| 11–12 | side   | either          | 2.5 m    | normal                  | any      | a second person if available (different body proportions) |

Then, for each clip: run `make dev`, open `/dev/capture`, pick the file, set the clip id (`squat_side_001`, …), and click **Extract landmarks**. Set the camera, facing, lighting, clothing and distance fields, and set "supported" to off for row 10. Scrub through the video and mark each rep's start, bottom and end, plus any untrackable span (row 8). Download both JSON files into `vision/bodyweight_squat/`. Repeat with the model set to "full" (suffix `_full`) so S4 can compare the two models.

## ai/

Versioned member profiles + requests + expected properties for the AI eval suite (blueprint §10). Synthetic people only — no real personal data.
