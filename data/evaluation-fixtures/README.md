# Evaluation fixtures

## vision/

Annotated landmark sequences for vision regression tests (FR-05, blueprint §14). **No video files in git** (`.gitignore` enforces it).

```
vision/<exercise_id>/<clip_id>.landmarks.json   # per-frame landmarks exported from PoseLandmarker
vision/<exercise_id>/<clip_id>.labels.json      # human annotation
```

`labels.json`:

```json
{
  "clip_id": "squat_side_001",
  "camera_view": "side",
  "conditions": { "lighting": "normal", "clothing": "fitted", "distance_m": 2.5 },
  "reps": [{ "start_ms": 1200, "bottom_ms": 1900, "end_ms": 2700, "full_depth": true }],
  "untrackable_ranges_ms": []
}
```

Coverage goal per exercise: varied camera distance/angle, lighting, clothing and body proportions. Recordings only of people who consented; strip faces/identity from anything shared.

## ai/

Versioned member profiles + requests + expected properties for the AI eval suite (blueprint §10). Synthetic people only — no real personal data.
