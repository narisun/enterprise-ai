import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["react-markdown", "remark-gfm"],
  /* force rebuild */
};

export default nextConfig;
