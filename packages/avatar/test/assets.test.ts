import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assetPath, loadCatalog, MOTIONS } from "../src/catalog";
import { checkAsset } from "../src/check";
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
    expect(Buffer.compare(Buffer.from(fresh), Buffer.from(bytes))).toBe(0);
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
});
