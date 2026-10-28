import { readFileSync } from "node:fs";
import type { ExerciseAnimation } from "@fitpilot/exercise-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewerError } from "./compat";
import { loadExerciseModel } from "./model";

const glb = readFileSync(
  new URL("../../../public/exercises/bodyweight_squat/squat.glb", import.meta.url),
);
const animation: ExerciseAnimation = {
  asset: "squat.glb",
  clip: "squat",
  duration_s: 4,
  phases: [{ phase: "standing", start_s: 0, end_s: 4, instruction_indices: [] }],
};
const serve = (response: () => Response | Promise<Response>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (e: unknown) => (e instanceof ViewerError ? e.reason : `other: ${String(e)}`),
  );

afterEach(() => vi.unstubAllGlobals());

describe("loadExerciseModel (FR-03 failure classification)", () => {
  it("loads the committed squat GLB with its clip", async () => {
    serve(() => new Response(glb));
    const model = await loadExerciseModel("/x.glb", animation);
    expect(model.clip.name).toBe("squat");
    expect(model.scene.getObjectByName("foot_l")).toBeTruthy();
  });

  it("classifies an HTTP error as missing", async () => {
    serve(() => new Response(null, { status: 404 }));
    expect(await reasonOf(loadExerciseModel("/x.glb", animation))).toBe("missing");
  });

  it("classifies a network failure as missing", async () => {
    serve(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await reasonOf(loadExerciseModel("/x.glb", animation))).toBe("missing");
  });

  it("classifies unparseable bytes as corrupt", async () => {
    serve(() => new Response("not a glb"));
    expect(await reasonOf(loadExerciseModel("/x.glb", animation))).toBe("corrupt");
  });

  it("classifies a GLB without the catalogue's clip as incompatible", async () => {
    serve(() => new Response(glb));
    const other = { ...animation, clip: "push_up" };
    expect(await reasonOf(loadExerciseModel("/x.glb", other))).toBe("incompatible");
  });

  it("rethrows an abort instead of reporting a failure", async () => {
    const controller = new AbortController();
    controller.abort();
    serve(() => Promise.reject(new DOMException("aborted", "AbortError")));
    expect(await reasonOf(loadExerciseModel("/x.glb", animation, controller.signal))).toMatch(
      /^other: AbortError/,
    );
  });
});
