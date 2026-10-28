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
