import type { Metadata } from "next";
import { PoseBench } from "@/features/live-coaching/bench/PoseBench";

export const metadata: Metadata = { title: "Pose benchmark · FitPilot dev" };

export default function PoseBenchPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Pose benchmark (ADR-0010)</h1>
      <p className="text-sm text-muted">
        Runs MediaPipe PoseLandmarker on this device. Frames stay in this tab.
      </p>
      <PoseBench />
    </>
  );
}
