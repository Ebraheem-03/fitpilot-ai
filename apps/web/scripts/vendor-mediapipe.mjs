#!/usr/bin/env node
// Self-hosts the MediaPipe pose runtime under public/mediapipe (ADR-0010):
//   wasm/   copied from the installed @mediapipe/tasks-vision, so the runtime always matches the JS
//   models/ downloaded once from Google's model bucket and pinned by sha256
// Both are gitignored build inputs. Runs before dev, build and e2e; a no-op when up to date.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "mediapipe");
const require = createRequire(import.meta.url);
// package.json is not in the exports map; resolve a wasm entry and walk up
const pkgDir = dirname(dirname(require.resolve("@mediapipe/tasks-vision/vision_wasm_internal.js")));

const BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker";
const MODELS = {
  "pose_landmarker_lite.task": {
    url: `${BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  },
  "pose_landmarker_full.task": {
    url: `${BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
    sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
  },
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function copyWasm() {
  const dest = join(out, "wasm");
  mkdirSync(dest, { recursive: true });
  // classic SIMD + no-SIMD builds; FilesetResolver picks one per browser (ADR-0010)
  for (const name of [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
  ]) {
    const src = join(pkgDir, "wasm", name);
    const dst = join(dest, name);
    if (existsSync(dst) && sha256(readFileSync(dst)) === sha256(readFileSync(src))) continue;
    copyFileSync(src, dst);
  }
}

/** Every build depends on this download (prebuild), so time out and retry transient failures. */
async function download(url, name, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (i >= attempts)
        throw new Error(`${name}: ${error} from ${url} after ${attempts} attempts`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function fetchModels() {
  const dest = join(out, "models");
  mkdirSync(dest, { recursive: true });
  for (const [name, { url, sha256: want }] of Object.entries(MODELS)) {
    const dst = join(dest, name);
    if (existsSync(dst) && sha256(readFileSync(dst)) === want) continue;
    const buf = await download(url, name);
    const got = sha256(buf);
    if (got !== want) throw new Error(`${name}: sha256 ${got} ≠ pinned ${want}`);
    writeFileSync(dst, buf);
    console.log(`vendor-mediapipe: fetched ${name} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
}

copyWasm();
await fetchModels();
