import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

/** The proxy refreshes the Supabase session; only exact public static paths may skip it. */
describe("proxy matcher", () => {
  it.each([
    "/mediapipe/wasm/vision_wasm_internal.wasm",
    "/mediapipe/wasm/vision_wasm_nosimd_internal.js",
    "/mediapipe/models/pose_landmarker_lite.task",
    "/exercises/bodyweight_squat/squat.glb",
  ])("skips vendored static asset %s", (url) => expect(matches(url)).toBe(false));

  it.each([
    "/app/exercises/bodyweight_squat",
    "/app/mediapipe/models/pose_landmarker_lite.task",
    "/mediapipe/models/../../app/profile",
    "/mediapipe/other/thing.task",
    "/mediapipe/wasm/x.html",
    "/dev/pose-bench",
  ])("runs for %s", (url) => expect(matches(url)).toBe(true));
});
