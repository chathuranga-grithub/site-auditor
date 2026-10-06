// Server-only, local only: a real-browser visit to every page of a company site through a
// proxy. Opens the start page, finds all internal pages (sitemap + start-page links, never
// external links or ads), then opens each page once, scrolls it and checks it loads cleanly.
// This is a QA check that the site works for a visitor in that location, not a traffic tool.

import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright-core";
import { getProxyOrReuse } from "./proxy-api";
import { readSitemap, type SitemapFetcher } from "./sitemap";
import { isBlockedHost, isInternal, normalizeUrl, shouldSkipCrawl } from "./url";
import {
  EXPECTED_COUNTRY,
  MAX_PAGES,
  OVERFLOW_PX,
  type Discovery,
  type ExitInfo,
  type MenuCheck,
  type MobileCheck,
  type ScrollResult,
  type VisitEvent,
  type VisitPage,
  type VisitReport,
} from "./visit-types";

/** How long a page may take to show its content (through the proxy) before it counts as not loading. */
const NAV_TIMEOUT = 45_000;
/** After the content shows, how long to wait for every file to finish before calling it "still loading". */
const LOAD_WAIT = 30_000;
/** Pages open at the same time. Kept low so a small site and the proxy aren't overloaded. */
const CONCURRENCY = 3;
/** This many proxy failures in a row means the proxy has expired or died: stop the run. */
const PROXY_FAILURES_TO_STOP = 5;
const SLOW_MS = 8000;
/** Links that change state or need a login: never opened. */
const RISKY_LINK = /(log-?out|sign-?out|wp-admin|wp-login|\/login|\/cart|\/checkout|add-to-cart|\/my-account|[?&]action=|\/feed\b|\/wp-json)/i;

const START_SCROLL = { stepWaitMs: 350, maxSteps: 40, settleMs: 800 };
const PAGE_SCROLL = { stepWaitMs: 200, maxSteps: 30, settleMs: 500 };
const MOBILE_SCROLL = { stepWaitMs: 150, maxSteps: 25, settleMs: 300 };
/** Phone check: how long to wait for the full load (the desktop check already reported slow files). */
const MOBILE_LOAD_WAIT = 15_000;
/** An Android phone (most visitors in Vietnam), at 1x pixels so screenshots stay small; the layout is the same. */
const PHONE = { ...devices["Pixel 7"], deviceScaleFactor: 1 };
/** Width of phone screenshots shown in the results. */
const PHONE_THUMB_WIDTH = 200;

export interface VisitOptions {
  url: string;
  proxyApiUrl: string;
  /** Also open every page on a phone-sized screen, and test the phone menu. */
  mobile: boolean;
  /** Take screenshots. Off: the same checks, but faster and much lighter on memory. */
  screenshots: boolean;
  signal: AbortSignal;
  send: (e: VisitEvent) => void;
}

interface Target {
  href: string;
  foundIn: "start page" | "sitemap" | "another page";
  linkText?: string;
  clickable?: boolean;
  note?: string;
}

export async function runVisitTest({ url, proxyApiUrl, mobile, screenshots, signal, send }: VisitOptions): Promise<VisitReport> {
  const report: VisitReport = {
    url,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    proxy: null,
    exit: null,
    localIp: null,
    exitEnd: null,
    start: null,
    scroll: null,
    pages: [],
    discovery: null,
    stopReason: null,
    issues: [],
    cancelled: false,
    mobileChecked: mobile,
    screenshots,
  };
  const stopped = () => {
    if (signal.aborted) report.cancelled = true;
    return signal.aborted;
  };

  // This computer's own IP (no proxy), to prove the test really goes through the proxy.
  const localIp = publicIpDirect();

  // 1. Proxy
  send({ type: "step", message: "Getting a proxy from the proxy API…" });
  const proxy = await getProxyOrReuse(proxyApiUrl);
  const { server, username, password, ...publicProxy } = proxy;
  report.proxy = publicProxy;
  if (proxy.reused) {
    send({ type: "step", message: `The provider isn't giving a new IP yet, so the previous proxy (${proxy.address}) is reused.` });
  }

  let browser: Browser | null = null;
  const onAbort = () => browser?.close().catch(() => {});
  try {
    send({ type: "step", message: `Opening a browser through proxy ${proxy.address}…` });
    browser = await launchBrowser({ server, username, password });
    signal.addEventListener("abort", onAbort, { once: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      ignoreHTTPSErrors: false,
    });
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
    const phone = mobile ? await browser.newContext({ ...PHONE, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" }) : null;
    phone?.setDefaultNavigationTimeout(NAV_TIMEOUT);

    // 2. Where does the visit really come from? Checked inside the proxied browser and compared
    // with this computer's own IP. Wrong or unknown location: stop before opening any page.
    send({ type: "step", message: "Checking the visit really comes from the proxy (IP and country)…" });
    report.exit = await exitLocation(context);
    report.localIp = await localIp;
    send({ type: "proxy", proxy: publicProxy, exit: report.exit, localIp: report.localIp });
    if (stopped()) return finish(report);
    report.stopReason = exitProblem(report.exit, report.localIp);
    if (report.stopReason) return finish(report);
    const exit = report.exit!;
    send({
      type: "step",
      message: `Confirmed: visiting from ${exit.country}${exit.city ? `, ${exit.city}` : ""} (IP ${exit.ip}${report.localIp ? `, not this computer's ${report.localIp}` : ""}).`,
    });
    // The sitemap is read through the proxy too, so every request to the site comes from there.
    const sitemap = readSitemap(new URL(url).origin, proxiedFetcher(context)).catch(() => null);

    // 3. Start page: open, scroll, screenshot
    send({ type: "step", message: `Opening ${url}…` });
    const page = await context.newPage();
    const start = await checkPage(page, url, "start", () => page.goto(url, { waitUntil: "domcontentloaded" }), START_SCROLL, screenshots ? "full" : null);
    report.start = start;
    report.scroll = start.scroll ?? null;
    send({ type: "page", page: start });
    if (report.scroll) send({ type: "scroll", scroll: report.scroll });
    if (!start.ok || stopped()) return finish(report);

    // 4. Find every internal page
    send({ type: "step", message: "Finding all internal pages (sitemap and start-page links)…" });
    const siteHost = new URL(start.finalUrl).hostname;
    const links = await startPageLinks(page, start.finalUrl, siteHost);
    const shrink = screenshots ? await makeThumbnailer(context) : null;

    await page.close().catch(() => {});

    // The start page on a phone, and the phone menu (once: the same menu is on every page)
    if (phone) {
      send({ type: "step", message: "Checking the start page on a phone and its menu button (☰)…" });
      const menus: MenuCheck = { mobile: null };
      const ptab = await phone.newPage();
      start.mobile = await checkMobile(ptab, start.finalUrl, shrink);
      menus.mobile = start.mobile.ok
        ? await mobileMenu(ptab, shrink).catch(() => ({ buttonFound: false, opened: false, linksShown: 0, note: "The menu check failed." }))
        : null;
      await ptab.close().catch(() => {});
      start.menus = menus;
      send({ type: "page", page: start });
    }
    const { targets, discovery } = combineTargets(links, (await sitemap)?.urls ?? null, start, siteHost);
    report.discovery = discovery;
    send({ type: "discovered", discovery });
    if (stopped()) return finish(report);

    // 5. Visit every page, a few at a time. Internal links found on each page are added to the
    // queue, so pages missing from the sitemap (or sites with no sitemap) are still covered.
    const seen = new Set(targets.map((t) => normalizeUrl(t.href)!));
    seen.add(normalizeUrl(start.url)!);
    seen.add(normalizeUrl(start.finalUrl)!);
    const addFound = (hrefs: string[]) => {
      let added = false;
      for (const href of hrefs) {
        const key = normalizeUrl(href);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (targets.length < MAX_PAGES) {
          targets.push({ href, foundIn: "another page" });
          discovery.fromLinks++;
          discovery.total++;
        } else discovery.leftOut++;
        added = true;
      }
      if (added) send({ type: "discovered", discovery: { ...discovery } });
    };

    let next = 0;
    let active = 0;
    let proxyFailures = 0;
    const worker = async () => {
      let tab = await context.newPage();
      let ptab = phone ? await phone.newPage() : null;
      while (!stopped() && !report.stopReason) {
        if (next >= targets.length) {
          if (active === 0) break;
          await new Promise((r) => setTimeout(r, 200)); // another tab may still find new pages
          continue;
        }
        const t = targets[next++];
        active++;
        if (tab.isClosed()) tab = await context.newPage();
        const referer = t.foundIn === "start page" ? start.finalUrl : undefined;
        const result = await checkPage(tab, t.href, "internal", () => tab.goto(t.href, { waitUntil: "domcontentloaded", referer }), PAGE_SCROLL, shrink);
        if (result.ok && isInternal(result.finalUrl, siteHost)) addFound(await pageLinks(tab, siteHost).catch(() => []));
        if (phone && result.ok && !stopped()) {
          if (!ptab || ptab.isClosed()) ptab = await phone.newPage();
          result.mobile = await checkMobile(ptab, result.finalUrl, shrink);
        } else if (phone) result.mobile = null; // didn't open on desktop, so not tried on a phone
        active--;
        if (stopped()) break;
        result.foundIn = t.foundIn;
        if (t.linkText) result.linkText = t.linkText;
        if (t.clickable !== undefined) result.clickable = t.clickable;
        if (t.note) result.note = t.note;

        proxyFailures = result.error === PROXY_ERROR ? proxyFailures + 1 : 0;
        if (proxyFailures >= PROXY_FAILURES_TO_STOP && !report.stopReason) {
          report.stopReason = `The proxy stopped working (${PROXY_FAILURES_TO_STOP} pages in a row couldn't connect), so the test stopped. It may have expired: run the test again for a new proxy.`;
        }
        report.pages.push(result);
        send({ type: "page", page: result });
      }
      await tab.close().catch(() => {});
      await ptab?.close().catch(() => {});
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // 6. Same IP and country at the end?
    if (!stopped() && targets.length) {
      send({ type: "step", message: "Checking the proxy IP again…" });
      report.exitEnd = await exitLocation(context);
    }
  } catch (err) {
    if (!stopped()) throw err;
  } finally {
    signal.removeEventListener("abort", onAbort);
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
  "edge-consumer-static.azureedge.net",
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

/** IP lookup services, tried in order. Both return { ip, country (2-letter code) }. */
const IP_SERVICES = ["https://ipinfo.io/json", "https://api.country.is/"];

function toExitInfo(j: Record<string, string> | undefined): ExitInfo | null {
  if (!j?.ip) return null;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return {
    ip: j.ip,
    countryCode: j.country ?? null,
    country: j.country ? (names.of(j.country) ?? j.country) : null,
    city: j.city ?? null,
    org: j.org ?? null,
  };
}

/** Where the visit comes from, looked up inside the proxied browser. */
async function exitLocation(context: BrowserContext): Promise<ExitInfo | null> {
  for (const service of IP_SERVICES) {
    const page = await context.newPage();
    try {
      const res = await page.goto(service, { timeout: 20_000 });
      const info = toExitInfo((await res?.json()) as Record<string, string> | undefined);
      if (info) return info;
    } catch {
      /* try the next service */
    } finally {
      await page.close().catch(() => {});
    }
  }
  return null;
}

/** This computer's own public IP, without the proxy. */
async function publicIpDirect(): Promise<string | null> {
  for (const service of IP_SERVICES) {
    try {
      const res = await fetch(service, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
      const ip = ((await res.json()) as { ip?: string }).ip;
      if (ip) return ip;
    } catch {
      /* try the next service */
    }
  }
  return null;
}

/** Why the test must not continue from this IP, or null when it's the right country through the proxy. */
function exitProblem(exit: ExitInfo | null, localIp: string | null): string | null {
  if (!exit) return "Couldn't confirm the proxy's IP and country, so no pages were opened (the results might not be from the right country). Run the test again.";
  if (localIp && exit.ip === localIp) return `The visit used this computer's own IP (${exit.ip}), not the proxy, so no pages were opened.`;
  if (exit.countryCode !== EXPECTED_COUNTRY) {
    const where = new Intl.DisplayNames(["en"], { type: "region" }).of(EXPECTED_COUNTRY);
    return `The proxy's IP (${exit.ip}) is in ${exit.country ?? "an unknown country"}, not ${where}, so no pages were opened. Get a ${where} proxy and run again.`;
  }
  return null;
}

/** Downloads through the browser context, so it uses the same proxy as the visit. */
function proxiedFetcher(context: BrowserContext): SitemapFetcher {
  return async (url, accept) => {
    if (isBlockedHost(new URL(url).hostname)) throw new Error(`Blocked address: ${url}`);
    const res = await context.request.get(url, { headers: { accept }, timeout: 20_000, maxRedirects: 5 });
    return { ok: res.ok(), finalUrl: res.url(), text: () => res.text() };
  };
}

type Thumbnailer = (jpeg: Buffer, width?: number) => Promise<string>;

const THUMB_WIDTH = 480;

/** Shrinks screenshots to THUMB_WIDTH in a blank tab (no network, no site code), as a JPEG data URL. */
async function makeThumbnailer(context: BrowserContext): Promise<Thumbnailer> {
  const helper = await context.newPage();
  return (jpeg, width = THUMB_WIDTH) =>
    helper.evaluate(
      async ({ src, width }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.round((img.height * width) / img.width);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.6);
      },
      { src: `data:image/jpeg;base64,${jpeg.toString("base64")}`, width },
    );
}

/** Opens one page, scrolls to the bottom and records status, timing, errors and images. */
async function checkPage(
  page: Page,
  url: string,
  kind: VisitPage["kind"],
  navigate: () => Promise<{ status(): number } | null>,
  scrollOpts: typeof PAGE_SCROLL,
  /** "full": full-size screenshot; a thumbnailer: full size only for pages with problems; null: no screenshot. */
  shots: "full" | Thumbnailer | null,
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
  // Files still downloading, to name the ones that keep a page from finishing.
  const pending = new Map<object, string>();
  const onRequest = (r: { url(): string; resourceType(): string }) => pending.set(r, `${r.resourceType()} ${r.url()}`);
  const onDone = (r: object) => pending.delete(r);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);

  const result: VisitPage = { kind, url, finalUrl: url, status: null, title: null, loadMs: null, ttfbMs: null, ok: false, consoleErrors, failedRequests, scroll: null };
  try {
    // navigate() resolves once the page's content is there (DOMContentLoaded). Many working sites
    // then keep loading a widget, tracker or video for a long time, so the full "load" is waited
    // for separately and a page that never finishes is a warning, not a failure.
    const res = await navigate();
    result.status = res?.status() ?? null;
    const loaded = await page
      .waitForLoadState("load", { timeout: LOAD_WAIT })
      .then(() => true)
      .catch(() => false);
    if (!loaded) result.stillLoading = [...pending.values()].filter((u) => !u.includes(" data:")).slice(0, 5).map((u) => u.slice(0, 200));
    result.finalUrl = page.url();
    result.title = (await page.title().catch(() => "")) || null;
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return n ? { load: n.loadEventEnd, ttfb: n.responseStart } : null;
    });
    result.loadMs = t && t.load > 0 ? Math.round(t.load) : null;
    result.ttfbMs = t ? Math.round(t.ttfb) : null;
    result.ok = result.status !== null && result.status < 400;
    if (!result.ok) result.error = `The page returned HTTP ${result.status ?? "no response"}.`;

    result.scroll = await scrollPage(page, scrollOpts).catch(() => null);
    // Screenshots (unless turned off): full size where someone needs to look closely (start page,
    // pages with problems); a small one for the rest, so hundreds of pages stay light.
    if (shots) {
      await page.waitForTimeout(400); // let the top of the page repaint after scrolling back up
      const jpeg = await page.screenshot({ type: "jpeg", quality: 55 });
      result.screenshot = shots === "full" || hasProblem(result) ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : await shots(jpeg).catch(() => undefined);
    }
  } catch (err) {
    result.error = friendly(err);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
    page.off("request", onRequest);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }
  return result;
}

function hasProblem(p: VisitPage): boolean {
  return (
    !p.ok ||
    p.consoleErrors.length > 0 ||
    p.failedRequests.length > 0 ||
    !!p.scroll?.brokenImages.length ||
    (p.loadMs ?? 0) > SLOW_MS ||
    !!p.stillLoading
  );
}

async function scrollPage(page: Page, { stepWaitMs, maxSteps, settleMs }: typeof PAGE_SCROLL): Promise<ScrollResult> {
  let steps = 0;
  let reachedBottom = false;
  for (; steps < maxSteps; steps++) {
    reachedBottom = await page.evaluate(() => {
      window.scrollBy(0, Math.round(window.innerHeight * 0.85));
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    });
    await page.waitForTimeout(stepWaitMs);
    if (reachedBottom) break;
  }
  await page.waitForTimeout(settleMs); // let lazy images finish
  const img = await page.evaluate(() => {
    const all = [...document.images].filter((i) => i.currentSrc || i.src);
    const broken = all.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
    return { total: all.length, loaded: all.filter((i) => i.complete && i.naturalWidth > 0).length, broken: broken.slice(0, 20), height: document.documentElement.scrollHeight };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  return { steps: steps + 1, pageHeight: img.height, reachedBottom, images: img.total, imagesLoaded: img.loaded, brokenImages: img.broken };
}

interface StartLink {
  href: string;
  text: string;
  clickable?: boolean;
  note?: string;
}

/**
 * Internal links on the start page. Each visible link gets a trial click (Playwright checks it
 * is visible, stable and not covered, without actually clicking), so the start page doesn't
 * have to be reloaded before every page.
 */
async function startPageLinks(page: Page, pageUrl: string, siteHost: string): Promise<StartLink[]> {
  const raw = await page.$$eval("a[href]", (as) =>
    as.map((a, index) => {
      const el = a as HTMLAnchorElement;
      // 1px links are screen-reader helpers ("skip to content"), not something a visitor clicks.
      const r = el.getBoundingClientRect();
      const visible = r.width > 1 && r.height > 1;
      return { index, href: el.href, text: (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ").slice(0, 80), visible };
    }),
  );
  const self = normalizeUrl(pageUrl);
  const byKey = new Map<string, { href: string; text: string; visibleIndex: number }>();
  for (const l of raw) {
    if (!isSafeInternal(l.href, siteHost)) continue;
    const key = normalizeUrl(l.href);
    if (!key || key === self) continue;
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { href: l.href, text: l.text, visibleIndex: l.visible ? l.index : -1 });
    else if (seen.visibleIndex < 0 && l.visible) Object.assign(seen, { visibleIndex: l.index, text: l.text || seen.text });
  }

  const anchors = page.locator("a[href]");
  const links: StartLink[] = [];
  for (const l of byKey.values()) {
    const link: StartLink = { href: l.href, text: l.text };
    if (l.visibleIndex < 0) {
      link.note = "The link is in a hidden menu or not shown on screen.";
    } else {
      try {
        await anchors.nth(l.visibleIndex).click({ trial: true, timeout: 2_000 });
        link.clickable = true;
      } catch (err) {
        link.clickable = false;
        link.note = /intercept|cover/i.test(String(err)) ? "Something on the page covers this link, so a visitor can't click it." : "A visitor can't click this link (not visible or not stable).";
      }
    }
    links.push(link);
  }
  return links;
}

/** Opens the page on a phone: does it load, fit the screen, have the viewport tag, load its images? */
/** shrink: null = no screenshot. */
async function checkMobile(page: Page, url: string, shrink: Thumbnailer | null): Promise<MobileCheck> {
  const out: MobileCheck = { ok: false, status: null, overflowPx: 0, viewportTag: false, images: 0, brokenImages: [] };
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded" });
    out.status = res?.status() ?? null;
    out.ok = out.status !== null && out.status < 400;
    if (!out.ok) out.error = `The page returned HTTP ${out.status ?? "no response"}.`;
    await page.waitForLoadState("load", { timeout: MOBILE_LOAD_WAIT }).catch(() => {});
    const s = await scrollPage(page, MOBILE_SCROLL).catch(() => null);
    if (s) {
      out.images = s.images;
      out.brokenImages = s.brokenImages;
    }
    const m = await page.evaluate(() => {
      // Sideways scrolling is only possible when neither <html> nor <body> hides horizontal overflow.
      const clipped = [document.documentElement, document.body].some((el) => !!el && ["hidden", "clip"].includes(getComputedStyle(el).overflowX));
      const content = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
      return {
        // clientWidth is the phone screen width (412px); innerWidth grows when the phone zooms out to fit a too-wide page.
        overflow: clipped ? 0 : Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        viewportTag: /width\s*=\s*device-width/i.test(content),
      };
    });
    out.overflowPx = m.overflow;
    out.viewportTag = m.viewportTag;
    if (shrink) {
      await page.waitForTimeout(300);
      out.screenshot = await shrink(await page.screenshot({ type: "jpeg", quality: 60 }), PHONE_THUMB_WIDTH).catch(() => undefined);
    }
  } catch (err) {
    out.error = friendly(err);
  }
  return out;
}

/** On a phone: finds the menu button (☰), taps it and checks the menu opens with links. */
async function mobileMenu(page: Page, shrink: Thumbnailer | null): Promise<NonNullable<MenuCheck["mobile"]>> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const toggles = page.locator(
    'button, [role="button"], a[href="#"], .menu-toggle, .navbar-toggler, .hamburger, [class*="menu-toggle"], [class*="hamburger"], [class*="nav-toggle"], .elementor-menu-toggle',
  );
  // Visible near the top of the screen and looks like a menu button (label, class or id).
  const index = await toggles.evaluateAll((els) => {
    const hint = /menu|nav|hamburger|toggler|burger|danh m[uụ]c|☰/i;
    let fallback = -1;
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.top < 0 || r.top > 220 || getComputedStyle(el).visibility === "hidden") continue;
      const text = `${typeof el.className === "string" ? el.className : ""} ${el.id} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("aria-controls") ?? ""} ${el.innerText ?? ""}`;
      if (/search|t[iì]m ki[eế]m|cart|gi[oỏ] h[aà]ng|close|đóng/i.test(text)) continue;
      if (hint.test(text)) return i;
      if (fallback < 0 && el.hasAttribute("aria-expanded")) fallback = i;
    }
    return fallback;
  });
  if (index < 0) return { buttonFound: false, opened: false, linksShown: 0, note: "No menu button (☰) found at the top of the phone screen." };

  const linksOnScreen = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("a[href]")].filter((a) => {
          const r = a.getBoundingClientRect();
          const cs = getComputedStyle(a);
          return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== "hidden" && Number(cs.opacity) > 0.1;
        }).length,
    );
  const before = await linksOnScreen();
  const startUrl = page.url();
  const toggle = toggles.nth(index);
  try {
    await toggle.tap({ timeout: 5_000 }).catch(() => toggle.click({ timeout: 5_000 }));
  } catch {
    return { buttonFound: true, opened: false, linksShown: 0, note: "The menu button couldn't be tapped (something covers it)." };
  }
  await page.waitForTimeout(900);
  if (normalizeUrl(page.url()) !== normalizeUrl(startUrl)) {
    return { buttonFound: true, opened: false, linksShown: 0, note: "Tapping the menu button opened another page instead of the menu." };
  }
  const after = await linksOnScreen();
  const expanded = (await toggle.getAttribute("aria-expanded").catch(() => null)) === "true";
  const shown = Math.max(0, after - before);
  const opened = shown >= 3 || (expanded && shown > 0);
  const screenshot = shrink ? await shrink(await page.screenshot({ type: "jpeg", quality: 60 }), PHONE_THUMB_WIDTH).catch(() => undefined) : undefined;
  return { buttonFound: true, opened, linksShown: shown, note: opened ? undefined : "The menu button was tapped, but no menu links appeared.", screenshot };
}

/** Safe internal links on the page a tab is showing. */
async function pageLinks(page: Page, siteHost: string): Promise<string[]> {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
  return hrefs.filter((h) => isSafeInternal(h, siteHost));
}

/** Start-page links first (they're what visitors see), then the rest of the sitemap. */
function combineTargets(links: StartLink[], sitemapUrls: string[] | null, start: VisitPage, siteHost: string) {
  const skip = new Set([normalizeUrl(start.url), normalizeUrl(start.finalUrl)]);
  const sitemapKeys = new Set<string>();
  const sitemapTargets: Target[] = [];
  for (const u of sitemapUrls ?? []) {
    if (!isSafeInternal(u, siteHost)) continue;
    const key = normalizeUrl(u);
    if (!key || sitemapKeys.has(key)) continue;
    sitemapKeys.add(key);
    if (!skip.has(key)) sitemapTargets.push({ href: u, foundIn: "sitemap" });
  }

  const linkKeys = new Set<string>();
  const all: Target[] = [];
  for (const l of links) {
    const key = normalizeUrl(l.href)!;
    linkKeys.add(key);
    all.push({ href: l.href, foundIn: "start page", linkText: l.text || undefined, clickable: l.clickable, note: l.note });
  }
  for (const t of sitemapTargets) if (!linkKeys.has(normalizeUrl(t.href)!)) all.push(t);

  const discovery: Discovery = {
    sitemap: sitemapKeys.size,
    startPage: links.length,
    startPageOnly: [...linkKeys].filter((k) => !sitemapKeys.has(k)).length,
    fromLinks: 0,
    total: Math.min(all.length, MAX_PAGES),
    leftOut: Math.max(0, all.length - MAX_PAGES),
    noSitemap: sitemapUrls === null,
  };
  return { targets: all.slice(0, MAX_PAGES), discovery };
}

function isSafeInternal(href: string, siteHost: string) {
  return /^https?:/i.test(href) && isInternal(href, siteHost) && !shouldSkipCrawl(href) && !RISKY_LINK.test(href);
}

function finish(report: VisitReport): VisitReport {
  report.finishedAt = new Date().toISOString();
  report.issues = findIssues(report);
  return report;
}

function findIssues(r: VisitReport): string[] {
  const issues: string[] = [];
  if (r.stopReason) issues.push(r.stopReason);
  if (r.exit && r.exitEnd) {
    if (r.exitEnd.countryCode !== r.exit.countryCode) {
      issues.push(`The proxy moved from ${r.exit.country} to ${r.exitEnd.country} during the test, so later pages may show another country's version.`);
    } else if (r.exitEnd.ip !== r.exit.ip) {
      issues.push(`The proxy IP changed during the test (${r.exit.ip} to ${r.exitEnd.ip}), still in ${r.exitEnd.country}.`);
    }
  }
  if (r.discovery?.leftOut) issues.push(`The site has more than ${MAX_PAGES} pages; ${r.discovery.leftOut} weren't visited.`);
  const all = [r.start, ...r.pages].filter((p): p is VisitPage => !!p);
  for (const p of all) {
    const name = p.kind === "start" ? "Start page" : p.url;
    if (!p.ok) issues.push(`${name}: ${p.error ?? "didn't load"}`);
    if (p.loadMs && p.loadMs > SLOW_MS) issues.push(`${name}: slow (${(p.loadMs / 1000).toFixed(1)}s to load)`);
    if (p.stillLoading) {
      const files = p.stillLoading.map((f) => f.replace(/^\w+ /, "")).slice(0, 2).join(", ");
      issues.push(`${name}: the page showed, but files were still loading after ${LOAD_WAIT / 1000}s${files ? ` (${files})` : ""}`);
    }
    if (p.consoleErrors.length) issues.push(`${name}: ${p.consoleErrors.length} JavaScript error(s)`);
    if (p.failedRequests.length) issues.push(`${name}: ${p.failedRequests.length} file(s) failed to load`);
    if (p.scroll?.brokenImages.length) issues.push(`${name}: ${p.scroll.brokenImages.length} image(s) didn't load`);
    if (p.clickable === false && p.note) issues.push(`${name}: ${p.note}`);
    const m = p.mobile;
    if (m && !m.ok) issues.push(`${name} on a phone: ${m.error ?? "didn't load"}`);
    if (m?.ok && m.overflowPx > OVERFLOW_PX) issues.push(`${name} on a phone: the page is ${m.overflowPx}px wider than the screen, so visitors can scroll sideways`);
    if (m?.ok && !m.viewportTag) issues.push(`${name} on a phone: no viewport tag, so phones may show a tiny desktop page`);
    if (m?.brokenImages.length) issues.push(`${name} on a phone: ${m.brokenImages.length} image(s) didn't load`);
  }
  const menus = r.start?.menus;
  if (menus?.mobile && !menus.mobile.opened) issues.push(`Phone menu: ${menus.mobile.note ?? "didn't open"}`);
  if (r.scroll && !r.scroll.reachedBottom) issues.push("Start page: couldn't scroll to the bottom (very long or endless page)");
  return issues;
}

const PROXY_ERROR = "The proxy refused or dropped the connection.";

function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/ERR_PROXY|ERR_TUNNEL|proxy/i.test(m)) return PROXY_ERROR;
  if (/Timeout|timed out/i.test(m)) return `Nothing showed within ${NAV_TIMEOUT / 1000}s (the site or the proxy is too slow).`;
  if (/ERR_NAME_NOT_RESOLVED/.test(m)) return "The domain couldn't be found.";
  if (/ERR_CONNECTION/.test(m)) return "Couldn't connect to the site.";
  return m.split("\n")[0].slice(0, 200);
}
