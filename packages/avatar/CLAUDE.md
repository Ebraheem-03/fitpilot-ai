# packages/avatar — generated mannequin + exercise clips (ADR-0009, FR-03)

- Node-only build tooling (three math + glTF-Transform). Nothing here is imported by the web app at runtime; the web app loads the GLB output from `apps/web/public/exercises/`.
- Rig: identity rest rotations, Y-up, facing +Z, character's left = +X. Joint origins = anatomical landmarks (see `skeleton.ts`). Rigid skinning, one bone per mesh part.
- A clip = `pose(depth)` + `phaseDepth`; **timings come from the catalogue only**. Use IK (`solveTwoBone`) for anything touching the floor so contacts are exact.
- After changing a motion, mesh or catalogue timing: `pnpm assets:build`, commit the GLB, and check it visually. `pnpm test` fails if the committed GLB is stale.
- Joint-range tests are plausibility bounds for a demo, not coaching rules; never import them into `exercise-rules`.
