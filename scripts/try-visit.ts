// Local test: one real campaign visit, exactly as a campaign runs it (saved proxy link, saved Chrome
// profile, Google search first, a random device), printing every step with the time.
// Run: npx tsx --env-file=.env.local scripts/try-visit.ts <campaignId> [phone|desktop] [dwellSec]

import { getCampaign } from "../src/lib/campaigns/db";
import { leaseChromeProfile } from "../src/lib/browser-profile";
import { resolveProxyApis } from "../src/lib/proxy-settings";
import { claimProxyIp } from "../src/lib/proxy-pool";
import { deviceLabel, pickDevice } from "../src/lib/device-profiles";
import { runVisitTest } from "../src/lib/visit-runner";
import type { VisitDevice } from "../src/lib/visit-types";

const [id = "", device = "phone", dwell = "60"] = process.argv.slice(2);
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

(async () => {
  const c = await getCampaign(Number(id));
  if (!c) throw new Error(`No campaign ${id}`);
  const [apiUrl] = await resolveProxyApis();
  if (!apiUrl) throw new Error("No proxy link saved");
  const profile = await leaseChromeProfile("visit");
  const model = pickDevice(device as VisitDevice);
  console.log(`${at()} campaign ${c.id}: ${c.siteUrl} · keyword "${c.keyword}" · ${deviceLabel(model)} · profile ${profile?.dir ?? "none"}`);
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  try {
    const report = await runVisitTest({
      url: c.siteUrl,
      proxyApiUrl: apiUrl,
      device: device as VisitDevice,
      deviceProfile: model,
      mobile: false,
      freshProxy: true,
      searchFirst: { keyword: c.keyword, country: c.country },
      claimIp: claimProxyIp,
      profileDir: profile?.dir,
      dwellSec: Number(dwell),
      readPages: true,
      signal: controller.signal,
      send: (e) => {
        if (e.type === "step") console.log(`${at()} ${e.message}`);
        else if (e.type === "page") console.log(`${at()} [page] ${e.page.kind} ${e.page.ok ? "OK" : "FAIL"} ${e.page.status ?? ""} ${e.page.finalUrl} ${e.page.error ?? ""}`);
        else if (e.type === "wait") console.log(`${at()} [wait] ${e.reason} ${e.seconds ?? ""}`);
      },
    });
    console.log(`${at()} DONE stopReason=${report.stopReason ?? "none"} start=${report.start?.finalUrl ?? "-"} pages=${report.pages.length} cancelled=${report.cancelled}`);
  } catch (err) {
    console.log(`${at()} THREW ${err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err)}`);
  } finally {
    profile?.release();
  }
  process.exit(0);
})();
