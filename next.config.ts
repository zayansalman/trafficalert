import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The chat route reads these at request time via a runtime-built path, which file tracing
  // can't see — without this they're missing from the serverless bundle and every answer
  // becomes "no traffic data available".
  outputFileTracingIncludes: {
    "/api/chat": ["./data/traffic-alerts/**"],
  },
};

export default nextConfig;
