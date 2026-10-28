# ADR-0010: Pose runtime — self-hosted MediaPipe in a classic worker, lite model, auto delegate

- **Status:** accepted (M2 S0 spike, 2026-10-28). Phone numbers pending; see Consequences.
- **Date:** 2026-10-28
- **Requirements:** FR-04, FR-05, NFR-Pose processing (15–30 fps), NFR-Feedback latency, NFR-Privacy, NFR-Responsiveness

## Context

ADR-0002 put PoseLandmarker in a Web Worker and asked M2 to measure first. The S0 spike (`/dev/pose-bench`, `apps/web/src/features/live-coaching/bench`) ran PoseLandmarker 1.1.1 over a synthetic frame source: the M1 squat mannequin rendered side-on at 640×480. MediaPipe detects the mannequin as a person on 100 % of frames. For each config the spike recorded processed fps, inference and capture→landmarks latency (p50/p95), main-thread `requestAnimationFrame` rate and long tasks. Numbers are in `docs/architecture/benchmarks.md`.

What the spike found:

1. **Turbopack emits `new Worker(new URL(…), { type: "module" })` as a classic worker.** The ES-module WASM build fails there (`importScripts` → `import.meta` SyntaxError), and on the main thread too (MediaPipe injects it as a plain `<script>`). The classic build works in both, in dev and in a production build.
2. **The worker keeps the page smooth.** On an M1 Pro with Chrome, inference on the main thread takes 9–16 ms of every frame: the page drops from 120 to 61–110 rAF/s. In the worker the page stays at 120. Phones are slower, so this gap gets wider there.
3. **GPU on a software rasteriser is pathological.** In headless Chromium (SwiftShader, like CI), the GPU delegate took 7.6 s to initialise, ran at ≤ 10 fps and dragged the page to 1–30 rAF/s. CPU on the same machine ran at 30 fps with the page at 60.
4. **Cold start is real.** The first GPU inference compiled shaders for up to 7.5 s (WebKit). If that happens on the first camera frame, it looks like a hang.
5. **VideoFrame transport is unreliable.** One Chrome run processed 0 frames and another processed 57 fps. `createImageBitmap` costs ≤ 0.1 ms, so there is nothing to gain from VideoFrame.
6. **Lite vs full on the M1 Pro:** both easily exceed 30 fps (worker GPU: lite 55–59, full 56–60; worker CPU: lite 45–55, full 31). Full costs about 60 % more on CPU (25 vs 16 ms).
7. WebKit (Playwright 27.2) runs the same worker, GPU in the worker included. Detection was 100 %.

## Options considered

| Option                                                                                 | Pros                                                                                                                        | Cons                                                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Main-thread inference                                                                  | Simplest; no transfer                                                                                                       | Eats the frame budget (finding 2); every slow device janks the UI                                        |
| Worker + ES-module WASM                                                                | "Modern"                                                                                                                    | Doesn't load under Turbopack (finding 1)                                                                 |
| **Worker + classic WASM, self-hosted, `ImageBitmap` transfer, auto delegate** (chosen) | Works in Chrome/WebKit, dev/prod; UI stays smooth; no third-party CDN at runtime (CSP and privacy simpler); versions pinned | ~13 MB WASM + 5.8 MB model on first use; we own cache headers                                            |
| jsDelivr / Google CDN for WASM + model                                                 | No vendoring step                                                                                                           | Third-party request on a camera page; version drift; CSP must allow two more origins; offline dev breaks |

## Decision

1. **Runtime:** `@mediapipe/tasks-vision` PoseLandmarker, `VIDEO` mode, `numPoses: 1`, in `features/live-coaching/worker/pose.worker.ts` (the `PoseRunner` class is DOM-free and also runs on the main thread for benchmarks only). Use the classic WASM loader: `FilesetResolver.forVisionTasks(base)` without `useModule`.
2. **Self-hosted assets:** `apps/web/scripts/vendor-mediapipe.mjs` copies the classic SIMD and no-SIMD WASM from the installed package and fetches `pose_landmarker_{lite,full}.task`, pinned by sha256, into `public/mediapipe/` (gitignored). It runs on `predev`, `prebuild` and before the e2e web server. The proxy matcher skips exactly `/mediapipe/{wasm,models}/<file>`.
3. **Model: `lite` by default.** It is the cheaper one and the phone is unmeasured. The S2 capture tool exports landmarks from both models, and the S4 regression run decides whether `full` is worth its cost. Switching is one constant.
4. **Delegate: `auto`.** Use GPU when the WebGL2 renderer is hardware, and CPU on SwiftShader/llvmpipe/software. If GPU init fails, fall back to CPU.
5. **Warm-up:** `init` runs one inference on a blank 256×256 OffscreenCanvas, so "ready" means the first real frame won't stall. The UI shows a "preparing tracking" state until then.
6. **Frames:** `createImageBitmap(video)`, transferred to the worker and closed there. One frame is in flight at a time; frames that arrive while the worker is busy are dropped, never queued. Only a `Float32Array` of 33 × (x, y, z, visibility) comes back.
7. **Degradation (implemented in S5):** processed fps is measured over a rolling 2 s window. Below 15 fps, show a "device is slow, tracking may be less reliable" notice. Below 8 fps, treat tracking as unreliable and withhold counting/analysis (principle 3).
8. **Testing:** no test hooks in product code. Vitest drives the engine with a `FixtureReplayPoseSource` (recorded landmark JSON). Playwright e2e runs the **real model in the real worker** on a synthetic camera feed: Chrome's `--use-file-for-fake-video-capture` plays a video of the generated mannequin squatting, made at test time. It contains no real person, and its ground-truth rep count is known. Blank segments in the same feed exercise tracking loss.

## Consequences

- **Phone measurement is still open.** Before S5 merges, run `/dev/pose-bench` on a mid-range phone (the avatar source needs no camera, so `http://<LAN-IP>` works) and record it. If the phone's lite worker config is under 15 fps, add the cheaper levers before S6: downscale to 256 px input and infer every other frame.
- **First-use download:** about 13 MB of WASM plus 5.8 MB of model. The camera page must show load progress, and `Cache-Control` for `/mediapipe/*` (immutable + versioned path) is decided with hosting at M5 (ADR-0005).
- **CSP (S5):** same-origin `worker-src 'self' blob:` and `'wasm-unsafe-eval'` in `script-src`. No third-party origins are needed.
- **CI runs CPU inference** (SwiftShader ⇒ auto ⇒ CPU): about 30 fps on the mannequin, which is enough for e2e. GPU paths are covered by the benchmark only.
- **Re-measure** when `@mediapipe/tasks-vision` is bumped. The vendor script copies the WASM from the installed version, so JS and WASM can't drift apart.
