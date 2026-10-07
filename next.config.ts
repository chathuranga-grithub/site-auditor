import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev-only Next.js badge away from the sidebar's user card.
  devIndicators: { position: "bottom-right" },
  redirects() {
    return [
      // Default tool. Keep in sync with the first entry in src/config/tools.ts.
      { source: "/", destination: "/audit", permanent: false },
    ];
  },
};

export default nextConfig;
