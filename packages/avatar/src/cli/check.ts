// `pnpm assets:check`: quality gate for every catalogue exercise's GLB (ADR-0009, FR-03).
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { checkAsset } from "../check";
import { assetPath, loadCatalog, MOTIONS, REPO_ROOT } from "../catalog";
import { buildGlb } from "../glb";
import { bindClip } from "../timeline";

let failed = false;
for (const exercise of loadCatalog()) {
  const path = assetPath(exercise);
  const bytes = existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  const { problems, stats } = await checkAsset(exercise, bytes);
  const motion = MOTIONS[exercise.id];
  if (!motion) problems.push(`no motion registered for ${exercise.id}`);
  else if (bytes) {
    const fresh = await buildGlb([bindClip(exercise.animation, motion)]);
    if (Buffer.compare(Buffer.from(fresh), Buffer.from(bytes)) !== 0) {
      problems.push("committed GLB differs from the generator output; run `pnpm assets:build`");
    }
  }
  const name = relative(REPO_ROOT, path);
  if (problems.length) {
    failed = true;
    console.error(`✗ ${name}\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  } else if (stats) {
    console.log(
      `✓ ${name}: ${(stats.bytes / 1024).toFixed(1)} KiB, foot drift ${(stats.footDriftM * 100).toFixed(3)} cm, lowest vertex ${(stats.lowestVertexY * 1000).toFixed(2)} mm`,
    );
  }
}
process.exit(failed ? 1 : 0);
