// Regenerates every exercise GLB from the catalogue + motions (ADR-0009). Output is committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { assetPath, loadCatalog, MOTIONS, REPO_ROOT } from "../catalog";
import { buildGlb } from "../glb";
import { bindClip } from "../timeline";

for (const exercise of loadCatalog()) {
  const motion = MOTIONS[exercise.id];
  if (!motion) throw new Error(`no motion for ${exercise.id}; add one to MOTIONS`);
  const glb = await buildGlb([bindClip(exercise.animation, motion)]);
  const out = assetPath(exercise);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, glb);
  console.log(`wrote ${relative(REPO_ROOT, out)} (${(glb.byteLength / 1024).toFixed(1)} KiB)`);
}
