import { defineConfig, devices } from "@playwright/test";

// Dedicated ports so e2e never reuses a dev server that may point at the hosted Supabase project.
// Run via `make e2e` (scripts/e2e.sh), which provides a local Supabase stack + env (ADR-0003).
const WEB_PORT = 3100;
const API_PORT = 8100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    // Live-coaching tests use a fake camera stream so no real video is ever captured.
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `uv run uvicorn app.main:app --port ${API_PORT}`,
      cwd: "../../services/api",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
