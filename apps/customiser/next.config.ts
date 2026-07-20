import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@personalise-kings/connector-contracts",
    "@personalise-kings/render-schema"
  ]
};

export default nextConfig;
