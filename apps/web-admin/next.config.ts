import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@personalise-kings/auth",
    "@personalise-kings/db",
    "@personalise-kings/render-schema",
    "@personalise-kings/storage",
    "@personalise-kings/observability"
  ]
};

export default nextConfig;
