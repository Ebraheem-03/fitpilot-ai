# Benchmarks

Measured numbers that back NFR claims. Each entry records how it was measured so it can be repeated. These are engineering checks, not promises about real devices (blueprint Part III).

## 3D exercise viewer (FR-03, M1) — 2026-10-28

| What                                          | Value                                      | How                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Squat GLB                                     | 490 KiB raw / 120 KiB gzip                 | `pnpm --filter @fitpilot/avatar assets:check`; `gzip -c` (ADR-0009)                                                                     |
| `/app/exercises/[id]` page JS (entry, own)    | 36 KiB raw / **13 KiB gzip**; no three.js  | `next build`, page client-reference manifest `entryJSFiles`, grepped for `WebGLRenderer`                                                |
| Lazy 3D chunks (three, R3F, drei, GLTFLoader) | 962 KiB raw / **257 KiB gzip** in 3 chunks | same build; fetched only when the viewer mounts (`next/dynamic` + `import("./model")`)                                                  |
| Time to viewer `ready` (warm)                 | 1.0–1.3 s (cold first load 2.1 s)          | Playwright, `next dev` + local API, headless Chromium with SwiftShader (CPU WebGL), `performance.now()` at `data-status=ready`; 4 loads |
| GLB fetch                                     | 6 ms (localhost)                           | Resource Timing                                                                                                                         |
| Main-thread frame rate while playing          | ~57 rAF/s (60 paused)                      | 2 s `requestAnimationFrame` count in the same headless run                                                                              |

Notes:

- These are upper bounds from a development server with software rendering; a production build on a GPU device should be faster. Re-measure on the documented target devices before M5.
- While paused the canvas renders on demand (`frameloop="demand"`), and off-screen it doesn't render at all (`"never"`), so it costs nothing when idle.
- Vercel may not gzip `model/gltf-binary`. Check the deployed `Content-Encoding` at M5 (ADR-0009 consequence).

## Pose estimation runtime (FR-04, M2 S0 → ADR-0010) — 2026-10-28

Harness: `/dev/pose-bench` (`apps/web/src/features/live-coaching/bench`). Source: the M1 squat mannequin rendered side-on at 640×480 (synthetic, detected on 100 % of frames). 1.5 s warm-up, then 8 s per config (5 s for WebKit/headless). One frame in flight; frames that arrive while busy are dropped. `@mediapipe/tasks-vision` 1.1.1, `next dev`.

**M1 Pro (14-core GPU, 16 GB), Chrome 155, 120 Hz display**

| Thread | Model | Delegate   | Transport  | fps   | infer p50/p95 ms | capture→landmarks p50/p95 ms | page rAF/s |
| ------ | ----- | ---------- | ---------- | ----- | ---------------- | ---------------------------- | ---------- |
| worker | lite  | auto → GPU | bitmap     | 55.3  | 14.0 / 20.1      | 14.3 / 20.3                  | 122.6      |
| worker | lite  | GPU        | bitmap     | 59.2  | 11.8 / 14.6      | 12.0 / 14.8                  | 120.1      |
| worker | lite  | CPU        | bitmap     | 54.7  | 16.0 / 16.7      | 16.3 / 17.0                  | 120.1      |
| worker | full  | GPU        | bitmap     | 60.0  | 12.9 / 13.2      | 13.1 / 13.5                  | 120.1      |
| worker | full  | CPU        | bitmap     | 30.6  | 25.0 / 25.6      | 25.3 / 25.8                  | 120.1      |
| worker | lite  | GPU        | videoframe | 0 ¹   | —                | —                            | 121.2      |
| main   | lite  | GPU        | direct     | 109.5 | 8.7 / 9.5        | 8.7 / 9.5                    | **109.5**  |
| main   | lite  | CPU        | direct     | 60.9  | 16.2 / 16.8      | 16.2 / 16.8                  | **60.9**   |
| main   | full  | GPU        | direct     | 89.3  | 10.7 / 12.0      | 10.7 / 12.0                  | **89.3**   |

Model init (after the WASM is cached) took 170–500 ms. `createImageBitmap` took ≤ 0.1 ms. There were no long tasks (>50 ms) in any config on this machine. Main-thread inference shows up as lost frames instead: page rAF equals the inference rate.
¹ The VideoFrame transport processed 0 frames in this run and 57.5 fps in an earlier one, so it is unreliable and was rejected.

**Same machine, Playwright WebKit 27.2 (headless, 60 Hz):** worker lite GPU ran at 13.9 fps, but only because its first inference took **7.6 s** of shader compilation inside the window. Measured after that: worker lite CPU 56.5 fps (16 ms), worker full GPU 60 fps (11 ms), main lite GPU 59.7. Page rAF stayed at 60 in every worker config. → warm-up inference in `init`.

**Same machine, headless Chromium (SwiftShader software GL, like CI):** worker lite GPU took 7.6 s to init, ran at 9.6 fps (infer p50 79 ms) and dropped the page to 30 rAF/s; in other runs it never returned a frame and dropped the page to 1–2 rAF/s. Worker lite CPU ran at 29–30 fps (15 ms) with the page at 60. `auto` picked CPU here. A production build (`next build && next start`) behaved the same, so the worker bundles and loads in prod.

**Mid-range phone:** _pending_ (ADR-0010 consequence). Open `/dev/pose-bench` on the phone; the avatar source needs no camera.

## Live squat pipeline (FR-04/FR-05, M2 S7) — 2026-10-28

| What                                                 | Value                  | How                                                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Camera frame → analysed result published (median)    | **17 ms** (n = 127)    | `live-coaching.spec.ts` EXIT samples `data-latency-ms` (engine: `grabFrame` → snapshot update, includes inference). Headless Chromium, SwiftShader ⇒ `auto` = CPU, lite model, `next dev`. |
| Processed fps                                        | 15 (= the feed's rate) | same run; `requestVideoFrameCallback` processes each new camera frame once                                                                                                                 |
| Reps counted vs ground truth                         | 5 / 5, 0 while hidden  | same run; 3 repeated runs green                                                                                                                                                            |
| Requests leaving the page during a session (non-GET) | 0                      | same run. Before the worker's fetch guard, MediaPipe posted usage metrics to `odml.pa.googleapis.com` (ADR-0010 §9)                                                                        |

NFR target "median ≤ 250 ms from processed movement data to a displayed rule-based cue": met with a wide margin on CI-like hardware. Cue display itself is M3 (FR-06). This measures the rep-count path.
