import type { Metadata } from "next";
import { CaptureTool } from "@/features/live-coaching/capture/CaptureTool";

export const metadata: Metadata = { title: "Fixture capture · FitPilot dev" };

export default function CapturePage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Vision fixture capture (FR-05)</h1>
      <p className="max-w-3xl text-sm text-muted">
        Pick a squat recording from this computer. It is read into this tab only: nothing is
        uploaded, and only the derived <code>*.landmarks.json</code> / <code>*.labels.json</code>{" "}
        are saved, to <code>data/evaluation-fixtures/vision/bodyweight_squat/</code>. Keep the video
        on your disk; it never goes in git.
      </p>
      <CaptureTool />
    </>
  );
}
