"use client";
// SPIKE ONLY (M1 S0) — throwaway.
import dynamic from "next/dynamic";

const Scene = dynamic(() => import("./Scene"), { ssr: false, loading: () => <p>Loading 3D…</p> });

export function SceneLoader(props: { time: number | null; view: "front" | "side" | "45" }) {
  return <Scene {...props} />;
}
