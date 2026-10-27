import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// One .env at the monorepo root serves web + API (ADR-0003). The web process takes only what
// it needs from it, so backend secrets (DATABASE_URL, GROQ_API_KEY, …) never enter Next.
// Real environment variables always win over the file.
const WEB_KEYS = /^(NEXT_PUBLIC_[A-Z0-9_]+|API_BASE_URL)$/;
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, "utf8")))) {
    if (WEB_KEYS.test(key) && process.env[key] === undefined) process.env[key] = value;
  }
}

const nextConfig: NextConfig = {
  // workspace TS packages are consumed as source
  transpilePackages: ["@fitpilot/exercise-contracts", "@fitpilot/exercise-rules"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
