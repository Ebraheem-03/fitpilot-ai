"use client";
// SPIKE ONLY (M1 S0) — throwaway.
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import type { Group } from "three";

function Avatar({ time }: { time: number | null }) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF("/exercises/bodyweight_squat/squat.glb");
  const { actions } = useAnimations(animations, group);
  useEffect(() => {
    const action = actions.squat;
    if (!action) return;
    action.play();
    if (time !== null) {
      action.paused = true;
      action.time = time;
    }
  }, [actions, time]);
  return <primitive ref={group} object={scene} />;
}

export default function Scene({ time, view }: { time: number | null; view: "front" | "side" | "45" }) {
  const cam = { front: [0, 1.1, 3.2], side: [3.2, 1.1, 0], "45": [2.3, 1.2, 2.3] }[view] as [number, number, number];
  return (
    <Canvas camera={{ position: cam, fov: 40 }} shadows data-testid="spike-canvas" gl={{ preserveDrawingBuffer: true }}>
      <color attach="background" args={["#f1f5f9"]} />
      <hemisphereLight args={["#ffffff", "#94a3b8", 1.2]} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} castShadow />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[1.5, 48]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <gridHelper args={[3, 12, "#94a3b8", "#94a3b8"]} position-y={0.001} />
      <Avatar time={time} />
      <OrbitControls target={[0, 0.9, 0]} />
    </Canvas>
  );
}
