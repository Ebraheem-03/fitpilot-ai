import type { PlaybackState, ViewerFailure } from "./playback";

export type ViewPreset = "front" | "side" | "three_quarter";

export const VIEW_LABELS: Record<ViewPreset, string> = {
  front: "Front",
  side: "Side",
  three_quarter: "45°",
};

/** "descending" → "Descending", "front_rack" → "Front rack" */
export const phaseLabel = (phase: string) =>
  phase.charAt(0).toUpperCase() + phase.slice(1).replaceAll("_", " ");

export const FAILURE_MESSAGES: Record<ViewerFailure, string> = {
  missing: "The 3D demonstration couldn't be loaded.",
  corrupt: "The 3D demonstration file is damaged.",
  incompatible: "The 3D demonstration doesn't match this exercise yet.",
  webgl: "Your browser or device can't show 3D graphics.",
  render: "The 3D demonstration stopped unexpectedly.",
};

/** Text for the polite live region: announced on state changes, not on every frame. */
export function announcement(state: PlaybackState, phase: string): string {
  switch (state.status) {
    case "loading":
      return "";
    case "ready":
      return "Demonstration ready.";
    case "playing":
      return "Playing.";
    case "paused":
      return `Paused at the ${phaseLabel(phase).toLowerCase()} phase.`;
    case "ended":
      return "Demonstration finished.";
    case "error":
      return `${FAILURE_MESSAGES[state.reason]} Follow the written steps instead.`;
  }
}
