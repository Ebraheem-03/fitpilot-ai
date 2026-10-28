import type { ExerciseAnimation } from "@fitpilot/exercise-contracts";
import type { AnimationClip, Group, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { incompatibility, ViewerError } from "./compat";

export interface ExerciseModel {
  scene: Group;
  clip: AnimationClip;
}

/**
 * Fetches and parses an exercise GLB, classifying failures for the fallback UI. Imported lazily
 * so three.js never lands in the page's main bundle (FR-03: the viewer must not block the app).
 */
export async function loadExerciseModel(
  url: string,
  animation: ExerciseAnimation,
  signal?: AbortSignal,
): Promise<ExerciseModel> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ViewerError("missing", `network error loading ${url}`);
  }
  if (!response.ok) throw new ViewerError("missing", `${url} returned ${response.status}`);

  let gltf: Awaited<ReturnType<GLTFLoader["parseAsync"]>>;
  try {
    gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
  } catch (error) {
    throw new ViewerError("corrupt", error instanceof Error ? error.message : String(error));
  }

  let skinned = false;
  gltf.scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) {
      skinned = true;
      o.castShadow = true;
    }
  });
  const problem = incompatibility(
    { skinned, clips: gltf.animations.map((c) => ({ name: c.name, duration: c.duration })) },
    animation,
  );
  if (problem) throw new ViewerError("incompatible", problem);
  return { scene: gltf.scene, clip: gltf.animations.find((c) => c.name === animation.clip)! };
}
