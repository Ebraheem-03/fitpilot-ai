# ADR-0009: Generated CC0 mannequin, IK-authored clips, GLBs served from `public/`

- **Status:** accepted (M1 S0 spike, 2026-10-28)
- **Date:** 2026-10-28
- **Requirements:** FR-03, NFR-Portability, NFR-Responsiveness; risk §15 "Poor 3D animation quality"

## Context

FR-03 needs one rigged humanoid and a small set of reviewed clips (squat now; curl and push-up in M4). The repo is public, so every asset in it must be redistributable. Risk §15 asks us to "validate joint motion and floor contact before adding exercises". This machine has no Blender, and some sources need an account login that Claude can't do. Budget is free tiers only (ADR-0006).

The S0 spike (branch `spike/m1-s0-avatar`) looked at three sources:

- **Mixamo.** Adobe staff say the raw character and animation files may not be redistributed ([Adobe community FAQ](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400)). A GLB under `public/` in a public repo is exactly such a raw file.
- **Quaternius Universal Animation Library.** CC0, glTF, universal humanoid rig ([pack page](https://quaternius.com/packs/universalanimationlibrary.html), [itch.io](https://quaternius.itch.io/universal-animation-library)). It lists no squat, and there is no direct download URL (itch/Patreon), so a squat would still have to be authored, and that needs Blender.
- **A generated mannequin.** A TypeScript generator in `packages/avatar` writes the skeleton, a rigid-skinned capsule mesh and the clips. Each clip is a pose as a function of a 0–1 depth value, and analytic two-bone IK pins the feet to the floor.

## Options considered

| Option                                              | Pros                                                                                                                                                                                                       | Cons                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Mixamo character + "Air Squat"                      | Best-looking motion capture                                                                                                                                                                                | Can't ship in a public repo; needs an Adobe login; no control over phase timings                                               |
| CC0 character (Quaternius) + Blender-authored squat | Human-looking, licence-clean                                                                                                                                                                               | Manual download; Blender authoring isn't reproducible from the repo; foot contact has to be checked by hand for every clip     |
| **Generated mannequin + IK clips** (chosen)         | CC0 by construction; rebuilt from source by one command; feet can't slide or clip by construction; phase timings are defined in code next to the motion; bone origins match MediaPipe landmarks (helps M2) | Stylised "artist's mannequin" look, not a human; every clip is a hand-written pose function; joint ranges need explicit review |
| Do nothing (text + image instructions only)         | Zero risk                                                                                                                                                                                                  | Fails FR-03 (P0)                                                                                                               |

## Decision

1. **Avatar and clips are generated** by `packages/avatar` (`pnpm --filter @fitpilot/avatar build:assets`). The committed GLB is a build output. CI rebuilds it and fails if the bytes differ, so it can never drift from its source.
2. **Rig:** 18 bones, identity rest rotations, glTF Y-up, facing +Z. Joint origins sit at the anatomical landmarks (`thigh_l` = left hip, `shin_l` = left knee, `foot_l` = left ankle, `upper_arm_l` = left shoulder, …). Each mesh part follows exactly one bone (rigid skinning), and spheres at the joints hide the seams.
3. **Clips** are LINEAR-sampled at 30 fps with one glTF animation per exercise, named after it (`squat`). Phase timings live in the catalogue's `animation` block (contract change in M1 S1) and must equal the generator's `ClipDefinition.phases`. `assets:check` compares them.
4. **Assets ship uncompressed under `apps/web/public/exercises/<id>/`**, not in Supabase Storage and not via Git LFS. 490 KiB raw / 120 KiB gzip doesn't justify a Draco/meshopt decoder or a second origin. Revisit if any single GLB passes 1.5 MiB or the total passes 10 MiB.
5. **Quality gate (`assets:check`, M1 S2):** glTF-Validator reports 0 errors; the file is under 3 MB; the named clip exists and its duration matches the catalogue; when the GLB is played through three's `AnimationMixer`, feet drift less than 2 cm horizontally and no vertex goes below −5 mm. Joint ranges are checked against the rest of the generator's unit tests.

## Spike evidence (2026-10-28)

- `/spike/avatar` renders the GLB via `next/dynamic({ ssr: false })` + drei `useGLTF`/`useAnimations` in headless Chromium (Playwright, SwiftShader). Screenshots: [standing](../spikes/m1-s0/squat-t0-45.png), [bottom, side](../spikes/m1-s0/squat-t2.2-side.png), [bottom, 45°](../spikes/m1-s0/squat-t2.2-45.png).
- glTF-Validator: 0 errors / 0 warnings / 0 infos; 8,517 vertices, 14,544 triangles, 3 draw calls, 1 skin, 1 animation (16 tracks, 4.0 s).
- Played back through three's `AnimationMixer` in Node at 60 Hz, independently of the generator's maths: max ankle drift 0.009 cm; lowest vertex y = −0.0001 m; ankle height never below 0.0799 m.
- Size: GLB 490 KiB raw / 120 KiB gzip. The lazy three + R3F + drei chunk is 982 KiB raw / **260 KiB gzip**, loaded only where the viewer mounts.
- `three/examples/jsm/loaders/GLTFLoader` parses the GLB in Node, so `assets:check` needs no browser.

## Consequences

- No third-party asset licences to track. `assets/exercises/bodyweight_squat/README.md` points to the generator and states CC0.
- Adding an exercise (M4) means writing a pose function, a depth curve and a phase list, then passing `assets:check`. That's code review, not Blender work, though writing natural-looking motion by hand takes care. Push-ups need hand contacts as a second IK target set.
- The mannequin look is deliberate and documented. Swapping in a human-looking CC0 rig later only replaces `mesh.ts`/`skeleton.ts`; clips and checks stay.
- Findings for the build: the proxy matcher currently runs Supabase session refresh on `*.glb` requests (exclude it in S4). Pages using the viewer must keep `searchParams`/cookies inside Suspense under Cache Components (seen on the spike page). Vercel may not gzip `model/gltf-binary`; measure in S7.
- `/exercises/<id>/<asset>.glb` is public and skips the session proxy (`apps/web/src/proxy.ts`). Only CC0 demo assets may live there; anything user-specific or licensed must be served another way. Paths under `/app` always go through the proxy, whatever their extension (M1 security review).
- ADR-0003's "object storage for GLB assets" is not used for now (decision 4).
