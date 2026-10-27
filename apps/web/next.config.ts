import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env at the monorepo root serves web + API (ADR-0003). Next has already loaded and cached
// apps/web env before reading this file, hence forceReload. Real env vars still win over .env.
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
