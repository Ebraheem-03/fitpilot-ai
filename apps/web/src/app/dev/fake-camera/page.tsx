import type { Metadata } from "next";
import { FakeCameraPage } from "@/features/live-coaching/bench/FakeCameraPage";

export const metadata: Metadata = { title: "Fake camera feed · FitPilot dev" };

export default function Page() {
  return (
    <>
      <h1 className="text-xl font-semibold">Synthetic camera feed for e2e (ADR-0010 §8)</h1>
      <FakeCameraPage />
    </>
  );
}
