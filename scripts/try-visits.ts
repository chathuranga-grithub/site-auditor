// Local test: N campaign visits at the same time, as a campaign runs them (one proxy link each, the
// saved Chrome profile, a random device), printing every step per lane with the time and checking
// each browser keeps one tab. Nothing is written to the database (visits aren't counted).
// Run: npx tsx --env-file=.env.local scripts/try-visits.ts <campaignId> [lanes=2] [search=1|0] [dwellSec=60]

import { chromium, type BrowserContext } from "playwright-core";
import { getCampaign } from "../src/lib/campaigns/db";
import { leaseChromeProfile } from "../src/lib/browser-profile";
import { claimProxyIp, leaseProxyApi } from "../src/lib/proxy-pool";
import { deviceLabel, pickDevice } from "../src/lib/device-profiles";
import type { VisitStage } from "../src/lib/visit-types";

const [id = "", lanesArg = "2", searchArg = "1", dwellArg = "60"] = process.argv.slice(2);
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const problems: string[] = [];

// Every browser the visits open: its open tabs are checked every 2s (one tab, plus a moment while one closes).
const contexts = new Set<BrowserContext>();
const launch = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (...args: Parameters<typeof launch>) => {
  const ctx = await launch(...args);
  // tsx adds __name() to functions sent to the page; the real app (Next) doesn't.
  await ctx.addInitScript("globalThis.__name = (f) => f");
  contexts.add(ctx);
  ctx.on("close", () => contexts.delete(ctx));
  return ctx;
};
const tabWatch = setInterval(() => {
  for (const ctx of contexts) {
    const urls = ctx.pages().map((p) => p.url());
    if (urls.length > 1) console.log(`${at()} [tabs] ${urls.length} open: ${urls.map((u) => u.slice(0, 60)).join(" | ")}`);
    if (urls.length > 2) problems.push(`${urls.length} tabs open at once: ${urls.join(" | ")}`);
  }
}, 2000);

(async () => {
  const { runVisitTest } = await import("../src/lib/visit-runner");
  const c = await getCampaign(Number(id));
  if (!c) throw new Error(`No campaign ${id}`);
  console.log(`${at()} campaign ${c.id}: ${c.siteUrl} · "${c.keyword}" · ${lanesArg} lanes · search ${searchArg === "1" ? "on" : "off"} · dwell ${dwellArg}s`);
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());

  const lane = async (n: number) => {
    const log = (m: string) => console.log(`${at()} [${n}] ${m}`);
    const stages: VisitStage[] = [];
    const lease = await leaseProxyApi(controller.signal, (s) => log(`waiting for a proxy link (${s ?? "busy"})`));
    const profile = await leaseChromeProfile("visit");
    const device = Math.random() < 0.5 ? "phone" : "desktop";
    const model = pickDevice(device);
    log(`proxy link #${lease.number} · ${deviceLabel(model)} · profile ${profile?.dir.split(/[\\/]/).slice(-2).join("/")}`);
    try {
      const report = await runVisitTest({
        url: c.siteUrl,
        proxyApiUrl: lease.apiUrl,
        device,
        deviceProfile: model,
        mobile: false,
        freshProxy: true,
        searchFirst: searchArg === "1" ? { keyword: c.keyword, country: c.country } : undefined,
        claimIp: claimProxyIp,
        profileDir: profile?.dir,
        dwellSec: Number(dwellArg),
        readPages: true,
        signal: controller.signal,
        send: (e) => {
          if (e.type === "step") log(e.message);
          else if (e.type === "stage") {
            stages.push(e.stage);
            log(`[stage] ${e.stage}`);
          } else if (e.type === "page") log(`[page] ${e.page.kind} ${e.page.ok ? "OK" : "FAIL"} ${e.page.status ?? ""} ${e.page.finalUrl.slice(0, 70)} ${e.page.readSec != null ? `read ${e.page.readSec}s` : ""} ${e.page.error ?? ""}`);
        },
      });
      const result = `exitEnd=${report.exitEnd ? `${report.exitEnd.ip} in ${report.exitEnd.lookupMs}ms` : "null"} stopReason=${report.stopReason ?? "none"} start=${report.start?.ok ? "OK" : "FAIL"} pages=${report.pages.length} stages=${stages.join(">")}`;
      log(`DONE ${result}`);
      return result;
    } catch (err) {
      const msg = `THREW ${err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err)} stages=${stages.join(">")}`;
      log(msg);
      return msg;
    } finally {
      profile?.release();
      lease.release();
    }
  };

  const results = await Promise.all(Array.from({ length: Number(lanesArg) }, (_, i) => lane(i + 1)));
  clearInterval(tabWatch);
  console.log(`${at()} ===== RESULTS =====`);
  results.forEach((r, i) => console.log(`lane ${i + 1}: ${r}`));
  console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].join("\n")}` : "no tab problems");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
