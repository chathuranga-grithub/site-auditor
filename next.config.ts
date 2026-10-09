import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop app (desktop/, `npm run desktop:build`): a server that runs on its own, without
  // node_modules installed. Not for Vercel, which builds as usual.
  ...(process.env.DESKTOP_BUILD ? { output: "standalone" as const } : {}),
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
