# apps/web — Next.js frontend (member, trainer, admin UIs)

@AGENTS.md

- Next.js 16 App Router, React 19, Tailwind v4, TypeScript strict. **Check `node_modules/next/dist/docs/` or Context7 before using any Next API** — training data is stale for v16.
- Feature folders under `src/features/<area>`; see `src/features/README.md` for the FR → folder map.
- 3D: React Three Fiber + drei. Load GLBs from `/public/exercises/<id>/` (copied from `assets/exercises`). Lazy-load the viewer with `next/dynamic({ ssr: false })` so it never blocks the page (FR-03).
- Vision: `@mediapipe/tasks-vision` PoseLandmarker in a **Web Worker** (`src/features/live-coaching/worker`). The worker posts landmark frames; analysis uses `@fitpilot/exercise-rules`. Never send frames or video to the server.
- Never render a correction that did not come from an `exercise-rules` cue object (FR-06).
- Server data fetching hits the FastAPI API; never call the LLM provider from the browser.
- Accessibility: every camera-based flow needs a non-camera alternative and keyboard operation.
- Tests: unit `*.test.ts(x)` with Vitest next to source; e2e in `tests/e2e` with Playwright (fake camera flags already configured).
- Commands: `pnpm --filter @fitpilot/web dev | build | lint | typecheck | test | test:e2e`.
