// Server-only, local only: a real-browser visit to every page of a company site through a
// proxy. Opens the start page, finds all internal pages (sitemap + start-page links, never
// external links or ads), then opens each page once, scrolls it and checks it loads cleanly.
// This is a QA check that the site works for a visitor in that location, not a traffic tool.

import os from "node:os";
import path from "node:path";
import { chromium as playwrightChromium, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright-core";
import { addExtra } from "playwright-extra";
import { stealthOn, stealthPlugin } from "./stealth";
import { actAsDevice, deviceLabel, deviceUserAgent, type DeviceProfile } from "./device-profiles";
import { MAX_VISITS_PER_IP, burnProxy, getProxyOrReuse, getUnvisitedProxy } from "./proxy-api";
import { NO_WEBRTC_ARGS, NO_WEBRTC_SCRIPT } from "./no-webrtc";
import { fetchJsonInPage, lookupExit, ownPublicIp } from "./proxy-ip";
import { ProxyIpInUseError } from "./proxy-pool";
import { checkChromeProfile, EXTENSION_ARGS, KEEP_EXTENSIONS, PROFILE_ARGS, profileExtensionDirs, profileLockedMessage } from "./browser-profile";
import { takeGoogleTurn } from "./google-turn";
import { searchParams } from "./serp";
import { BROWSER_SEARCH_COUNTRY, CAPTCHA_MAX_MS, CAPTCHA_STALL_MS, CAPTCHA_WAIT_MS, GoogleBlockedError, googleBlocked, googleResultsUrl, waitForCaptcha } from "./serp-browser";
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
  type VisitDevice,
  type VisitEvent,
  type VisitPage,
  type VisitReport,
} from "./visit-types";

// Every visit browser runs with the stealth plugin (src/lib/stealth.ts).
const chromium = addExtra(playwrightChromium).use(stealthPlugin());
// A tab closed as soon as it opens (an extension's own tab, Chrome's empty first tab): the plugin
// couldn't set it up, and doesn't need to. Any other plugin error is still shown.
chromium.plugins.onPluginError = (plugin, method, err) => {
  if (/has been closed/.test(err instanceof Error ? err.message : String(err))) return;
  console.warn(`Stealth plugin "${plugin.name}" failed in ${method}:`, err);
};

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
/**
 * Reading a page (readPages): about 5s plus 1s per 40 words of text, capped at 60s, then times a random
 * 0.6–1.4, so every page gets its own time and a long article more than a contact page.
 */
const READ_BASE_SEC = 5;
const READ_WORDS_PER_SEC = 40;
const READ_MAX_SEC = 60;
/** Phone check: how long to wait for the full load (the desktop check already reported slow files). */
const MOBILE_LOAD_WAIT = 15_000;
/** An Android phone (most visitors in Vietnam), at 1x pixels; the layout is the same as on the real phone. */
const PHONE = { ...devices["Pixel 7"], deviceScaleFactor: 1 };

export interface VisitOptions {
  url: string;
  proxyApiUrl: string;
  /** Also open every page on a phone-sized screen, and test the phone menu (desktop visits only). */
  mobile: boolean;
  /** What the visit is made on: desktop (default) or a phone (phone screen, touch and browser, throughout). */
  device?: VisitDevice;
  /**
   * The exact device (model, screen, browser identity: src/lib/device-profiles.ts), picked at random
   * for each campaign visit. None = the plain desktop or phone (a Pixel 7) of the Visit test.
   */
  deviceProfile?: DeviceProfile;
  /**
   * A new proxy IP when the provider gives one; while it makes us wait, the link's current IP
   * (getCurrentProxy) is used again, unless Google kept blocking it (then ProxyWaitError).
   */
  freshProxy?: boolean;
  /**
   * Search Google for this keyword first, in the same browser and exactly as Keyword Rankings does
   * (same country and language), and click the site's result; not on the first page = the site is
   * opened directly. A CAPTCHA is waited for until it's solved in the browser window.
   * neverSkip: Google not showing results (the browser closed on its CAPTCHA, its consent page, the search
   * failing) ends the visit with GoogleBlockedError (the caller tries again in a new browser with a
   * new IP), instead of opening the site without the search.
   */
  searchFirst?: { keyword: string; country: string; neverSkip?: boolean };
  /**
   * Claims the confirmed proxy IP before any page opens; null = another visit running now has it
   * (then ProxyIpInUseError is thrown). Returns the release, called when the visit ends.
   */
  claimIp?: (ip: string) => (() => void) | null;
  /** A Chrome profile folder for this visit's browser (src/lib/browser-profile.ts); none = a fresh temporary profile. */
  profileDir?: string;
  /**
   * Dwell time: seconds spent on the site, counted from opening it. When it's up, the visit leaves
   * (pages still loading are cut off, the rest aren't opened); with every page visited sooner, it stays
   * on the start page until it's up. None = every page once, however long that takes.
   */
  dwellSec?: number;
  /**
   * Like a visitor reading: one page at a time, and on each page a pause based on how much text it has
   * (random, so no two are alike), with small scrolls while it "reads". Off = a few pages at a time, quickly.
   */
  readPages?: boolean;
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

export async function runVisitTest({ url, proxyApiUrl, mobile, freshProxy = false, searchFirst, claimIp, profileDir, dwellSec, readPages = false, device = "desktop", deviceProfile, signal, send }: VisitOptions): Promise<VisitReport> {
  const report: VisitReport = {
    url,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    proxy: null,
    exit: null,
    exitEnd: null,
    start: null,
    scroll: null,
    pages: [],
    discovery: null,
    stopReason: null,
    issues: [],
    cancelled: false,
    mobileChecked: mobile,
    device,
    ...(deviceProfile ? { deviceName: deviceLabel(deviceProfile) } : {}),
  };
  // A visit on a phone is already a phone check.
  if (device === "phone") mobile = report.mobileChecked = false;
  const stopped = () => {
    if (signal.aborted) report.cancelled = true;
    return signal.aborted;
  };

  // 1. Proxy
  send({ type: "step", message: "Getting a proxy from the proxy API…" });
  const proxy = freshProxy
    ? await getUnvisitedProxy(proxyApiUrl).then(({ current, ...p }) => ({ ...p, reused: current }))
    : { ...(await getProxyOrReuse(proxyApiUrl)), fromEarlier: false, visitNo: null };
  const { server, username, password, visitNo, ...publicProxy } = proxy;
  report.proxy = publicProxy;
  if (proxy.fromEarlier) {
    send({ type: "step", message: `Using the IP this proxy link gave just before (no visit has used it yet): ${proxy.address}.` });
  }
  if (proxy.reused) {
    send({ type: "step", message: `The provider isn't giving a new IP yet, so its current IP (${proxy.address}) is used again${visitNo ? ` (visit ${visitNo} of ${MAX_VISITS_PER_IP} on it)` : ""}.` });
  }

  let close: (() => Promise<void>) | null = null;
  let releaseIp: (() => void) | null = null;
  const onAbort = () => void close?.();
  // Dwell time: set when the site opens. At the end, the tabs still loading a page are closed.
  let dwellEnds: number | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  const openTabs = new Set<Page>();
  const timeUp = () => dwellEnds !== null && Date.now() >= dwellEnds;
  try {
    signal.addEventListener("abort", onAbort, { once: true });
    let context: BrowserContext;
    let phone: BrowserContext | null;
    // The visit's one tab: profile check, IP check, Google, then the site, all in it.
    let main: Page;
    let fromGoogle: { link: string | null; page: number } | null = null;
    let claimedIp: string | null = null;
    // TEMPORARY (testing): set when the site is opened directly after an unsolved CAPTCHA (see below).
    let openedDirectly = false;
    // A Google CAPTCHA not solved in CAPTCHA_WAIT_MS: the browser is closed and opened again
    // through the same proxy (same IP), up to CAPTCHA_TRIES times; then the run gets a new IP.
    for (let attempt = 1; ; attempt++) {
      const on = deviceProfile ? ` as a ${deviceLabel(deviceProfile)}` : device === "phone" ? " as a phone" : "";
      send({ type: "stage", stage: "browser" });
      send({ type: "step", message: `Opening a browser${on} through proxy ${proxy.address}…` });
      const opened = await openContexts({ server, username, password }, profileDir, mobile, device, deviceProfile);
      close = opened.close;
      if (stopped()) return finish(report);
      ({ context, phone } = opened);
      context.setDefaultNavigationTimeout(NAV_TIMEOUT);
      phone?.setDefaultNavigationTimeout(NAV_TIMEOUT);
      // No WebRTC in any page, so nothing can go around the proxy.
      await context.addInitScript(NO_WEBRTC_SCRIPT);
      await phone?.addInitScript(NO_WEBRTC_SCRIPT);
      // A site asking "Leave this page?" never keeps the visit on it (by default the answer is "stay").
      context.on("page", (p) => p.on("dialog", (d) => void (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {})));
      main = await context.newPage();
      // A saved Chrome profile: make sure it's Chrome on that profile, and say which (with its extensions).
      if (profileDir) send({ type: "step", message: await checkChromeProfile(main, profileDir) });

      // 2. Where does the visit come from? Looked up inside the proxied browser (through the proxy;
      // nothing is sent from this computer's own IP). Wrong or unknown location: stop before opening
      // any page. With a proxy set, the browser never falls back to a direct connection.
      send({ type: "step", message: "Checking the proxy IP (location, network, speed)…" });
      const [exitInfo, ownIp] = await Promise.all([exitLocation(main), ownPublicIp()]);
      report.exit = exitInfo;
      send({ type: "proxy", proxy: publicProxy, exit: report.exit });
      if (stopped()) return finish(report);
      report.stopReason = exitProblem(report.exit, ownIp);
      if (report.stopReason) return finish(report);
      const exit = report.exit!;
      // Claimed once; again only if the proxy came back on another IP after a reopen.
      if (claimIp && exit.ip !== claimedIp) {
        releaseIp?.();
        releaseIp = claimIp(exit.ip);
        if (!releaseIp) throw new ProxyIpInUseError(exit.ip);
        claimedIp = exit.ip;
      }
      send({
        type: "step",
        message: `Proxy IP ${exit.ip}: ${exit.country}${exit.city ? `, ${exit.city}` : ""} · ${exit.network}${exit.org ? ` (${exit.org})` : ""}${exit.lookupMs != null ? ` · answered in ${(exit.lookupMs / 1000).toFixed(1)}s` : ""}.`,
      });
      send({ type: "step", message: (await stealthOn(main)) ? "Stealth plugin: on (the browser doesn't show it's automated)." : "Stealth plugin: NOT working in this browser." });
      // Optional: the keyword searched on Google first, in this same browser, and the site's result
      // clicked (that tab becomes the start page). A failed search doesn't stop the visit.
      if (!searchFirst) break;
      try {
        fromGoogle = await searchGoogleFirst(main, searchFirst, url, send, signal);
        break;
      } catch (err) {
        if (err instanceof CaptchaRefusedError && !stopped()) {
          // Google won't even give this IP a CAPTCHA: no point reopening on it; the run gets a new IP.
          burnProxy(proxyApiUrl, proxy.address);
          throw err;
        }
        if (!(err instanceof CaptchaTimeoutError) || stopped()) throw err;
        // TEMPORARY, for testing only, until a proper solution for Google's CAPTCHA is found: a CAPTCHA
        // not solved the first time opens the site directly (by its URL, no click on Google's result),
        // instead of reopening the browser on the same IP and then trying a new IP. Turn it off with
        // TEMP_OPEN_DIRECTLY_ON_CAPTCHA = false to go back to "only ever through Google".
        if (TEMP_OPEN_DIRECTLY_ON_CAPTCHA) {
          burnProxy(proxyApiUrl, proxy.address); // Google blocked this IP: not handed out again
          send({ type: "step", message: `${err.message}: opening the site directly instead (temporary, for testing).` });
          openedDirectly = true;
          break;
        }
        if (attempt >= CAPTCHA_TRIES) {
          // Google keeps blocking this IP: never used again as the link's current IP; the run starts again
          // with a new IP (the site is only ever reached through Google).
          burnProxy(proxyApiUrl, proxy.address);
          throw new GoogleBlockedError(`The CAPTCHA wasn't solved, ${CAPTCHA_TRIES} times on this IP (last: ${err.message})`);
        }
        send({ type: "step", message: `${err.message}: closing the browser and opening it again with the same proxy IP (try ${attempt + 1} of ${CAPTCHA_TRIES})…` });
        await close();
        close = null;
      }
    }
    if (stopped()) return finish(report);
    // Reached only through Google (neverSkip): the site not in its results means no visit this time
    // (not counted; the run tries again), never the site opened directly.
    if (searchFirst?.neverSkip && !fromGoogle && !openedDirectly) {
      report.stopReason = `The site wasn't found in Google's results for “${searchFirst.keyword}”, so it wasn't opened (it's only visited through Google).`;
      return finish(report);
    }

    // The sitemap is read through the proxy too, so every request to the site comes from there.
    const sitemap = readSitemap(new URL(url).origin, proxiedFetcher(context)).catch(() => null);

    // 3. Start page: open and scroll. The dwell time starts now.
    send({ type: "stage", stage: fromGoogle ? "click" : "visit" });
    const opening = fromGoogle ? `Clicking the site's result on Google's ${fromGoogle.page === 1 ? "first page" : `page ${fromGoogle.page}`} (${fromGoogle.link ?? url})` : `Opening ${url}`;
    send({ type: "step", message: dwellSec ? `${opening} (staying on the site for ${dwellSec}s)…` : `${opening}…` });
    if (dwellSec) {
      dwellEnds = Date.now() + dwellSec * 1000;
      // Pages still loading are cut off: other tabs closed, the visit's own tab emptied (closing it could end the browser).
      dwellTimer = setTimeout(() => openTabs.forEach((t) => void (t === main ? t.goto("about:blank") : t.close()).catch(() => {})), dwellSec * 1000);
    }
    const page = main;
    report.reachedBy = fromGoogle ? "google" : "direct";
    const onSiteFrom = Date.now();
    // Reading one page takes at most a quarter of the time on the site (10s at least), so a visit sees several pages.
    const readCap = dwellSec ? Math.min(READ_MAX_SEC, Math.max(10, Math.round(dwellSec / 4))) : READ_MAX_SEC;
    const start = fromGoogle
      ? // A result without a link (Google's script opens it) or through Google's /url redirect: recorded
        // as the site (where it lands is finalUrl).
        await checkPage(page, !fromGoogle.link || /(^|\.)google\./.test(new URL(fromGoogle.link).hostname) ? url : fromGoogle.link, "start", () => clickResult(page, url, (message) => send({ type: "step", message })), START_SCROLL, readPages && { until: dwellEnds, maxSec: readCap })
      : await checkPage(page, url, "start", () => page.goto(url, { waitUntil: "domcontentloaded" }), START_SCROLL, readPages && { until: dwellEnds, maxSec: readCap });
    report.start = start;
    report.scroll = start.scroll ?? null;
    send({ type: "page", page: start });
    if (report.scroll) send({ type: "scroll", scroll: report.scroll });
    // The site didn't open: not a visit (it isn't counted, and the run tries again).
    if (!start.ok && !stopped()) report.stopReason = `The site didn't open (${start.error ?? "no response"}).`;
    if (!start.ok || stopped()) return finish(report);
    send({ type: "stage", stage: "visit" });

    // 4. Find every internal page
    send({ type: "step", message: "Finding all internal pages (sitemap and start-page links)…" });
    const siteHost = new URL(start.finalUrl).hostname;
    const links = await startPageLinks(page, start.finalUrl, siteHost);

    // The start page on a phone, and the phone menu (once: the same menu is on every page)
    if (phone) {
      send({ type: "step", message: "Checking the start page on a phone and its menu button (☰)…" });
      const menus: MenuCheck = { mobile: null };
      const ptab = await phone.newPage();
      start.mobile = await checkMobile(ptab, start.finalUrl);
      menus.mobile = start.mobile.ok
        ? await mobileMenu(ptab).catch(() => ({ buttonFound: false, opened: false, linksShown: 0, note: "The menu check failed." }))
        : null;
      await ptab.close().catch(() => {});
      start.menus = menus;
      send({ type: "page", page: start });
    }
    const { targets, discovery } = combineTargets(links, (await sitemap)?.urls ?? null, start, siteHost);
    report.discovery = discovery;
    send({ type: "discovered", discovery });
    if (stopped()) return finish(report);

    // 5. Visit every page, a few at a time (reading: one at a time, in a random order). Internal links
    // found on each page are added to the queue, so pages missing from the sitemap (or sites with no
    // sitemap) are still covered.
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
    // The first worker (the only one when reading) carries on in the visit's own tab.
    const worker = async (_: unknown, n: number) => {
      if (timeUp()) return;
      const newTab = async (ctx: BrowserContext) => {
        const t = await ctx.newPage();
        openTabs.add(t);
        return t;
      };
      openTabs.add(main);
      let tab = n === 0 && !main.isClosed() ? main : await newTab(context);
      let ptab = phone ? await newTab(phone) : null;
      while (!stopped() && !report.stopReason && !timeUp()) {
        if (next >= targets.length) {
          if (active === 0) break;
          await new Promise((r) => setTimeout(r, 200)); // another tab may still find new pages
          continue;
        }
        // Reading (campaign visits): the next page is any one not yet visited, at random, not the list's order.
        if (readPages) {
          const pick = next + Math.floor(Math.random() * (targets.length - next));
          [targets[next], targets[pick]] = [targets[pick], targets[next]];
        }
        const t = targets[next++];
        active++;
        if (tab.isClosed()) tab = await newTab(context);
        const referer = t.foundIn === "start page" ? start.finalUrl : undefined;
        const result = await checkPage(tab, t.href, "internal", () => tab.goto(t.href, { waitUntil: "domcontentloaded", referer }), PAGE_SCROLL, readPages && { until: dwellEnds, maxSec: readCap });
        if (result.ok && isInternal(result.finalUrl, siteHost)) addFound(await pageLinks(tab, siteHost).catch(() => []));
        if (phone && result.ok && !stopped()) {
          if (!ptab || ptab.isClosed()) ptab = await newTab(phone);
          result.mobile = await checkMobile(ptab, result.finalUrl);
        } else if (phone) result.mobile = null; // didn't open on desktop, so not tried on a phone
        active--;
        if (stopped()) break;
        // Cut off by the end of the dwell time: not a problem with the page, so not reported.
        if (timeUp() && !result.ok) break;
        if (timeUp() && result.mobile && !result.mobile.ok) result.mobile = null;
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
      if (tab !== main) await tab.close().catch(() => {});
      await ptab?.close().catch(() => {});
    };
    // Reading: one page at a time, as a visitor does.
    await Promise.all(Array.from({ length: readPages ? 1 : CONCURRENCY }, worker));
    // Dwell time: leave when it's up, or stay on the start page until it is.
    if (dwellEnds !== null && !stopped() && !report.stopReason) {
      if (timeUp()) {
        send({ type: "step", message: `The dwell time (${dwellSec}s) is up after ${report.pages.length} of ${targets.length} other pages; leaving the site.` });
      } else {
        const left = Math.ceil((dwellEnds - Date.now()) / 1000);
        send({ type: "step", message: `Every page was visited; staying on the start page for the rest of the dwell time (${left}s of ${dwellSec}s)…` });
        send({ type: "wait", seconds: left, reason: "the end of the dwell time (staying on the site)" });
        await main.goto(start.finalUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.max(0, dwellEnds! - Date.now()));
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
        send({ type: "waited" });
      }
    }

    report.onSiteSec = Math.round((Date.now() - onSiteFrom) / 1000);

    // 6. Same IP and country at the end?
    if (!stopped() && targets.length) {
      send({ type: "step", message: "Checking the proxy IP again…" });
      // Only a record of where the visit came from: never more than END_CHECK_MS at the end of a visit.
      report.exitEnd = await Promise.race([exitLocation(main, 3_000), new Promise<null>((r) => setTimeout(() => r(null), END_CHECK_MS))]);
    }
  } catch (err) {
    if (!stopped()) throw err;
  } finally {
    if (dwellTimer) clearTimeout(dwellTimer);
    releaseIp?.();
    signal.removeEventListener("abort", onAbort);
    await close?.();
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

type ProxyLogin = { server: string; username?: string; password?: string };

/** Uses a browser already installed on this computer: Google Chrome, else Microsoft Edge. */
const CHANNELS = ["chrome", "msedge"];

/** How every browser starts: visible, through the proxy only, background services blocked, no WebRTC. */
function launchOptions(proxy: ProxyLogin, extraArgs: string[] = []) {
  return {
    // Headed: a visible browser window, so the visit can be watched as it works.
    headless: false,
    // Extensions are never turned off (a saved Chrome profile's run).
    ignoreDefaultArgs: KEEP_EXTENSIONS,
    proxy: { ...proxy, bypass: BROWSER_BACKGROUND_HOSTS.join(",") },
    args: [
      `--host-resolver-rules=${BROWSER_BACKGROUND_HOSTS.map((h) => `MAP ${h} ~NOTFOUND`).join(", ")}`,
      // WebRTC could otherwise show the site our real IP (src/lib/no-webrtc.ts).
      ...NO_WEBRTC_ARGS,
      ...extraArgs,
    ],
  };
}

const DESKTOP = { viewport: { width: 1366, height: 768 }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", ignoreHTTPSErrors: false };
const PHONE_CONTEXT = { ...PHONE, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" };
/** The browser's screen, touch, language and time zone. */
type ContextScreen = Omit<BrowserContextOptions, "proxy">;

/**
 * The visit's context (desktop, or a phone for a visit on a phone) and, for the phone checks, a phone
 * one. With a profile folder, the visit runs in it (a profile holds one setup); the phone checks, with
 * their own screen and touch, then run in a second, plain browser through the same proxy.
 */
async function openContexts(
  proxy: ProxyLogin,
  profileDir: string | undefined,
  mobile: boolean,
  device: VisitDevice,
  deviceProfile?: DeviceProfile,
): Promise<{ context: BrowserContext; phone: BrowserContext | null; close(): Promise<void> }> {
  const screen: ContextScreen = deviceProfile
    ? { ...deviceProfile.screen, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" }
    : device === "phone"
      ? PHONE_CONTEXT
      : DESKTOP;
  if (!profileDir) {
    const browser = await launchBrowser(proxy);
    try {
      const context = await browser.newContext(screen);
      if (deviceProfile) actAsDevice(context, deviceProfile);
      const phone = mobile ? await browser.newContext(PHONE_CONTEXT) : null;
      return { context, phone, close: () => browser.close().catch(() => {}) };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }
  const context = await launchWithProfile(proxy, profileDir, screen);
  if (deviceProfile) actAsDevice(context, deviceProfile);
  let other: Browser | null = null;
  try {
    other = mobile ? await launchBrowser(proxy) : null;
    const phone = other ? await other.newContext(PHONE_CONTEXT) : null;
    return {
      context,
      phone,
      close: async () => {
        await context.close().catch(() => {});
        await other?.close().catch(() => {});
      },
    };
  } catch (err) {
    await context.close().catch(() => {});
    await other?.close().catch(() => {});
    throw err;
  }
}

async function launchBrowser(proxy: ProxyLogin): Promise<Browser> {
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, ...launchOptions(proxy) });
    } catch {
      /* try the next one */
    }
  }
  throw new Error("No browser found. Install Google Chrome or Microsoft Edge on this computer.");
}

/** The desktop browser on a Chrome profile folder, with the profile's extensions: Google Chrome only (never Edge). */
async function launchWithProfile(proxy: ProxyLogin, profileDir: string, screen: ContextScreen): Promise<BrowserContext> {
  try {
    const context = await chromium.launchPersistentContext(profileDir, { channel: "chrome", ...launchOptions(proxy, [...PROFILE_ARGS, ...EXTENSION_ARGS]), ...screen });
    await loadExtensions(context, profileDir);
    // The empty tab Chrome starts with: closed once the app opens its own. A tab an extension opens
    // by itself (e.g. Adobe Acrobat's welcome page, as each loads like a new install): closed at once.
    // The app's own tabs always start empty (about:blank).
    const [blank] = context.pages();
    // Never the last tab open: closing it would close Chrome, and the visit with it.
    const closeTab = (t: Page) => context.pages().filter((p) => !p.isClosed()).length > 1 && void t.close().catch(() => {});
    context.on("page", (tab) => {
      if (tab.url() !== "about:blank") return void closeTab(tab);
      if (blank && blank !== tab && !blank.isClosed()) closeTab(blank);
    });
    return context;
  } catch (err) {
    // Open in another Chrome window: say so plainly.
    const locked = profileLockedMessage(err, profileDir);
    const first = (err instanceof Error ? err.message : String(err)).split("\n")[0];
    throw new Error(locked ?? `Couldn't start Google Chrome with the saved Chrome profile (${first}).`);
  }
}

/**
 * Loads the profile's extensions into its browser, switched on (Chrome drops a copied profile's
 * extensions: src/lib/browser-profile.ts). One that won't load is left out; the visit goes on.
 */
async function loadExtensions(context: BrowserContext, profileDir: string): Promise<void> {
  const browser = context.browser();
  if (!browser) return;
  const session = await browser.newBrowserCDPSession();
  // Not in Playwright's protocol types.
  const send = session.send.bind(session) as (method: string, params: object) => Promise<unknown>;
  for (const dir of await profileExtensionDirs(profileDir)) await send("Extensions.loadUnpacked", { path: dir }).catch(() => {});
  await session.detach().catch(() => {});
}

/**
 * Where the visit comes from, looked up inside the proxied browser: in the visit's own tab, emptied
 * first, in the background (the IP service's page is never shown).
 */
async function exitLocation(tab: Page, leaveMs = 10_000): Promise<ExitInfo | null> {
  // Some sites' pages hold the tab for a long time when it leaves them: not waited for past leaveMs.
  const left = await tab.goto("about:blank", { waitUntil: "commit", timeout: leaveMs }).then(() => true, () => false);
  if (!left && tab.url() !== "about:blank") return null;
  return lookupExit((url) => tab.evaluate(fetchJsonInPage, url));
}

/** Why the test must not continue from this IP, or null when it's the right country through the proxy. */
function exitProblem(exit: ExitInfo | null, ownIp: string | null): string | null {
  if (!exit) return "Couldn't confirm the proxy's IP and country, so no pages were opened (the results might not be from the right country). Run the test again.";
  // Belt and braces: the browser never connects directly with a proxy set, but if the visit would
  // come from this computer's own IP, stop before the site sees it.
  if (ownIp && exit.ip === ownIp) return `The visit would come from this computer's own IP (${ownIp}), not the proxy, so no pages were opened.`;
  if (exit.countryCode !== EXPECTED_COUNTRY) {
    const where = new Intl.DisplayNames(["en"], { type: "region" }).of(EXPECTED_COUNTRY);
    return `The proxy's IP (${exit.ip}) is in ${exit.country ?? "an unknown country"}, not ${where}, so no pages were opened. Get a ${where} proxy and run again.`;
  }
  return null;
}

/**
 * Searches Google for the keyword in the visit's own browser, the way Keyword Rankings does
 * (src/lib/serp.ts: same country and language, same results page, same reading of the results),
 * and says where the site ranks, looking through the first SEARCH_PAGES pages ("Next", like a person).
 * A CAPTCHA (on any page) is waited for until it's solved in the browser window (solveCaptcha). In
 * the visit's own tab, which stays on the results: the site found returns its result's href (null
 * when Google's result has none) and page, for the visit to click it (clickResult); not found, null.
 * The proxy IP was already confirmed in Vietnam before this runs.
 */
async function searchGoogleFirst(
  tab: Page,
  { keyword, country, neverSkip }: NonNullable<VisitOptions["searchFirst"]>,
  siteUrl: string,
  send: VisitOptions["send"],
  signal: AbortSignal,
): Promise<{ link: string | null; page: number } | null> {
  if (country.toUpperCase() !== BROWSER_SEARCH_COUNTRY) {
    send({ type: "step", message: "Only Vietnam can be searched (the proxy is in Vietnam), so the Google search was skipped; opening the site directly." });
    return null;
  }
  const params = searchParams(keyword, country);
  // One Google search at a time across all the app's browsers (src/lib/google-turn.ts).
  let waited = false;
  const release = await takeGoogleTurn(signal, () => {
    waited = true;
    send({ type: "wait", seconds: null, reason: "its turn to search Google (one browser at a time)" });
    send({ type: "step", message: "Waiting for the other browser to finish its Google search (one at a time, so Google doesn't see them together)…" });
  });
  if (waited) send({ type: "waited" });
  send({ type: "stage", stage: "search" });
  send({ type: "step", message: `Searching Google for “${keyword}” (as in Vietnam: gl=${params.gl}, hl=${params.hl})…` });
  const host = new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase();
  try {
    // The site looked for on Google's first SEARCH_PAGES pages, going on with "Next" like a person.
    for (let n = 1; n <= SEARCH_PAGES; n++) {
      if (n === 1) await tab.goto(googleResultsUrl(params), { waitUntil: "domcontentloaded" });
      else await nextResultsPage(tab, params, n);
      let found: Awaited<ReturnType<typeof readSiteResults>> = { organic: 0, titles: 0, links: [] };
      // A CAPTCHA, and sometimes another one right after it's solved (up to CAPTCHAS_PER_PAGE).
      for (let captchas = 0; ; ) {
        const blocked = googleBlocked(tab.url(), !!(await tab.$("#captcha-form").catch(() => null)));
        if (blocked === "captcha" && captchas < CAPTCHAS_PER_PAGE) {
          captchas++;
          if (captchas > 1) send({ type: "step", message: `Google asked for another CAPTCHA (${captchas} on this page)…` });
          // The search has reached Google: the next browser's search needn't wait for this CAPTCHA.
          release();
          if (!(await solveCaptcha(tab, send, signal))) return null; // the visit was stopped
          continue;
        }
        if (blocked === "captcha") throw new CaptchaTimeoutError(`Google kept asking for a CAPTCHA (${captchas} on one page)`);
        if (blocked === "consent" && neverSkip) throw new GoogleBlockedError("Google showed its cookie consent page instead of results");
        if (blocked) {
          send({ type: "step", message: "Google showed its cookie consent page, so the search was skipped; opening the site directly." });
          return null;
        }
        // Read again every second for up to RESULTS_WAIT_MS until results are there: right after a
        // CAPTCHA, Google is still loading them (or shows another CAPTCHA: back to the top).
        for (const end = Date.now() + RESULTS_WAIT_MS; ; ) {
          await tab.waitForLoadState("domcontentloaded").catch(() => {});
          if (googleBlocked(tab.url(), false)) break;
          found = await readSiteResults(tab, host);
          if (found.links.length || found.organic || Date.now() >= end) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!googleBlocked(tab.url(), false)) break;
      }
      // Looked through like a person (and Google's "Next" is at the bottom).
      await scrollPage(tab, MOBILE_SCROLL).catch(() => null);
      const on = n === 1 ? "Google's first page" : `Google's page ${n}`;
      const first = found.links[0];
      if (first) {
        const others = found.links.length > 1 ? ` (${found.links.length} links to it there)` : "";
        send({ type: "step", message: `The site is ${first.position ? `#${first.position} ` : ""}on ${on} for “${keyword}”${others}.` });
        return { link: first.href, page: n };
      }
      // Nothing read at all: not a results page (or a layout this can't read); a picture to see why.
      const why = found.organic ? `The site isn't on ${on}` : `Couldn't read any results on ${on} (page: ${tab.url().slice(0, 120)} · ${found.titles} titles${found.error ? ` · ${found.error}` : ""}${await saveShot(tab)})`;
      send({ type: "step", message: `${why} for “${keyword}”${n < SEARCH_PAGES ? `; going on to page ${n + 1}…` : "."}` });
    }
    if (!neverSkip) send({ type: "step", message: `The site isn't on Google's first ${SEARCH_PAGES} pages; opening it directly…` });
    return null;
  } catch (err) {
    if (err instanceof GoogleBlockedError) throw err;
    // Never skipped: the visit starts again in a new browser with a new IP.
    if (neverSkip && !signal.aborted) throw new GoogleBlockedError(`The Google search didn't work (${friendly(err)})`);
    send({ type: "step", message: `The Google search didn't work (${friendly(err)}); opening the site directly.` });
    return null;
  } finally {
    release();
  }
}

/**
 * Google's next results page (n), as a person goes there: its "Next" link at the bottom clicked;
 * without one (or when the click goes nowhere), the page opened from the current one.
 */
async function nextResultsPage(tab: Page, params: ReturnType<typeof searchParams>, n: number): Promise<void> {
  const before = tab.url();
  const next = tab.locator("#pnnext").or(tab.getByRole("link", { name: /^(Next|Tiếp|Trang tiếp theo|Trang sau)$/i })).first();
  try {
    await next.scrollIntoViewIfNeeded({ timeout: 3_000 });
    await Promise.all([tab.waitForURL((u) => u.toString() !== before, { timeout: 15_000, waitUntil: "domcontentloaded" }), next.click({ timeout: 5_000 })]);
    return;
  } catch {
    /* no "Next" to click: opened directly below */
  }
  await tab.goto(googleResultsUrl(params, n), { waitUntil: "domcontentloaded", referer: before });
}

/**
 * Google asked for a CAPTCHA: waited for until it's solved in the browser window (by you or the
 * profile's extension), past CAPTCHA_WAIT_MS while it's being solved. True once solved; false when the
 * visit was stopped. Not solved: CaptchaTimeoutError (the visit reopens the browser on the same IP,
 * runVisitTest), or CaptchaRefusedError (Google won't give this IP one: a new IP).
 */
async function solveCaptcha(tab: Page, send: VisitOptions["send"], signal: AbortSignal): Promise<boolean> {
  send({ type: "stage", stage: "captcha" });
  send({ type: "step", message: `Google asked for a CAPTCHA. Solve it in the browser window (or let an extension do it): waiting up to ${CAPTCHA_WAIT_MS / 1000}s, longer while it's being solved…` });
  send({ type: "wait", seconds: CAPTCHA_WAIT_MS / 1000, reason: "the CAPTCHA to be solved in the browser window" });
  // While it's being solved (something in it keeps changing), the wait goes on past CAPTCHA_WAIT_MS.
  const watch = watchCaptcha(tab);
  const end = await waitForCaptcha(async () => (tab.isClosed() ? "closed" : googleBlocked(tab.url(), !!(await tab.$("#captcha-form"))) === "captcha"), {
    activity: watch.read,
    onBusy: () => {
      send({ type: "step", message: `The CAPTCHA is still being solved: waiting on while something changes in it (until it stops for ${CAPTCHA_STALL_MS / 1000}s, ${CAPTCHA_MAX_MS / 60_000} min at most)…` });
      send({ type: "waited" });
      send({ type: "wait", seconds: null, reason: "the CAPTCHA being solved (still in progress)" });
    },
  }).finally(watch.stop);
  send({ type: "waited" });
  if (end === "solved") {
    send({ type: "step", message: "The CAPTCHA was solved; reading Google's results…" });
    return true;
  }
  if (signal.aborted) return false;
  // Its tab (or the browser) was closed while waiting: the visit can't go on in it; tried again.
  if (tab.isClosed()) throw new GoogleBlockedError("The browser window was closed while waiting for the CAPTCHA");
  // What was showing then (still Google's CAPTCHA, another one after it…): its address and a picture.
  send({ type: "step", message: `Still on ${tab.url().slice(0, 100)}${await saveShot(tab)}.` });
  const why = {
    idle: `The CAPTCHA wasn't solved, and nothing happened in it for ${CAPTCHA_WAIT_MS / 1000}s`,
    stuck: `The CAPTCHA's solving stopped (nothing changed in it for ${CAPTCHA_STALL_MS / 1000}s)`,
    "too-long": `The CAPTCHA was still being solved after ${CAPTCHA_MAX_MS / 60_000} min`,
    refused: "Google won't give this IP a CAPTCHA to solve (“try again later”)",
    closed: "The CAPTCHA wait was stopped",
  }[end];
  // Refused: this IP can't get through at all, so it isn't tried again (runVisitTest).
  throw end === "refused" ? new CaptchaRefusedError(why) : new CaptchaTimeoutError(why);
}

/**
 * TEMPORARY (testing): true = a CAPTCHA not solved the first time opens the site directly by its URL.
 * Remove once there's a proper solution for Google's CAPTCHA (campaign visits must click the result).
 */
const TEMP_OPEN_DIRECTLY_ON_CAPTCHA = false;

/** How many of Google's results pages the site is looked for on before it's "not on Google". */
const SEARCH_PAGES = 3;

/**
 * CAPTCHAs in a row (another right after one is solved) on one results page: each is solved, up to
 * this many; only a safety stop so a Google that never stops asking can't hold the visit forever.
 */
const CAPTCHAS_PER_PAGE = 10;

/** How long Google's results page has to show its results (e.g. still loading after a CAPTCHA). */
const RESULTS_WAIT_MS = 15_000;

/** How many browsers a visit opens on one proxy IP for an unsolved CAPTCHA, before getting a new IP. */
const CAPTCHA_TRIES = 3;

/** The CAPTCHA wasn't solved (nothing happening in it, or its solving stopped): the browser is reopened on the same IP. */
class CaptchaTimeoutError extends GoogleBlockedError {}

/** Google won't give this IP a CAPTCHA to solve ("try again later"): it gets a new IP at once. */
class CaptchaRefusedError extends GoogleBlockedError {}

/**
 * Watches the CAPTCHA in Google's page, to tell whether it's being solved (by a person or an
 * extension): read() gives what it shows now as text (requests to reCAPTCHA so far, the checkbox,
 * the challenge, its pictures, tiles picked, the answer typed, an error), which changes while it's
 * solved; "refused" when reCAPTCHA says to try again later (it won't give this IP a challenge).
 */
function watchCaptcha(tab: Page): { read: () => Promise<string>; stop: () => void } {
  let requests = 0;
  const onRequest = (r: { url(): string }) => {
    if (/\/recaptcha\//.test(r.url())) requests++;
  };
  tab.on("request", onRequest);
  return {
    async read() {
      const frames = tab.frames().filter((f) => /\/recaptcha\/(api2|enterprise)\/(anchor|bframe)/.test(f.url()));
      const states = await Promise.all(frames.map((f) => f.evaluate(readCaptchaFrame).catch(() => "")));
      return states.includes("refused") ? "refused" : `${requests}#${states.join("#")}`;
    },
    stop: () => void tab.off("request", onRequest),
  };
}

/**
 * Runs inside one of reCAPTCHA's frames (its checkbox, or its challenge): what it shows, as text, or
 * "refused" for its "try again later" page. Self-contained: it's sent to the page as text.
 */
function readCaptchaFrame(): string {
  const shown = (s: string) => Array.from(document.querySelectorAll(s)).some((e) => e.getClientRects().length > 0);
  if (shown(".rc-doscaptcha-header")) return "refused";
  const box = document.querySelector("#recaptcha-anchor");
  return [
    box?.getAttribute("aria-checked") ?? "",
    box?.className ?? "",
    document.querySelector(".rc-imageselect-instructions")?.textContent ?? "",
    document.querySelector("#rc-imageselect-target img")?.getAttribute("src") ?? "",
    document.querySelectorAll(".rc-imageselect-tileselected").length,
    (document.querySelector("#audio-response") as HTMLInputElement | null)?.value ?? "",
    document.querySelector(".rc-audiochallenge-tdownload-link")?.getAttribute("href") ?? "",
    document.querySelector(".rc-audiochallenge-error-message")?.textContent ?? "",
  ].join("|");
}

/**
 * Runs inside Google's results page: how many organic results it shows, and the site's results on it
 * (host, without www; never ads), each marked with data-sa-link="<index>" so the visit can click it.
 * Two layouts: results that are links (<a href>), and Google's layout without them (the title is a
 * role="link" element opened by Google's script; where it goes is only the address shown above it,
 * "https://www.site.org › …"). Then any other link to the site (sitelinks, a phone's layout). Each
 * result: its title, its href when it has one, and its place among the organic results.
 * Self-contained: it's sent to the page as text.
 */
function findSiteResults(host: string): { organic: number; titles: number; links: { text: string; href: string | null; position: number | null }[] } {
  const hostOf = (s: string): string | null => {
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      const real = /(^|\.)google\./.test(u.hostname) && u.pathname === "/url" ? new URL(u.searchParams.get("q") ?? u.searchParams.get("url") ?? "") : u;
      return real.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return null;
    }
  };
  const isSite = (h: string | null) => !!h && (h === host || h.endsWith(`.${host}`));
  const isAd = (el: Element) => !!el.closest("#tads, #bottomads, [data-text-ad]");
  const shown = (el: Element) => el.getClientRects().length > 0;
  // An address as Google shows it above a result, the start of a line: "https://www.site.org › page",
  // "site.org"… (a title or a snippet doesn't start with one).
  const ADDRESS = /^(https?:\/\/)?[\w-]+(\.[\w-]+)*\.[a-z]{2,}$/i;
  const addressIn = (text: string | null | undefined): string | null => {
    const first = (text ?? "").trim().split(/\s|›/)[0];
    return first && ADDRESS.test(first) ? hostOf(first) : null;
  };
  const shownHost = (heading: Element): string | null => {
    // The nearest block around the title that shows an address (not so far up it's the next result's):
    // a <cite>, or an element with no others inside whose text is the address.
    for (let e = heading.parentElement, up = 0; e && up < 5; e = e.parentElement, up++) {
      const found = [e.querySelector("cite"), ...Array.from(e.querySelectorAll("span, div")).filter((s) => s.children.length === 0)]
        .map((s) => addressIn(s?.textContent))
        .find(Boolean);
      if (found) return found;
    }
    return null;
  };
  document.querySelectorAll("[data-sa-link]").forEach((e) => e.removeAttribute("data-sa-link"));
  const marked: Element[] = [];
  const links: { text: string; href: string | null; position: number | null }[] = [];
  const mark = (el: Element, text: string, href: string | null, position: number | null) => {
    if (marked.includes(el)) return;
    el.setAttribute("data-sa-link", String(links.length));
    marked.push(el);
    links.push({ text: text.trim().slice(0, 100), href, position });
  };
  const root = document.querySelector("#rso") ?? document.querySelector("#search") ?? document.body;
  let organic = 0;
  const titles = Array.from(root.querySelectorAll("h3, [role='heading'][aria-level='3']"));
  for (const h of titles) {
    if (isAd(h) || !shown(h)) continue;
    const a = h.closest<HTMLAnchorElement>("a[href]") ?? h.querySelector<HTMLAnchorElement>("a[href]");
    const clickable = a ?? h.querySelector("[role='link']") ?? h.closest("[role='link']");
    if (!clickable) continue;
    // Where it goes: its link's host, unless that's Google's own redirect (/goto?url=<encrypted>…),
    // then the address Google shows with it.
    const linked = a && /^https?:\/\//i.test(a.getAttribute("href") ?? "") ? hostOf(a.href) : null;
    const target = linked && !/(^|\.)google\./.test(linked) ? linked : shownHost(h);
    if (!target || /(^|\.)google\./.test(target)) continue;
    organic++;
    if (isSite(target)) mark(clickable, h.textContent ?? "", a ? a.href : null, organic);
  }
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (!isAd(a) && shown(a) && isSite(hostOf(a.href))) mark(a, a.textContent ?? "", a.href, null);
  }
  return { organic, titles: titles.length, links };
}

/** findSiteResults in the tab; nothing found when the page can't be read (e.g. it's moving on), and why. */
async function readSiteResults(tab: Page, host: string): Promise<ReturnType<typeof findSiteResults> & { error?: string }> {
  return tab.evaluate(findSiteResults, host).catch((err) => ({ organic: 0, titles: 0, links: [], error: friendly(err) }));
}

/**
 * Clicks the site's result on Google's results page (as a person would: Google is the referer), in
 * the same tab, and resolves once the site's page has its content (DOMContentLoaded). A click that
 * doesn't open the site is tried again, CLICK_TRIES times in all, each on a different one of the
 * site's results when Google shows several (back to the first when there are fewer) and each a
 * different way (the mouse on it, the mouse moved there by hand, the keyboard); only then is the site
 * opened in this tab directly (the result's href, else the site), still from Google (its referer).
 */
async function clickResult(tab: Page, siteUrl: string, say: (message: string) => void): Promise<{ status(): number } | null> {
  const googleUrl = tab.url();
  const host = new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase();
  const offGoogle = (u: URL) => !/(^|\.)google\./.test(u.hostname);
  let fallback: string | null = null;
  let firstText: string | null = null;
  for (let attempt = 1; attempt <= CLICK_TRIES; attempt++) {
    // A try that left the results for another Google page (a redirect notice…): back to the results.
    if (attempt > 1 && tab.url() !== googleUrl) {
      await tab.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
      if (tab.url() !== googleUrl) await tab.goto(googleUrl, { waitUntil: "domcontentloaded", referer: googleUrl }).catch(() => null);
    }
    // In this tab, never a new one: no target on the links, and Google's own window.open goes here too.
    await tab
      .evaluate(() => {
        document.querySelectorAll("a[target]").forEach((a) => a.removeAttribute("target"));
        window.open = (u?: string | URL) => {
          if (u) location.href = String(u);
          return null;
        };
      })
      .catch(() => {});
    const { links } = await readSiteResults(tab, host);
    // Try n on the site's n-th result; back to the first when there are fewer.
    const i = links[attempt - 1] ? attempt - 1 : 0;
    const pick = links[i];
    fallback ??= links.find((l) => l.href)?.href ?? null;
    firstText ??= links[0]?.text ?? null;
    const el = pick ? await tab.$(`[data-sa-link="${i}"]`) : null;
    if (!pick || !el) {
      say(`Click ${attempt} of ${CLICK_TRIES}: the site's result isn't on Google's results page${attempt < CLICK_TRIES ? "; trying again…" : "."}`);
      continue;
    }
    if (attempt > 1) say(`Click ${attempt} of ${CLICK_TRIES}: ${i === 0 ? "the site's first result again" : `another of the site's results (“${pick.text}”)`}…`);
    const nav = tab.waitForNavigation({ url: offGoogle, waitUntil: "domcontentloaded" });
    nav.catch(() => {}); // not waited for when the click did nothing (below)
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
      if (attempt === 1) {
        await el.click({ timeout: 10_000 });
      } else if (attempt === 2) {
        // The mouse moved onto it in small steps, then pressed: nothing in the way is waited for.
        const box = await el.boundingBox();
        if (!box) throw new Error("the result isn't visible");
        const x = box.x + Math.min(box.width / 2, 40 + Math.random() * 40);
        const y = box.y + box.height / 2;
        await tab.mouse.move(x, y, { steps: 12 });
        await tab.mouse.click(x, y, { delay: 60 + Math.random() * 80 });
      } else {
        await el.focus();
        await tab.keyboard.press("Enter");
      }
    } catch (err) {
      say(`Click ${attempt} of ${CLICK_TRIES} on the site's result didn't work (${friendly(err)})${attempt < CLICK_TRIES ? "; trying again…" : "."}`);
      continue;
    }
    const moved = await Promise.race([nav.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), CLICK_WAIT_MS))]);
    if (moved || offGoogle(new URL(tab.url()))) return nav;
    say(`Click ${attempt} of ${CLICK_TRIES} on the site's result didn't open it in ${CLICK_WAIT_MS / 1000}s${attempt < CLICK_TRIES ? "; clicking again…" : "."}`);
  }
  const direct = fallback ?? siteUrl;
  say(`The site's result${firstText ? ` (“${firstText}”)` : ""} didn't open after ${CLICK_TRIES} clicks: opening ${direct.slice(0, 100)} directly, from Google's results page.`);
  return tab.goto(direct, { waitUntil: "domcontentloaded", referer: googleUrl });
}

/** A screenshot of the tab in the temp folder, for a step message: " · screenshot <path>", or "". */
async function saveShot(tab: Page): Promise<string> {
  const file = path.join(os.tmpdir(), `site-auditor-google-${Date.now()}.png`);
  return tab.screenshot({ path: file, timeout: 5_000 }).then(() => ` · screenshot ${file}`, () => "");
}

/** The IP check at the end of a visit: at most this long. */
const END_CHECK_MS = 8_000;

/** How long each click on Google's result has to start opening the site before the next try. */
const CLICK_WAIT_MS = 15_000;

/** How many times the site's result on Google is clicked before it's opened directly (at least 3). */
const CLICK_TRIES = 3;

/** Downloads through the browser context, so it uses the same proxy as the visit. */
function proxiedFetcher(context: BrowserContext): SitemapFetcher {
  return async (url, accept) => {
    if (isBlockedHost(new URL(url).hostname)) throw new Error(`Blocked address: ${url}`);
    // As the visit's device (its pages' user agent), not the browser's own.
    const ua = await deviceUserAgent(context);
    const res = await context.request.get(url, { headers: { accept, ...(ua ? { "user-agent": ua } : {}) }, timeout: 20_000, maxRedirects: 5 });
    return { ok: res.ok(), finalUrl: res.url(), text: () => res.text() };
  };
}

/** Opens one page, scrolls to the bottom and records status, timing, errors and images. */
async function checkPage(
  page: Page,
  url: string,
  kind: VisitPage["kind"],
  navigate: () => Promise<{ status(): number } | null>,
  scrollOpts: typeof PAGE_SCROLL,
  /** Read the page after it loads, until `until` (ms) at the latest: the end of the dwell time. */
  read: false | { until: number | null; maxSec: number } = false,
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
    // Not part of the load time: measured above. Cut short (dwell time up, stopped): no time recorded.
    if (read && result.ok) {
      const r = await readPage(page, read.until, read.maxSec).catch(() => null);
      if (r) [result.readSec, result.readScrolls] = [r.sec, r.scrolls];
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

/** Stays on the page as if reading it: a pause from its amount of text, with a small scroll every few seconds. Returns the seconds spent. */
async function readPage(page: Page, until: number | null, maxSec = READ_MAX_SEC): Promise<{ sec: number; scrolls: number }> {
  const words = await page.evaluate(() => (document.body?.innerText.match(/\S+/g) ?? []).length).catch(() => 0);
  const base = Math.min(maxSec / 1.4, READ_BASE_SEC + words / READ_WORDS_PER_SEC); // up to 1.4x below: never over maxSec
  const started = Date.now();
  let scrolls = 0;
  const ends = Math.min(started + Math.round(base * (0.6 + Math.random() * 0.8) * 1000), until ?? Infinity);
  for (;;) {
    await page.waitForTimeout(Math.max(0, Math.min(ends - Date.now(), 1500 + Math.random() * 3500)));
    if (Date.now() >= ends) break;
    // Mostly down the page, sometimes back up a little.
    const dy = Math.round((Math.random() < 0.75 ? 1 : -1) * (120 + Math.random() * 380));
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), dy);
    scrolls++;
  }
  return { sec: Math.round((Date.now() - started) / 1000), scrolls };
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
async function checkMobile(page: Page, url: string): Promise<MobileCheck> {
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
  } catch (err) {
    out.error = friendly(err);
  }
  return out;
}

/** On a phone: finds the menu button (☰), taps it and checks the menu opens with links. */
async function mobileMenu(page: Page): Promise<NonNullable<MenuCheck["mobile"]>> {
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
  return { buttonFound: true, opened, linksShown: shown, note: opened ? undefined : "The menu button was tapped, but no menu links appeared." };
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
