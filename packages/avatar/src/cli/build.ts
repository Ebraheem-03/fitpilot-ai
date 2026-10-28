import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SQUAT_CLIP } from "../clips/squat.ts";
import { buildGlb } from "../glb.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = resolve(repo, "apps/web/public/exercises/bodyweight_squat/squat.glb");

const glb = await buildGlb([SQUAT_CLIP]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log(`wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} KiB)`);
