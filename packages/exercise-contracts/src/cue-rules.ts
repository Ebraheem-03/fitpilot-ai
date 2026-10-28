/**
 * Every coaching rule that may produce a cue, with the measurement keys it is allowed to report
 * (FR-06 traceability, ADR-0011 §1). A `feedback_shown` event is only valid when its `rule_id` is
 * listed here, its `exercise_id` matches, and every measurement key is declared. That is what stops
 * a free-form measurements record from carrying landmark or per-frame data off the device.
 *
 * Adding a rule in `packages/exercise-rules` means adding it here; a test in that package fails
 * when a rule id in the analyzers is missing. `pnpm --filter @fitpilot/exercise-contracts
 * export:jsonschema` regenerates `data/exercise-catalog/_schema/cue-rules.json` for the API.
 */
export interface CueRuleDeclaration {
  exercise_id: string;
  measurements: readonly string[];
}

export const CUE_RULES: Readonly<Record<string, CueRuleDeclaration>> = {
  "squat.depth.shallow": {
    exercise_id: "bodyweight_squat",
    measurements: ["min_knee_angle_deg"],
  },
  "squat.torso.forward_lean": {
    exercise_id: "bodyweight_squat",
    measurements: ["trunk_lean_deg", "min_knee_angle_deg"],
  },
};

/** Why a cue's (rule, exercise, measurement keys) combination is not allowed; null when it is. */
export function cueRuleViolation(
  ruleId: string,
  exerciseId: string,
  measurementKeys: readonly string[],
): string | null {
  const rule = Object.hasOwn(CUE_RULES, ruleId) ? CUE_RULES[ruleId] : undefined;
  if (!rule) return `unknown rule_id "${ruleId}"`;
  if (rule.exercise_id !== exerciseId) {
    return `rule_id "${ruleId}" does not belong to exercise "${exerciseId}"`;
  }
  const undeclared = measurementKeys.filter((key) => !rule.measurements.includes(key));
  if (undeclared.length > 0) {
    return `measurements not declared by "${ruleId}": ${undeclared.join(", ")}`;
  }
  return null;
}
