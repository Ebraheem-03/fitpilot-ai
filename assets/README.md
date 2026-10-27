# 3D assets

`assets/exercises/<exercise_id>/` holds the GLB (`<name>.glb`, referenced by `animation_asset` in the catalogue) plus `source.blend` notes and licence info.

Pipeline (M1): rigged humanoid → author/retarget clip in Blender → export glTF Binary (Y-up, +Y forward off, apply transforms, animation only for the active action) → validate with `npx gltf-validator` → copy to `apps/web/public/exercises/<id>/`.

Review checklist per clip: joint ranges plausible, feet don't slide or clip the floor, loop seams clean, phase timestamps recorded in the catalogue.

Keep GLBs small (<3 MB, Draco/meshopt compression). Large binaries: consider Git LFS before committing.
