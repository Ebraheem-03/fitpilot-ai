import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED, serialise } from "../scripts/schemas";

const schemaDir = join(__dirname, "../../../data/exercise-catalog/_schema");

describe("generated schemas the API consumes", () => {
  it.each(Object.keys(GENERATED))(
    "%s is up to date (run `pnpm --filter @fitpilot/exercise-contracts export:jsonschema`)",
    (file) => {
      expect(readFileSync(join(schemaDir, file), "utf8")).toBe(serialise(GENERATED[file]));
    },
  );
});
