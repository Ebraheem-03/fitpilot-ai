// Exports the zod contracts as JSON Schema so the Python API (pydantic) can validate the same shape.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ExerciseContract, SessionEvent } from "../src";

const out = join(import.meta.dirname, "../../../data/exercise-catalog/_schema");
writeFileSync(
  join(out, "exercise.schema.json"),
  JSON.stringify(z.toJSONSchema(ExerciseContract), null, 2),
);
writeFileSync(
  join(out, "session-event.schema.json"),
  JSON.stringify(z.toJSONSchema(SessionEvent), null, 2),
);
console.log("wrote JSON Schemas to", out);
