import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env at the monorepo root serves web + API; Next only reads apps/web/.env* by default.
// forceReload: Next has already loaded (and cached) env for apps/web before reading this file.
loadEnvConfig(
  resolve(process.cwd(), "../.."),
  process.env.NODE_ENV !== "production",
  console,
  true,
);

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
