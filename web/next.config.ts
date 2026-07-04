import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js is a native module (loads a platform-specific .node binary).
  // It must not be bundled by Turbopack/webpack — keep it external so it's
  // required from node_modules at runtime, both in dev and on Vercel. Used by
  // the worksheet PDF route to rasterize figure SVGs.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
