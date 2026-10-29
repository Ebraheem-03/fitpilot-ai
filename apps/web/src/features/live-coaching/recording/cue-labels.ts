import type { TrackingDegradedReason } from "@fitpilot/exercise-contracts";
import { type CueRule, explainCue } from "@fitpilot/exercise-rules";

/**
 * Display text for cues and tracking spans (FR-06). Cue wording, explanations and measurement
 * labels come from the rule definitions in `@fitpilot/exercise-rules` (`explainCue`), never
 * from here: this file only formats numbers and names the tracking reasons.
 */
export type MeasurementUnit = CueRule["measurements"][string]["unit"];

export function formatMeasurement(value: number, unit: MeasurementUnit | undefined): string {
  switch (unit) {
    case "deg":
      return `${Math.round(value)}°`;
    case "ms":
      return `${Math.round(value)} ms`;
    case "ratio":
      return value.toFixed(2);
    default:
      return String(Math.round(value * 10) / 10);
  }
}

export interface MeasurementLine {
  key: string;
  label: string;
  value: string;
}

/**
 * The measurements behind a cue, labelled by its rule ("Smallest knee angle in the rep: 131°").
 * Keys the rule doesn't declare are left out: the cue's evidence is what its rule says it is.
 */
export function measurementLines(
  messageId: string,
  measurements: Readonly<Record<string, number>>,
): MeasurementLine[] {
  const rule = explainCue(messageId);
  if (!rule) return [];
  return Object.entries(rule.measurements)
    .filter(([key]) => typeof measurements[key] === "number")
    .map(([key, { label, unit }]) => ({
      key,
      label,
      value: formatMeasurement(measurements[key]!, unit),
    }));
}

export const DEGRADED_LABELS: Record<TrackingDegradedReason, string> = {
  no_person: "Nobody in view",
  out_of_frame: "Part of the body out of the picture",
  low_visibility: "Hip, knee or ankle not clearly visible",
  low_light: "Too dark to track",
  unsupported_view: "Not side-on to the camera",
  slow_device: "Device too slow, or the picture stopped updating",
};

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}
