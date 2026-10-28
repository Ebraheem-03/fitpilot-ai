import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { assetPath, loadCatalog, MOTIONS } from "../src/catalog";
import { checkAsset, LIMITS } from "../src/check";
import { squatPose } from "../src/clips/squat";
import type { MotionDefinition } from "../src/clips/types";
import { buildGlb } from "../src/glb";
import { bindClip } from "../src/timeline";

const catalog = loadCatalog();
const squat = catalog.find((e) => e.id === "bodyweight_squat")!;
const committed = () => new Uint8Array(readFileSync(assetPath(squat)));
const cases = catalog.map((e) => [e.id, e] as const);

describe("exercise GLBs (assets:check, ADR-0009)", () => {
  it("has a motion for every catalogue exercise", () => {
    expect(catalog.filter((e) => !MOTIONS[e.id]).map((e) => e.id)).toEqual([]);
  });

  it.each(cases)("%s: committed GLB equals the generator output", async (_id, exercise) => {
    const fresh = await buildGlb([bindClip(exercise.animation, MOTIONS[exercise.id]!)]);
    const bytes = new Uint8Array(readFileSync(assetPath(exercise)));
    expect(
      Buffer.compare(Buffer.from(fresh), Buffer.from(bytes)),
      "committed GLB is stale: run `pnpm --filter @fitpilot/avatar assets:build` and commit it",
    ).toBe(0);
  });

  it.each(cases)("%s: passes the quality gate", async (_id, exercise) => {
    const bytes = new Uint8Array(readFileSync(assetPath(exercise)));
    const { problems, stats } = await checkAsset(exercise, bytes);
    expect(problems).toEqual([]);
    expect(stats!.footDriftM).toBeLessThan(0.001);
  });

  it("reports a missing file", async () => {
    expect((await checkAsset(squat, null)).problems).toEqual(["squat.glb is missing"]);
  });

  it("reports a corrupt file", async () => {
    const { problems } = await checkAsset(squat, committed().slice(0, 4000));
    expect(problems[0]).toMatch(/^glTF-Validator: \d+ error/);
  });

  it("reports a clip name or duration that disagrees with the catalogue", async () => {
    const renamed = { ...squat, animation: { ...squat.animation, clip: "air_squat" } };
    expect((await checkAsset(renamed, committed())).problems[0]).toMatch(
      /clip "air_squat" not found/,
    );
    const longer = { ...squat, animation: { ...squat.animation, duration_s: 5 } };
    expect((await checkAsset(longer, committed())).problems[0]).toMatch(/catalogue says 5 s/);
  });

  // Each branch of the gate must actually fire (M1 review): build deliberately broken clips.
  const broken = (shift: (pose: ReturnType<typeof squatPose>, depth: number) => void) => {
    const motion: MotionDefinition = {
      ...MOTIONS.bodyweight_squat!,
      pose: (depth) => {
        const pose = squatPose(depth);
        shift(pose, depth);
        return pose;
      },
    };
    return buildGlb([bindClip(squat.animation, motion)]);
  };

  it("reports feet that slide", async () => {
    const bytes = await broken((pose, d) => (pose.hips.x += 0.05 * d));
    expect((await checkAsset(squat, bytes)).problems).toEqual([
      expect.stringMatching(/^feet slide 5\.\d\d cm/),
    ]);
  });

  it("reports a body that sinks through the floor", async () => {
    const bytes = await broken((pose, d) => (pose.hips.y -= 0.05 * d));
    expect((await checkAsset(squat, bytes)).problems).toEqual([
      expect.stringMatching(/^mesh goes 5\d\.\d mm below the floor/),
    ]);
  });

  it("reports a missing bone", async () => {
    const io = new NodeIO();
    const doc = await io.readBinary(committed());
    doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === "foot_l")!
      .setName("left_foot");
    expect((await checkAsset(squat, await io.writeBinary(doc))).problems).toContain(
      "missing bones: foot_l",
    );
  });

  it("reports a file over the size limit", async () => {
    const padded = new Uint8Array(LIMITS.maxBytes);
    padded.set(committed());
    expect((await checkAsset(squat, padded)).problems[0]).toMatch(/limit 3145728\)$/);
  });
});
