// Local test: a visit's browser on a copy of the saved Chrome profile, opened, closed and opened again
// on the same copy (as after an unsolved CAPTCHA). Prints the extensions switched on each time.
// Run: npx tsx --env-file=.env.local scripts/try-extensions.ts

import { chromium } from "playwright-core";
import { EXTENSION_ARGS, KEEP_EXTENSIONS, PROFILE_ARGS, checkChromeProfile, leaseChromeProfile, profileExtensionDirs } from "../src/lib/browser-profile";

(async () => {
  const lease = await leaseChromeProfile("visit");
  if (!lease) throw new Error("No Chrome profile set in Settings");
  for (let n = 1; n <= 2; n++) {
    const context = await chromium.launchPersistentContext(lease.dir, { channel: "chrome", headless: false, ignoreDefaultArgs: KEEP_EXTENSIONS, args: [...PROFILE_ARGS, ...EXTENSION_ARGS] });
    await context.addInitScript("globalThis.__name = (f) => f"); // tsx adds __name() to functions sent to the page
    const session = await context.browser()!.newBrowserCDPSession();
    const send = session.send.bind(session) as (method: string, params: object) => Promise<unknown>;
    const dirs = await profileExtensionDirs(lease.dir);
    for (const d of dirs) await send("Extensions.loadUnpacked", { path: d }).catch((e: Error) => console.log("  load failed", d, e.message));
    console.log(`browser ${n}: ${dirs.length} to load → ${await checkChromeProfile(await context.newPage(), lease.dir)}`);
    await context.close();
  }
  lease.release();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
