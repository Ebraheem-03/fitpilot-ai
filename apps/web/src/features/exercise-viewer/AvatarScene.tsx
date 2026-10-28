"use client";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { AnimationMixer, Vector3 } from "three";
import type { ViewPreset } from "./labels";
import type { ExerciseModel } from "./model";
import type { PlaybackStore } from "./playback";

const VIEW_POSITIONS: Record<ViewPreset, [number, number, number]> = {
  front: [0, 1.15, 3.4],
  side: [3.4, 1.15, 0],
  three_quarter: [2.4, 1.3, 2.4],
};
const TARGET = new Vector3(0, 0.85, 0);
/** Longest step per frame, so a backgrounded tab doesn't jump to the end on return. */
const MAX_FRAME_S = 0.1;

export interface AvatarSceneProps {
  model: ExerciseModel;
  store: PlaybackStore;
  view: ViewPreset;
  /** false while scrolled off-screen: stop rendering entirely */
  active: boolean;
  onReady: () => void;
}

/** Drives the clip from the playback store: the store owns time, the mixer only samples it. */
function Mannequin({ model, store, onReady }: Omit<AvatarSceneProps, "view" | "active">) {
  const invalidate = useThree((s) => s.invalidate);
  const mixer = useMemo(() => {
    const m = new AnimationMixer(model.scene);
    m.clipAction(model.clip).play();
    return m;
  }, [model]);
  // Sample just inside the clip so the last frame doesn't wrap back to the first.
  const lastTime = model.clip.duration - 1e-4;

  useEffect(() => store.subscribe(invalidate), [store, invalidate]);
  useEffect(() => {
    onReady();
    invalidate();
  }, [onReady, invalidate]);
  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model.scene);
    },
    [mixer, model],
  );

  useFrame((_, delta) => {
    if (store.getState().status === "playing") {
      store.dispatch({ type: "tick", dt: Math.min(delta, MAX_FRAME_S) });
    }
    mixer.setTime(Math.min(store.getState().time, lastTime));
  });

  return <primitive object={model.scene} />;
}

function CameraRig({ view }: { view: ViewPreset }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    update(): void;
  } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    camera.position.set(...VIEW_POSITIONS[view]);
    if (controls) {
      controls.target.copy(TARGET);
      controls.update();
    } else {
      camera.lookAt(TARGET);
    }
    invalidate();
  }, [view, camera, controls, invalidate]);
  return null;
}

function AvatarScene({ model, store, view, active, onReady }: AvatarSceneProps) {
  const playing = useSyncExternalStore(
    store.subscribe,
    () => store.getState().status === "playing",
    () => false,
  );
  return (
    <Canvas
      frameloop={!active ? "never" : playing ? "always" : "demand"}
      shadows
      dpr={[1, 2]}
      camera={{ position: VIEW_POSITIONS[view], fov: 38 }}
      aria-hidden
    >
      <hemisphereLight args={["#ffffff", "#8a8f98", 1.3]} />
      <directionalLight
        position={[2.5, 4, 3]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[1.4, 64]} />
        <meshStandardMaterial color="#9ca3af" />
      </mesh>
      <Mannequin model={model} store={store} onReady={onReady} />
      <OrbitControls
        makeDefault
        target={TARGET}
        enablePan={false}
        minDistance={2}
        maxDistance={6}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />
      <CameraRig view={view} />
    </Canvas>
  );
}

export default memo(AvatarScene);
