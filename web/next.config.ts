import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Local dev (`next dev` / `next start` from web/) reads the repo-root .env —
// the same file docker compose uses. Existing env vars are never overridden,
// and in the Docker image compose injects everything, so this is a no-op there.
config({ path: resolve(process.cwd(), "../.env"), quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
