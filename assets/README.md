# 3D assets

The avatar and every exercise clip are **generated** by `packages/avatar` (ADR-0009). There are no hand-authored or third-party assets, so there is nothing to licence: the output is CC0.

```
data/exercise-catalog/<id>.json  ──(animation.phases timings)──┐
packages/avatar/src/clips/<x>.ts ──(pose(depth) + phaseDepth)──┴─► pnpm --filter @fitpilot/avatar assets:build
                                                                    └─► apps/web/public/exercises/<id>/<animation.asset>
```

- `assets:build` regenerates every GLB. Commit the output; it is deterministic.
- `assets:check` (and `pnpm test`, so CI) fails when a GLB is missing, is ≥ 3 MB, has glTF-Validator errors, lacks a bone or the catalogue's clip, has a clip duration off by > 0.05 s, lets a foot slide > 2 cm, goes > 5 mm below the floor, or differs from a fresh build.
- Joint ranges (knee flexion, thigh depth, trunk lean, knee valgus, centre of mass over the feet) are unit-tested per clip in `packages/avatar/test/<clip>.test.ts`.

## Adding an exercise's demo

1. Add the catalogue entry with its `animation` block (phases + timings + instruction indices).
2. Write `packages/avatar/src/clips/<name>.ts`: a `pose(depth)` using IK for every body part in contact with the floor, and `phaseDepth` for each phase.
3. Register it in `MOTIONS` (`src/catalog.ts`), add a joint-range test, run `assets:build`, look at it in the viewer from front, side and 45°, then commit.

`exercises/<id>/README.md` records provenance for each demo.
