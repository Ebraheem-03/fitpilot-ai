// The generated artefacts the Python API consumes, as file name -> JSON. Written by
// export-jsonschema.ts; test/generated.test.ts fails when the committed files are stale.
import { z } from "zod";
import {
  CUE_RULES,
  ExerciseContract,
  SessionEvent,
  SessionEventBatch,
  SessionSummary,
} from "../src";

export const GENERATED: Record<string, unknown> = {
  "exercise.schema.json": z.toJSONSchema(ExerciseContract),
  "session-event.schema.json": z.toJSONSchema(SessionEvent),
  "session-event-batch.schema.json": z.toJSONSchema(SessionEventBatch),
  "session-summary.schema.json": z.toJSONSchema(SessionSummary),
  // rule_id -> { exercise_id, measurements }: the API rejects undeclared rules and keys with it
  "cue-rules.json": CUE_RULES,
};

export const serialise = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
