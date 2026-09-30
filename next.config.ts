import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects() {
    return [
      // Default tool. Keep in sync with the first entry in src/config/tools.ts.
      { source: "/", destination: "/audit", permanent: false },
    ];
  },
};

export default nextConfig;
