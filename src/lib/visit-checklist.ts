// The Visit Test results checklist: every step the test performed, marked pass / warn / fail.
// Pure function of the report, so the page and "Copy summary" show the same thing.

import { isInternal } from "./url";
import { EXPECTED_COUNTRY, type Discovery, type VisitPage, type VisitReport } from "./visit-types";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface ChecklistItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

const SLOW_MS = 5000;
const SLOW_PAGE_MS = 8000;

export function buildChecklist(r: VisitReport): ChecklistItem[] {
  const start = r.start;
  const pages = r.pages;
  const all = [start, ...pages].filter((p): p is VisitPage => !!p);
  const items: ChecklistItem[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => items.push({ id, label, status, detail });
  const notRun = "Not run (an earlier step failed or the test was stopped)";

  // 1. Proxy
  add(
    "proxy",
    "Proxy received",
    r.proxy ? "pass" : "fail",
    r.proxy ? `${r.proxy.address}${r.proxy.reused ? " (previous proxy reused, provider not giving a new IP yet)" : ""}` : "The proxy API didn't return a proxy",
  );

  // 2-3. The visit really goes through the proxy, from the right country
  const country = new Intl.DisplayNames(["en"], { type: "region" }).of(EXPECTED_COUNTRY) ?? EXPECTED_COUNTRY;
  if (!r.exit) {
    add("proxy-used", "Proxy IP used (not this computer's)", r.proxy ? "fail" : "skip", r.proxy ? "Couldn't look up the visit's IP, so the test stopped" : notRun);
    add("location", `Visitor is in ${country}`, r.proxy ? "fail" : "skip", r.proxy ? "Couldn't look up the visit's country" : notRun);
  } else {
    const same = !!r.localIp && r.exit.ip === r.localIp;
    add(
      "proxy-used",
      "Proxy IP used (not this computer's)",
      same ? "fail" : r.localIp ? "pass" : "warn",
      same
        ? `The visit used this computer's own IP (${r.exit.ip})`
        : r.localIp
          ? `Visit IP ${r.exit.ip} · this computer's IP ${r.localIp}`
          : `Visit IP ${r.exit.ip} · couldn't look up this computer's IP to compare`,
    );
    add(
      "location",
      `Visitor is in ${country}`,
      r.exit.countryCode === EXPECTED_COUNTRY ? "pass" : "fail",
      `${r.exit.country ?? "Unknown"}${r.exit.city ? `, ${r.exit.city}` : ""} · ${r.exit.ip}${r.exit.org ? ` · ${r.exit.org}` : ""}`,
    );
  }

  // 3-4. Start page
  if (!start) {
    add("start", "Start page opens", "skip", notRun);
    add("speed", "Start page speed", "skip", notRun);
  } else {
    add("start", "Start page opens", start.ok ? "pass" : "fail", start.ok ? `HTTP ${start.status} · ${start.title ?? start.finalUrl}` : (start.error ?? "Didn't load"));
    if (start.loadMs == null) add("speed", "Start page speed", start.ok ? "warn" : "skip", start.ok ? "Load time not available" : notRun);
    else add("speed", "Start page speed", start.loadMs < SLOW_MS ? "pass" : "warn", `${seconds(start.loadMs)} to load (under ${SLOW_MS / 1000}s is good)`);
  }

  // 5-7. Finding and visiting every page
  const d = r.discovery;
  if (!d) add("found", "Internal pages found", "skip", notRun);
  else {
    const total = d.total + d.leftOut;
    add(
      "found",
      "Internal pages found",
      total === 0 || d.leftOut ? "warn" : "pass",
      `${total} page${total === 1 ? "" : "s"} (${discoverySources(d)})${d.leftOut ? ` · only the first ${d.total} are tested` : ""}`,
    );
  }
  if (!d || !d.total) add("visited", "Every page visited", "skip", !d ? notRun : "No other pages to visit");
  else
    add(
      "visited",
      "Every page visited",
      pages.length === d.total ? "pass" : r.stopReason ? "fail" : "warn",
      pages.length === d.total ? `All ${d.total} pages` : `${pages.length} of ${d.total} · ${r.stopReason ?? "the test was stopped"}`,
    );
  const okPages = pages.filter((p) => p.ok).length;
  add("pages", "Pages open", !pages.length ? "skip" : okPages === pages.length ? "pass" : "fail", !pages.length ? notRun : `${okPages} of ${pages.length} opened without errors`);

  // 8-10. Every page: speed, scrolling, images
  const loaded = all.filter((p) => p.ok);
  if (!loaded.length) {
    add("slow", "Pages load fast", "skip", notRun);
    add("scroll", "Scrolled to the bottom", "skip", notRun);
    add("images", "Images load", "skip", notRun);
  } else {
    const slow = loaded.filter((p) => (p.loadMs ?? 0) > SLOW_PAGE_MS);
    add("slow", "Pages load fast", slow.length ? "warn" : "pass", slow.length ? `${slow.length} page(s) took over ${SLOW_PAGE_MS / 1000}s` : `All under ${SLOW_PAGE_MS / 1000}s`);
    const scrolled = loaded.filter((p) => p.scroll);
    const bottom = scrolled.filter((p) => p.scroll!.reachedBottom).length;
    add("scroll", "Scrolled to the bottom", bottom === scrolled.length ? "pass" : "warn", `${bottom} of ${scrolled.length} page(s)${bottom < scrolled.length ? " · the rest are very long or endless" : ""}`);
    const imgs = sum(scrolled, (p) => p.scroll!.images);
    const broken = scrolled.filter((p) => p.scroll!.brokenImages.length);
    add(
      "images",
      "Images load",
      broken.length ? "fail" : "pass",
      imgs === 0 ? "No images on the pages" : broken.length ? `${sum(broken, (p) => p.scroll!.brokenImages.length)} broken on ${broken.length} page(s)` : `All ${imgs.toLocaleString()} loaded`,
    );
  }

  // 11. Start-page links a visitor can click
  const shown = pages.filter((p) => p.clickable !== undefined);
  const clickable = shown.filter((p) => p.clickable).length;
  add(
    "clickable",
    "Start-page links clickable",
    !shown.length ? "skip" : clickable === shown.length ? "pass" : "warn",
    !shown.length ? (start?.ok ? "No visible links on the start page" : notRun) : `${clickable} of ${shown.length} visible links${clickable < shown.length ? ` · ${shown.length - clickable} covered or not clickable` : ""}`,
  );

  // 12-14. Errors and staying on the site
  if (!all.length) {
    add("js", "No JavaScript errors", "skip", notRun);
    add("files", "No failed files", "skip", notRun);
    add("onsite", "Stayed on the site", "skip", notRun);
  } else {
    const js = all.filter((p) => p.consoleErrors.length);
    add("js", "No JavaScript errors", js.length ? "warn" : "pass", js.length ? `${sum(js, (p) => p.consoleErrors.length)} error(s) on ${js.length} page(s)` : `None on ${all.length} page(s)`);
    const files = all.filter((p) => p.failedRequests.length);
    add("files", "No failed files", files.length ? "fail" : "pass", files.length ? `${sum(files, (p) => p.failedRequests.length)} file(s) failed on ${files.length} page(s)` : `None on ${all.length} page(s)`);
    const host = start ? new URL(start.url).hostname : "";
    const offsite = all.filter((p) => host && !isInternal(p.finalUrl, host));
    add("onsite", "Stayed on the site", offsite.length ? "fail" : "pass", offsite.length ? `${offsite.length} page(s) redirected to another website` : "Every page stayed on the same site");
  }

  // Last: the proxy kept the same IP and country to the end
  if (!r.exitEnd || !r.exit) add("same-ip", "Same proxy IP to the end", "skip", r.exit && !r.stopReason && pages.length ? "Couldn't check the IP again at the end" : notRun);
  else {
    const moved = r.exitEnd.countryCode !== r.exit.countryCode;
    const changed = r.exitEnd.ip !== r.exit.ip;
    add(
      "same-ip",
      "Same proxy IP to the end",
      moved ? "fail" : changed ? "warn" : "pass",
      moved ? "Moved to " + r.exitEnd.country + " during the test" : changed ? "Changed to " + r.exitEnd.ip + ", still in " + r.exitEnd.country : r.exitEnd.ip + " for the whole test",
    );
  }

  return items;
}

export function checklistTotals(items: ChecklistItem[]) {
  const count = (s: CheckStatus) => items.filter((i) => i.status === s).length;
  return { pass: count("pass"), warn: count("warn"), fail: count("fail"), skip: count("skip"), total: items.length };
}

/** "Passed 10 of 12 · 2 warnings" */
export function checklistHeadline(items: ChecklistItem[]): string {
  const t = checklistTotals(items);
  const parts = [`Passed ${t.pass} of ${t.total}`];
  if (t.fail) parts.push(`${t.fail} failed`);
  if (t.warn) parts.push(`${t.warn} warning${t.warn === 1 ? "" : "s"}`);
  if (t.skip) parts.push(`${t.skip} not run`);
  return parts.join(" · ");
}

/** "180 in the sitemap, 4 more linked from the start page, 2 found on other pages" */
export function discoverySources(d: Discovery): string {
  const parts = [d.noSitemap ? "no sitemap" : `${d.sitemap} in the sitemap`];
  if (d.startPageOnly) parts.push(`${d.startPageOnly}${d.noSitemap ? "" : " more"} linked from the start page`);
  if (d.fromLinks) parts.push(`${d.fromLinks} found on other pages`);
  return parts.join(", ");
}

/** Short problem labels for one page, empty when the page is fine. */
export function pageProblems(p: VisitPage): string[] {
  const out: string[] = [];
  if (!p.ok) out.push(p.error ?? "Didn't load");
  if ((p.loadMs ?? 0) > SLOW_PAGE_MS) out.push(`Slow (${seconds(p.loadMs!)})`);
  if (p.scroll?.brokenImages.length) out.push(`${p.scroll.brokenImages.length} broken image(s)`);
  if (p.failedRequests.length) out.push(`${p.failedRequests.length} failed file(s)`);
  if (p.consoleErrors.length) out.push(`${p.consoleErrors.length} JS error(s)`);
  if (p.clickable === false) out.push("Link not clickable");
  if (p.ok && p.scroll && !p.scroll.reachedBottom) out.push("Couldn't scroll to the bottom");
  return out;
}

function sum<T>(xs: T[], f: (x: T) => number) {
  return xs.reduce((n, x) => n + f(x), 0);
}

function seconds(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
