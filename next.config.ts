import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded by Node, not bundled: the stealth plugin requires its evasions by name at run time.
  serverExternalPackages: ["puppeteer-extra", "puppeteer-extra-plugin-stealth", "playwright-extra"],
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
