# features/

One folder per product area (blueprint §12). Each feature owns its components, hooks and tests.

| folder          | FRs                 | milestone |
| --------------- | ------------------- | --------- |
| onboarding      | FR-01               | M0        |
| exercise-viewer | FR-03               | M1        |
| live-coaching   | FR-04, FR-05, FR-06 | M2–M3     |
| workouts        | FR-02, FR-07        | M3        |
| nutrition       | FR-08               | M4        |
| dashboard       | FR-10, FR-11        | M4–M5     |

Rules: no feature imports another feature's internals — share via `src/lib` or a workspace package.
Camera + pose inference run in a Web Worker (NFR: pose estimation must not block the UI).
