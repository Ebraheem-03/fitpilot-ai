import type { CueRule } from "./core/types";
import { SQUAT_RULES } from "./exercises/squat";

/**
 * Every feedback rule an analyzer can emit, by exercise (M4 adds curl and push-up). The web app
 * and the API's `feedback_shown` validation can both read this; nothing outside it may emit a cue.
 */
export const RULES_BY_EXERCISE: Readonly<Record<string, readonly CueRule[]>> = {
  bodyweight_squat: SQUAT_RULES,
};

/**
 * All rule definitions, flattened. Not the same thing as the contract's `CUE_RULES`
 * (`@fitpilot/exercise-contracts`), which declares only rule → exercise + measurement keys for
 * event validation; a test keeps the two in step.
 */
export const CUE_RULE_DEFINITIONS: readonly CueRule[] = Object.values(RULES_BY_EXERCISE).flat();

const BY_MESSAGE = new Map(CUE_RULE_DEFINITIONS.map((r) => [r.message_id, r]));

/**
 * "What this cue means" (FR-06) for a cue's `message_id`: the cue text, its plain-language
 * explanation and labels for its measurements. Undefined for an unknown id: show nothing rather
 * than make an explanation up.
 */
export function explainCue(messageId: string): CueRule | undefined {
  return BY_MESSAGE.get(messageId);
}
