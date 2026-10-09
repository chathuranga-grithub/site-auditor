// Server-only: puppeteer-extra's stealth plugin, for both browser libraries (Puppeteer for ranking
// searches, Playwright through playwright-extra for visits). It hides the signs of an automated
// browser (navigator.webdriver, missing chrome.* objects, plugins, WebGL vendor…).

import StealthPlugin from "puppeteer-extra-plugin-stealth";

/**
 * Left out, as the app sets these itself: the user agent and its hints (device profiles:
 * src/lib/device-profiles.ts), the languages (Vietnamese, from Chrome's --lang and the Accept-Language),
 * and navigator.vendor (an iPhone's Safari says "Apple Computer, Inc.", not "Google Inc.").
 */
const LEFT_OUT = ["user-agent-override", "navigator.languages", "navigator.vendor"];

/** A new stealth plugin (one per browser library: a plugin instance can't be shared). */
export function stealthPlugin() {
  const plugin = StealthPlugin();
  for (const e of LEFT_OUT) plugin.enabledEvasions.delete(e);
  return plugin;
}

/**
 * Whether the stealth plugin is working in this tab: its WebGL evasion reports the graphics card as
 * "Intel Inc." / "Intel Iris OpenGL Engine" (real Chrome says e.g. "Google Inc. (Intel)").
 */
export async function stealthOn(tab: { evaluate<T>(fn: () => T): Promise<T> }): Promise<boolean> {
  return tab
    .evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return !!gl && !!info && gl.getParameter(info.UNMASKED_VENDOR_WEBGL) === "Intel Inc." && gl.getParameter(info.UNMASKED_RENDERER_WEBGL) === "Intel Iris OpenGL Engine";
    })
    .catch(() => false);
}
