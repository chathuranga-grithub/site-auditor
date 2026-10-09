// The visit results checklist: every step the test performed, marked pass / warn / fail.
// Pure function of the report, so the page and "Copy summary" show the same thing.

import { isInternal } from "./url";
import { EXPECTED_COUNTRY, OVERFLOW_PX, type Discovery, type MenuCheck, type MobileCheck, type VisitPage, type VisitReport } from "./visit-types";

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

  // 2. The proxy IP is in the right country (looked up through the proxy)
  const country = new Intl.DisplayNames(["en"], { type: "region" }).of(EXPECTED_COUNTRY) ?? EXPECTED_COUNTRY;
  if (!r.exit) {
    add("location", `Proxy IP is in ${country}`, r.proxy ? "fail" : "skip", r.proxy ? "Couldn't look up the proxy IP's location, so the test stopped" : notRun);
  } else {
    add(
      "location",
      `Proxy IP is in ${country}`,
      r.exit.countryCode === EXPECTED_COUNTRY ? "pass" : "fail",
      `${r.exit.country ?? "Unknown"}${r.exit.city ? `, ${r.exit.city}` : ""} · ${r.exit.ip}${r.exit.org ? ` · ${r.exit.org}` : ""}`,
    );
    add(
      "residential",
      "Proxy IP is residential",
      r.exit.network === "residential" ? "pass" : "warn",
      r.exit.network === "residential"
        ? `Home / mobile network${r.exit.org ? ` (${r.exit.org})` : ""}`
        : r.exit.network === "datacenter"
          ? `Datacenter network${r.exit.org ? ` (${r.exit.org})` : ""}: sites may treat it differently from real visitors`
          : `Couldn't tell from the network name${r.exit.org ? ` (${r.exit.org})` : ""}`,
    );
    if (r.exit.lookupMs != null)
      add(
        "proxy-speed",
        "Proxy speed",
        r.exit.lookupMs < 3000 ? "pass" : "warn",
        `Answered in ${seconds(r.exit.lookupMs)}${r.exit.lookupMs < 3000 ? "" : ": slow, so page load times in this test will be slower than for real visitors"}`,
      );
  }

  // 3-4. Start page
  if (!start) {
    add("start", "Start page opens", "skip", notRun);
    add("speed", "Start page speed", "skip", notRun);
  } else {
    add("start", "Start page opens", start.ok ? "pass" : "fail", start.ok ? `HTTP ${start.status} · ${start.title ?? start.finalUrl}` : (start.error ?? "Didn't load"));
    if (start.ok && start.stillLoading) add("speed", "Start page speed", "warn", "The page showed, but files were still loading after 30s (see the start page details)");
    else if (start.loadMs == null) add("speed", "Start page speed", start.ok ? "warn" : "skip", start.ok ? "Load time not available" : notRun);
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
    const stuck = loaded.filter((p) => p.stillLoading);
    const parts = [slow.length ? `${slow.length} page(s) took over ${SLOW_PAGE_MS / 1000}s` : "", stuck.length ? `${stuck.length} page(s) still loading files after 30s` : ""].filter(Boolean);
    add("slow", "Pages load fast", parts.length ? "warn" : "pass", parts.length ? parts.join(" · ") : `All under ${SLOW_PAGE_MS / 1000}s`);
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

  // Phones and menus. A campaign visit is on a phone or a desktop, without the separate phone check.
  const noPhoneCheck = r.device === "phone" ? "This visit was on a phone (pages opened on the phone itself)" : r.device ? "This visit was on a desktop" : "Phone check was turned off";
  if (!r.mobileChecked) add("phone", "Works on phones", "skip", noPhoneCheck);
  else {
    const checked = all.filter((p) => p.mobile);
    const bad = checked.filter((p) => mobileProblems(p.mobile!).length);
    add(
      "phone",
      "Works on phones",
      !checked.length ? "skip" : bad.length ? "fail" : "pass",
      !checked.length ? notRun : bad.length ? `${bad.length} of ${checked.length} page(s) have phone problems` : `All ${checked.length} page(s) open and fit the phone screen`,
    );
  }
  const menus = start?.menus;
  if (!r.mobileChecked) add("menu-phone", "Phone menu (☰) opens", "skip", noPhoneCheck);
  else if (!menus?.mobile) add("menu-phone", "Phone menu (☰) opens", "skip", notRun);
  else add("menu-phone", "Phone menu (☰) opens", ...phoneMenuStatus(menus.mobile));

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
  if (p.ok && p.stillLoading) out.push("Still loading files after 30s");
  if (p.scroll?.brokenImages.length) out.push(`${p.scroll.brokenImages.length} broken image(s)`);
  if (p.failedRequests.length) out.push(`${p.failedRequests.length} failed file(s)`);
  if (p.consoleErrors.length) out.push(`${p.consoleErrors.length} JS error(s)`);
  if (p.clickable === false) out.push("Link not clickable");
  if (p.ok && p.scroll && !p.scroll.reachedBottom) out.push("Couldn't scroll to the bottom");
  if (p.mobile) out.push(...mobileProblems(p.mobile));
  if (p.menus) {
    if (p.menus.mobile && phoneMenuStatus(p.menus.mobile)[0] !== "pass") out.push("Phone menu doesn't open");
  }
  return out;
}

function mobileProblems(m: MobileCheck): string[] {
  if (!m.ok) return [`Phone: ${m.error ?? "didn't load"}`];
  const out: string[] = [];
  if (m.overflowPx > OVERFLOW_PX) out.push(`Phone: scrolls sideways (+${m.overflowPx}px)`);
  if (!m.viewportTag) out.push("Phone: no viewport tag");
  if (m.brokenImages.length) out.push(`Phone: ${m.brokenImages.length} broken image(s)`);
  return out;
}

function phoneMenuStatus(m: NonNullable<MenuCheck["mobile"]>): [CheckStatus, string] {
  if (m.opened) return ["pass", `Opens and shows ${m.linksShown} link(s)`];
  return [m.buttonFound ? "fail" : "warn", m.note ?? "Didn't open"];
}

/**
 * Everything the test did on one page, in order, with its result. Shown in the page details,
 * as icons on the cards and list, and in Copy summary.
 */
export function pageActivities(p: VisitPage): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => items.push({ id, label, status, detail });
  const notRun = "Not run (the page didn't open)";

  add("open", "Opened", p.ok ? "pass" : "fail", p.ok ? `HTTP ${p.status}${p.loadMs != null ? ` · ${seconds(p.loadMs)}` : ""}` : (p.error ?? "Didn't load"));
  if (!p.ok) {
    for (const [id, label] of [
      ["loaded", "Fully loaded"],
      ["scroll", "Scrolled to the bottom"],
      ["images", "Images"],
    ])
      add(id, label, "skip", notRun);
  } else {
    add(
      "loaded",
      "Fully loaded",
      p.stillLoading ? "warn" : (p.loadMs ?? 0) > SLOW_PAGE_MS ? "warn" : "pass",
      p.stillLoading ? `Still loading ${p.stillLoading.length} file(s) after 30s` : (p.loadMs ?? 0) > SLOW_PAGE_MS ? `Slow: ${seconds(p.loadMs!)}` : "All files loaded",
    );
    const s = p.scroll;
    add("scroll", "Scrolled to the bottom", !s ? "skip" : s.reachedBottom ? "pass" : "warn", !s ? "Couldn't scroll" : s.reachedBottom ? `${s.steps} steps · ${s.pageHeight.toLocaleString()}px tall` : "Stopped partway (very long or endless page)");
    add(
      "images",
      "Images",
      !s ? "skip" : s.brokenImages.length ? "fail" : "pass",
      !s ? "Not checked" : s.images === 0 ? "No images" : s.brokenImages.length ? `${s.brokenImages.length} of ${s.images} broken` : `${s.imagesLoaded} of ${s.images} loaded`,
    );
  }
  add("js", "JavaScript", p.consoleErrors.length ? "warn" : "pass", p.consoleErrors.length ? `${p.consoleErrors.length} error(s)` : "No errors");
  add("files", "Files", p.failedRequests.length ? "fail" : "pass", p.failedRequests.length ? `${p.failedRequests.length} failed` : "None failed");
  if (p.clickable !== undefined) add("clickable", "Link on the start page clickable", p.clickable ? "pass" : "warn", p.clickable ? "A visitor can click it" : (p.note ?? "Not clickable"));

  // Phone (undefined = phone check turned off; null = not run because the page didn't open)
  if (p.mobile === null) add("phone-open", "Phone: opened", "skip", notRun);
  if (p.mobile) {
    const m = p.mobile;
    add("phone-open", "Phone: opened", m.ok ? "pass" : "fail", m.ok ? `HTTP ${m.status}` : (m.error ?? "Didn't load"));
    if (m.ok) {
      add("phone-fit", "Phone: fits the screen", m.overflowPx > OVERFLOW_PX ? "fail" : "pass", m.overflowPx > OVERFLOW_PX ? `Scrolls sideways (${m.overflowPx}px too wide)` : "No sideways scrolling");
      add("phone-viewport", "Phone: viewport tag", m.viewportTag ? "pass" : "warn", m.viewportTag ? "Set for phones" : "Missing: phones may show a tiny desktop page");
      add(
        "phone-images",
        "Phone: images",
        m.brokenImages.length ? "fail" : "pass",
        m.images === 0 ? "No images" : m.brokenImages.length ? `${m.brokenImages.length} of ${m.images} broken` : `All ${m.images} loaded`,
      );
    }
  }

  // Phone menu (start page only)
  if (p.menus?.mobile) add("menu-phone", "Phone menu (☰)", ...phoneMenuStatus(p.menus.mobile));
  return items;
}

function sum<T>(xs: T[], f: (x: T) => number) {
  return xs.reduce((n, x) => n + f(x), 0);
}

function seconds(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
