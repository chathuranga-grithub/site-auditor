// Server-only: puppeteer-extra's stealth plugin, for both browser libraries (Puppeteer for ranking
// searches, Playwright through playwright-extra for visits). It hides the signs of an automated
// browser (navigator.webdriver, missing chrome.* objects, plugins, WebGL vendor…).

import StealthPlugin from "puppeteer-extra-plugin-stealth";

/**
 * Left out, as the app sets these itself: the user agent and its hints (device profiles:
 * src/lib/device-profiles.ts), the languages (Vietnamese, from Chrome's --lang and the Accept-Language),
 * navigator.vendor (an iPhone's Safari says "Apple Computer, Inc.", not "Google Inc."), and the
 * graphics chip: the plugin makes every browser an "Intel Iris" (a Mac's), which a phone or a Windows
 * PC can't have; each device reports its own instead (a Windows PC: this computer's real one).
 */
const LEFT_OUT = ["user-agent-override", "navigator.languages", "navigator.vendor", "webgl.vendor"];

/** A new stealth plugin (one per browser library: a plugin instance can't be shared). */
export function stealthPlugin() {
  const plugin = StealthPlugin();
  for (const e of LEFT_OUT) plugin.enabledEvasions.delete(e);
  return plugin;
}

/**
 * Whether the stealth plugin is working in this tab: a browser run by the app says it's automated
 * (navigator.webdriver), and the plugin hides that.
 */
export async function stealthOn(tab: { evaluate<T>(fn: () => T): Promise<T> }): Promise<boolean> {
  return tab.evaluate(() => !navigator.webdriver).catch(() => false);
}
