import type { ExerciseContract } from "@fitpilot/exercise-contracts";
import { validateBytes } from "gltf-validator";
import { AnimationMixer, type SkinnedMesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BONES } from "./skeleton";

/** Quality gate for an exercise GLB (ADR-0009 decision 5, risk §15). */
export const LIMITS = {
  maxBytes: 3 * 1024 * 1024,
  durationToleranceS: 0.05,
  maxFootDriftM: 0.02,
  minVertexY: -0.005,
  sampleHz: 60,
} as const;

export interface AssetStats {
  bytes: number;
  footDriftM: number;
  lowestVertexY: number;
}

export interface AssetReport {
  problems: string[];
  stats: AssetStats | null;
}

export async function checkAsset(
  exercise: ExerciseContract,
  bytes: Uint8Array | null,
): Promise<AssetReport> {
  const { asset, clip: clipName, duration_s } = exercise.animation;
  if (!bytes) return { problems: [`${asset} is missing`], stats: null };
  const problems: string[] = [];
  if (bytes.byteLength >= LIMITS.maxBytes) {
    problems.push(`${asset} is ${bytes.byteLength} bytes (limit ${LIMITS.maxBytes})`);
  }

  const report = await validateBytes(bytes, { maxIssues: 20 });
  if (report.issues.numErrors > 0) {
    const first = report.issues.messages
      .filter((m) => m.severity === 0)
      .slice(0, 3)
      .map((m) => `${m.code} at ${m.pointer ?? "?"}`);
    problems.push(`glTF-Validator: ${report.issues.numErrors} error(s): ${first.join("; ")}`);
    return { problems, stats: null };
  }

  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "",
  );
  const missingBones = BONES.filter((b) => !gltf.scene.getObjectByName(b.name)).map((b) => b.name);
  if (missingBones.length) problems.push(`missing bones: ${missingBones.join(", ")}`);
  let mesh: SkinnedMesh | undefined;
  gltf.scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) mesh ??= o as SkinnedMesh;
  });
  if (!mesh) problems.push("no skinned mesh");

  const clip = gltf.animations.find((a) => a.name === clipName);
  if (!clip) {
    problems.push(
      `clip "${clipName}" not found (has: ${gltf.animations.map((a) => a.name).join(", ")})`,
    );
  } else if (Math.abs(clip.duration - duration_s) > LIMITS.durationToleranceS) {
    problems.push(
      `clip "${clipName}" lasts ${clip.duration.toFixed(3)} s, catalogue says ${duration_s} s`,
    );
  }
  if (!clip || !mesh || missingBones.length) return { problems, stats: null };

  // Play the clip exactly as the browser would and measure contact with the floor.
  const mixer = new AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  const feet = ["foot_l", "foot_r"].map((n) => gltf.scene.getObjectByName(n)!);
  const start = new Map<string, Vector3>();
  const p = new Vector3();
  const v = new Vector3();
  const positions = mesh.geometry.getAttribute("position");
  let footDriftM = 0;
  let lowestVertexY = Infinity;
  const frames = Math.round(clip.duration * LIMITS.sampleHz);
  for (let f = 0; f <= frames; f++) {
    mixer.setTime(f / LIMITS.sampleHz);
    gltf.scene.updateMatrixWorld(true);
    for (const foot of feet) {
      foot.getWorldPosition(p);
      const origin = start.get(foot.name) ?? start.set(foot.name, p.clone()).get(foot.name)!;
      footDriftM = Math.max(footDriftM, Math.hypot(p.x - origin.x, p.z - origin.z));
    }
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      lowestVertexY = Math.min(lowestVertexY, v.y);
    }
  }
  if (footDriftM > LIMITS.maxFootDriftM) {
    problems.push(
      `feet slide ${(footDriftM * 100).toFixed(2)} cm (limit ${LIMITS.maxFootDriftM * 100} cm)`,
    );
  }
  if (lowestVertexY < LIMITS.minVertexY) {
    problems.push(`mesh goes ${(-lowestVertexY * 1000).toFixed(1)} mm below the floor`);
  }
  return { problems, stats: { bytes: bytes.byteLength, footDriftM, lowestVertexY } };
}
