import { defineConfig, devices } from "@playwright/test";
import { FAKE_CAMERA_Y4M, SHALLOW_CAMERA_Y4M } from "./tests/e2e/fake-camera";

// Dedicated ports so e2e never reuses a dev server that may point at the hosted Supabase project.
// Run via `make e2e` (scripts/e2e.sh), which provides a local Supabase stack + env (ADR-0003).
const WEB_PORT = 3100;
const API_PORT = 8100;
const FAKE_MEDIA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    // Camera tests use Chrome's fake device so no real video is ever captured.
    launchOptions: { args: FAKE_MEDIA },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/live-coaching\.spec\.ts/, /live-cues\.spec\.ts/, /\.setup\.ts/],
    },
    // Builds the mannequin camera feed (ADR-0010 §8) once, before the live-coaching exit test.
    { name: "fake-camera", testMatch: /fake-camera\.setup\.ts/, use: devices["Desktop Chrome"] },
    {
      name: "live-coaching",
      testMatch: /live-coaching\.spec\.ts/,
      dependencies: ["fake-camera"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [...FAKE_MEDIA, `--use-file-for-fake-video-capture=${FAKE_CAMERA_Y4M}`],
        },
      },
    },
    // FR-06 cues: the same real model on a feed of shallow squats that triggers squat.depth.shallow.
    {
      name: "live-cues",
      testMatch: /live-cues\.spec\.ts/,
      dependencies: ["fake-camera"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [...FAKE_MEDIA, `--use-file-for-fake-video-capture=${SHALLOW_CAMERA_Y4M}`],
        },
      },
    },
  ],
  webServer: [
    {
      command: `uv run uvicorn app.main:app --port ${API_PORT}`,
      cwd: "../../services/api",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/vendor-mediapipe.mjs && pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
