import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@personalise-kings/config",
    "@personalise-kings/connector-contracts",
    "@personalise-kings/design-engine",
    "@personalise-kings/render-schema"
  ]
};

export default nextConfig;
