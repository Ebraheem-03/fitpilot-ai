// The generated artefacts the Python API consumes, as file name -> JSON. Written by
// export-jsonschema.ts; test/generated.test.ts fails when the committed files are stale.
import { z } from "zod";
import {
  CUE_RULES,
  ExerciseContract,
  SessionEvent,
  SessionEventBatch,
  SessionSummary,
  TrainingPlan,
  TrainingPlanResource,
} from "../src";

export const GENERATED: Record<string, unknown> = {
  "exercise.schema.json": z.toJSONSchema(ExerciseContract),
  "session-event.schema.json": z.toJSONSchema(SessionEvent),
  "session-event-batch.schema.json": z.toJSONSchema(SessionEventBatch),
  "session-summary.schema.json": z.toJSONSchema(SessionSummary),
  // the LLM's output shape (FR-02) and the stored plan the API returns
  "training-plan.schema.json": z.toJSONSchema(TrainingPlan),
  "training-plan-resource.schema.json": z.toJSONSchema(TrainingPlanResource),
  // rule_id -> { exercise_id, measurements }: the API rejects undeclared rules and keys with it
  "cue-rules.json": CUE_RULES,
};

export const serialise = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
