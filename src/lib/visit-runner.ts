// Server-only, local only: one real-browser visit to a company site through a proxy.
// Opens the page, scrolls to the bottom, then clicks up to N internal links (never
// external links or ads) and checks each page loads cleanly. One visit per run: this is a
// QA check that the site works for a visitor in that location, not a traffic tool.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { getProxyOrReuse } from "./proxy-api";
import { isInternal, normalizeUrl, shouldSkipCrawl } from "./url";
import type { ExitInfo, ScrollResult, VisitEvent, VisitPage, VisitReport } from "./visit-types";

const NAV_TIMEOUT = 45_000;
/** Links that change state or need a login: never clicked. */
const RISKY_LINK = /(log-?out|sign-?out|wp-admin|wp-login|\/login|\/cart|\/checkout|add-to-cart|\/my-account|[?&]action=|\/feed\b|\/wp-json)/i;

export interface VisitOptions {
  url: string;
  proxyApiUrl: string;
  maxPages: number;
  signal: AbortSignal;
  send: (e: VisitEvent) => void;
}

export async function runVisitTest({ url, proxyApiUrl, maxPages, signal, send }: VisitOptions): Promise<VisitReport> {
  const report: VisitReport = {
    url,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    proxy: null,
    exit: null,
    start: null,
    scroll: null,
    pages: [],
    linksFound: 0,
    issues: [],
    cancelled: false,
  };
  const stopped = () => {
    if (signal.aborted) report.cancelled = true;
    return signal.aborted;
  };

  // 1. Proxy
  send({ type: "step", message: "Getting a proxy from the proxy API…" });
  const proxy = await getProxyOrReuse(proxyApiUrl);
  const { server, username, password, ...publicProxy } = proxy;
  report.proxy = publicProxy;
  if (proxy.reused) {
    send({ type: "step", message: `The provider isn't giving a new IP yet, so the previous proxy (${proxy.address}) is reused.` });
  }

  let browser: Browser | null = null;
  try {
    send({ type: "step", message: `Opening a browser through proxy ${proxy.address}…` });
    browser = await launchBrowser({ server, username, password });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      ignoreHTTPSErrors: false,
    });
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
    const onAbort = () => browser?.close().catch(() => {});
    signal.addEventListener("abort", onAbort, { once: true });

    // 2. Where does the visit really come from?
    send({ type: "step", message: "Checking where the visit comes from (IP and country)…" });
    report.exit = await exitLocation(context);
    send({ type: "proxy", proxy: publicProxy, exit: report.exit });
    if (stopped()) return finish(report);

    // 3. Start page
    send({ type: "step", message: `Opening ${url}…` });
    const page = await context.newPage();
    const start = await visit(page, url, "start", () => page.goto(url, { waitUntil: "load" }));
    report.start = start;
    send({ type: "page", page: start });
    if (!start.ok || stopped()) return finish(report);

    // 4. Scroll
    send({ type: "step", message: "Scrolling down the page…" });
    report.scroll = await scrollPage(page);
    send({ type: "scroll", scroll: report.scroll });
    if (stopped()) return finish(report);

    // 5. Internal links
    const siteHost = new URL(start.finalUrl).hostname;
    const targets = await pickInternalLinks(page, start.finalUrl, siteHost, maxPages);
    report.linksFound = targets.found;
    send({ type: "step", message: `Found ${targets.found} internal links. Visiting ${targets.picked.length}…` });

    for (const [i, link] of targets.picked.entries()) {
      if (stopped()) break;
      send({ type: "step", message: `Page ${i + 1} of ${targets.picked.length}: ${link.href}` });
      if (normalizeUrl(page.url()) !== normalizeUrl(start.finalUrl)) {
        await page.goto(start.finalUrl, { waitUntil: "load" }).catch(() => {});
      }
      const result = await clickInternalLink(page, link, start.finalUrl);
      report.pages.push(result);
      send({ type: "page", page: result });
    }
    signal.removeEventListener("abort", onAbort);
  } catch (err) {
    if (!stopped()) throw err;
  } finally {
    await browser?.close().catch(() => {});
  }
  return finish(report);
}

/**
 * The browser's own background services (updates, telemetry, SmartScreen, Bing). Kept off
 * the proxy and blocked, so the proxy carries only the test. Sites never need these hosts.
 */
const BROWSER_BACKGROUND_HOSTS = [
  "edge.microsoft.com",
  "www.bing.com",
  "*.smartscreen.microsoft.com",
  "*.events.data.microsoft.com",
  "*.delivery.mp.microsoft.com",
  "config.edge.skype.com",
  "update.googleapis.com",
  "android.clients.google.com",
  "accounts.google.com",
];

async function launchBrowser(proxy: { server: string; username?: string; password?: string }): Promise<Browser> {
  // Uses a browser already installed on this computer: Microsoft Edge, else Google Chrome.
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({
        channel,
        headless: true,
        proxy: { ...proxy, bypass: BROWSER_BACKGROUND_HOSTS.join(",") },
        args: [`--host-resolver-rules=${BROWSER_BACKGROUND_HOSTS.map((h) => `MAP ${h} ~NOTFOUND`).join(", ")}`],
      });
    } catch {
      /* try the next one */
    }
  }
  throw new Error("No browser found. Install Microsoft Edge or Google Chrome on this computer.");
}

async function exitLocation(context: BrowserContext): Promise<ExitInfo | null> {
  const page = await context.newPage();
  try {
    const res = await page.goto("https://ipinfo.io/json", { timeout: 20_000 });
    const j = (await res?.json()) as Record<string, string> | undefined;
    if (!j?.ip) return null;
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return {
      ip: j.ip,
      countryCode: j.country ?? null,
      country: j.country ? (names.of(j.country) ?? j.country) : null,
      city: j.city ?? null,
      org: j.org ?? null,
    };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Runs one navigation and records status, timing, errors and a screenshot. */
async function visit(
  page: Page,
  url: string,
  kind: VisitPage["kind"],
  navigate: () => Promise<{ status(): number } | null>,
): Promise<VisitPage> {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const siteHost = new URL(url).hostname;
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error" && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300));
  };
  const onPageError = (e: Error) => consoleErrors.length < 20 && consoleErrors.push(e.message.slice(0, 300));
  const onResponse = (r: { url(): string; status(): number }) => {
    if (r.status() >= 400 && isInternal(r.url(), siteHost) && failedRequests.length < 30) failedRequests.push(`${r.status()} ${r.url()}`);
  };
  const onFailed = (r: { url(): string; failure(): { errorText: string } | null }) => {
    const why = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(why) && isInternal(r.url(), siteHost) && failedRequests.length < 30) failedRequests.push(`${why} ${r.url()}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);

  const result: VisitPage = { kind, url, finalUrl: url, status: null, title: null, loadMs: null, ttfbMs: null, ok: false, consoleErrors, failedRequests };
  try {
    const res = await navigate();
    await page.waitForLoadState("load", { timeout: NAV_TIMEOUT }).catch(() => {});
    result.status = res?.status() ?? null;
    result.finalUrl = page.url();
    result.title = (await page.title().catch(() => "")) || null;
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return n ? { load: n.loadEventEnd || n.duration, ttfb: n.responseStart } : null;
    });
    result.loadMs = t ? Math.round(t.load) : null;
    result.ttfbMs = t ? Math.round(t.ttfb) : null;
    result.ok = result.status !== null && result.status < 400;
    if (!result.ok) result.error = `The page returned HTTP ${result.status ?? "no response"}.`;
    await page.waitForTimeout(600); // let late content paint before the screenshot
    result.screenshot = `data:image/jpeg;base64,${(await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64")}`;
  } catch (err) {
    result.error = friendly(err);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  }
  return result;
}

async function scrollPage(page: Page): Promise<ScrollResult> {
  let steps = 0;
  let reachedBottom = false;
  for (; steps < 40; steps++) {
    reachedBottom = await page.evaluate(() => {
      window.scrollBy(0, Math.round(window.innerHeight * 0.85));
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    });
    await page.waitForTimeout(350);
    if (reachedBottom) break;
  }
  await page.waitForTimeout(800); // let lazy images finish
  const img = await page.evaluate(() => {
    const all = [...document.images].filter((i) => i.currentSrc || i.src);
    const broken = all.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
    return { total: all.length, loaded: all.filter((i) => i.complete && i.naturalWidth > 0).length, broken: broken.slice(0, 20), height: document.documentElement.scrollHeight };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  return { steps: steps + 1, pageHeight: img.height, reachedBottom, images: img.total, imagesLoaded: img.loaded, brokenImages: img.broken };
}

interface LinkTarget {
  href: string;
  text: string;
}

async function pickInternalLinks(page: Page, pageUrl: string, siteHost: string, max: number) {
  const raw = await page.$$eval("a[href]", (as) =>
    as.map((a) => {
      const el = a as HTMLAnchorElement;
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return { href: el.href, text: (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ").slice(0, 80), visible, target: el.target };
    }),
  );
  const self = normalizeUrl(pageUrl);
  const seen = new Set<string>();
  const candidates: (LinkTarget & { visible: boolean })[] = [];
  for (const l of raw) {
    if (!/^https?:/i.test(l.href) || !isInternal(l.href, siteHost) || shouldSkipCrawl(l.href) || RISKY_LINK.test(l.href)) continue;
    const key = normalizeUrl(l.href);
    if (!key || key === self || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ href: l.href, text: l.text, visible: l.visible });
  }
  // Prefer links a visitor can actually see and click.
  const ordered = [...candidates.filter((c) => c.visible), ...candidates.filter((c) => !c.visible)];
  return { found: candidates.length, picked: ordered.slice(0, max).map(({ href, text }) => ({ href, text })) };
}

/** Click the link like a visitor; if it can't be clicked (hidden, covered), open it directly and say so. */
async function clickInternalLink(page: Page, link: LinkTarget, startUrl: string): Promise<VisitPage> {
  const index = await page.$$eval(
    "a[href]",
    (as, href) => as.findIndex((a) => (a as HTMLAnchorElement).href === href && !!((a as HTMLElement).offsetWidth || (a as HTMLElement).offsetHeight)),
    link.href,
  );

  let how: VisitPage["how"] = "clicked";
  let note: string | undefined;
  const result = await visit(page, link.href, "internal", async () => {
    if (index >= 0) {
      const anchor = page.locator("a[href]").nth(index);
      try {
        await anchor.evaluate((a) => a.removeAttribute("target")); // stay in this tab
        await anchor.scrollIntoViewIfNeeded({ timeout: 5_000 });
        const [response] = await Promise.all([
          page.waitForNavigation({ waitUntil: "load" }).catch(() => null),
          anchor.click({ timeout: 8_000 }),
        ]);
        if (normalizeUrl(page.url()) !== normalizeUrl(startUrl)) return response;
        note = "Clicking the link didn't open a new page (it may open a menu or popup), so it was opened directly.";
      } catch (err) {
        note = `The link couldn't be clicked (${/intercept|cover/i.test(String(err)) ? "something on the page covers it" : "not clickable"}), so it was opened directly.`;
      }
    } else {
      note = "The link isn't visible on the page, so it was opened directly.";
    }
    how = "opened directly";
    return page.goto(link.href, { waitUntil: "load" });
  });
  result.how = how;
  result.linkText = link.text || undefined;
  if (note) result.note = note;
  return result;
}

function finish(report: VisitReport): VisitReport {
  report.finishedAt = new Date().toISOString();
  report.issues = findIssues(report);
  return report;
}

function findIssues(r: VisitReport): string[] {
  const issues: string[] = [];
  if (r.exit && r.exit.countryCode !== "VN") issues.push(`The visit came from ${r.exit.country ?? r.exit.ip}, not Vietnam. Check the proxy.`);
  if (!r.exit) issues.push("Couldn't confirm the visit's location (IP lookup failed).");
  const all = [r.start, ...r.pages].filter((p): p is VisitPage => !!p);
  for (const p of all) {
    const name = p.kind === "start" ? "Start page" : (p.title ?? p.url);
    if (!p.ok) issues.push(`${name}: ${p.error ?? "didn't load"}`);
    if (p.loadMs && p.loadMs > 8000) issues.push(`${name}: slow (${(p.loadMs / 1000).toFixed(1)}s to load)`);
    if (p.consoleErrors.length) issues.push(`${name}: ${p.consoleErrors.length} JavaScript error(s)`);
    if (p.failedRequests.length) issues.push(`${name}: ${p.failedRequests.length} file(s) failed to load`);
    if (p.how === "opened directly" && p.note) issues.push(`${name}: ${p.note}`);
  }
  if (r.scroll?.brokenImages.length) issues.push(`Start page: ${r.scroll.brokenImages.length} image(s) didn't load`);
  if (r.scroll && !r.scroll.reachedBottom) issues.push("Start page: couldn't scroll to the bottom (very long or endless page)");
  return issues;
}

function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/ERR_PROXY|ERR_TUNNEL|proxy/i.test(m)) return "The proxy refused or dropped the connection.";
  if (/Timeout|timed out/i.test(m)) return "The page took too long to load.";
  if (/ERR_NAME_NOT_RESOLVED/.test(m)) return "The domain couldn't be found.";
  if (/ERR_CONNECTION/.test(m)) return "Couldn't connect to the site.";
  return m.split("\n")[0].slice(0, 200);
}
