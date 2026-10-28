// Exports the zod contracts as JSON Schema so the Python API (pydantic) can validate the same shape.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED, serialise } from "./schemas";

const out = join(import.meta.dirname, "../../../data/exercise-catalog/_schema");
for (const [file, value] of Object.entries(GENERATED)) {
  writeFileSync(join(out, file), serialise(value));
}
console.log("wrote", Object.keys(GENERATED).join(", "), "to", out);
