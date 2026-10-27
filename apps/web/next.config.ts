import type { NextConfig } from "next";

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
