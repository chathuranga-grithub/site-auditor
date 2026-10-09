// Server-only, local only: Google results read in a real browser (Puppeteer) through the Vietnam
// proxy, instead of a paid SERP API. It only searches and reads the result list: it never clicks a
// result. Before searching it checks the proxy's IP: in Vietnam, and not this computer's own IP.
// Google sometimes answers a proxy IP with a CAPTCHA: the search waits (CAPTCHA_WAIT_MS) for it to be
// solved in the browser window, by a person or an extension of the Chrome profile; the app itself
// doesn't touch it. Still there after that: the search fails (a campaign visit then opens the site
// directly, in the same browser; a ranking check is tried again later that day).
// One Google search at a time across all the app's browsers: src/lib/google-turn.ts.

import { existsSync } from "node:fs";
import type { Browser, Page, Target } from "puppeteer-core";
import { NO_WEBRTC_ARGS, NO_WEBRTC_SCRIPT } from "./no-webrtc";
import { ProxyWaitError, burnProxy, getProxy, getProxyOrReuse, type ProxyConfig } from "./proxy-api";
import { takeGoogleTurn } from "./google-turn";
import { leaseProxyApi, restProxyApi } from "./proxy-pool";
import { checkChromeProfile, chromeExecutable, leaseChromeProfile, PROFILE_ARGS, KEEP_EXTENSIONS, profileExtensionDirs, profileLockedMessage, type ProfileLease } from "./browser-profile";
import { fetchJsonInPage, lookupExit, ownPublicIp } from "./proxy-ip";

/** The proxy's country: browser searches are only right for this one. */
export const BROWSER_SEARCH_COUNTRY = "VN";

const NAV_TIMEOUT = 30_000;

/** Browsers already installed on this computer, tried in order. */
const BROWSER_PATHS = [
  process.env.BROWSER_PATH,
  // Google Chrome first, else Microsoft Edge.
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

/** Browser searches need a real browser: only when the app runs on a computer. */
export const canSearchInBrowser = () => !process.env.VERCEL;

export interface BrowserSearchParams {
  q: string;
  gl: string;
  hl: string;
}

export interface BrowserResult {
  title: string;
  link: string;
  snippet: string;
}

export interface BrowserSearch {
  /** One Google results page (1 = top 10, 2 = 11–20). */
  page(p: BrowserSearchParams, n: number): Promise<BrowserResult[]>;
  close(): Promise<void>;
}

/** How long a search waits for a proxy link that isn't busy with a campaign visit. */
const LEASE_WAIT_MS = 5 * 60_000;

/**
 * Opens a browser through a proxy from one of the proxy API links (src/lib/proxy-pool.ts: a link no
 * visit is using, so getting a proxy doesn't change a running visit's IP); close() when done.
 * newIp: never the IP used before (trying again after a CAPTCHA).
 */
export async function openBrowserSearch({ newIp = false, signal }: { newIp?: boolean; signal?: AbortSignal } = {}): Promise<BrowserSearch> {
  const executablePath = BROWSER_PATHS.find((p): p is string => !!p && existsSync(p));
  if (!executablePath) throw new Error("no browser found (install Google Chrome or Microsoft Edge)");

  // Gives up waiting for a proxy link after LEASE_WAIT_MS, or when stopped.
  const timeout = AbortSignal.timeout(LEASE_WAIT_MS);
  const waitFor = signal ? AbortSignal.any([timeout, signal]) : timeout;
  for (;;) {
    let profile: ProfileLease | null = null;
    const lease = await leaseProxyApi(waitFor).catch((err: unknown) => {
      throw timeout.aborted ? new Error(`every proxy link was busy with campaign visits for ${LEASE_WAIT_MS / 60_000} minutes`) : signal?.aborted ? new Error("stopped") : err;
    });
    try {
      const proxy = newIp ? await getProxy(lease.apiUrl) : await getProxyOrReuse(lease.apiUrl);
      // Its own Chrome profile folder, when one is set (Settings): never one another browser has open.
      profile = await leaseChromeProfile("ranking");
      // A saved Chrome profile: Google Chrome only (never Edge).
      const chrome = profile ? chromeExecutable() : executablePath;
      if (!chrome) throw new Error("a Chrome profile is saved (Settings), but Google Chrome isn't installed on this computer");
      const search = await openWithProxy(chrome, proxy, profile?.dir);
      const held = profile;
      return {
        // One Google search at a time across all the app's browsers (src/lib/google-turn.ts); an IP
        // Google showed a CAPTCHA is never given to a visit.
        page: async (p, n) => {
          const release = await takeGoogleTurn(signal, () => console.log("[ranking] waiting for another browser to finish its Google search…"));
          try {
            return await search.page(p, n);
          } catch (err) {
            if (err instanceof GoogleBlockedError) burnProxy(lease.apiUrl, proxy.address);
            throw err;
          } finally {
            release();
          }
        },
        close: () =>
          search.close().finally(() => {
            held?.release();
            lease.release();
          }),
      };
    } catch (err) {
      profile?.release();
      lease.release();
      // That link only gives a new IP later (and has none to reuse): rest it and try another.
      if (err instanceof ProxyWaitError) {
        restProxyApi(lease.apiUrl, err.waitSec);
        continue;
      }
      throw err;
    }
  }
}

async function openWithProxy(executablePath: string, proxy: ProxyConfig, profileDir?: string): Promise<BrowserSearch> {
  // Loaded only here: the browser library isn't available on Vercel.
  const puppeteer = await import("puppeteer-core");
  const browser: Browser = await puppeteer
    .launch({
      executablePath,
      // Headed: a visible browser window, like a person searching.
      headless: false,
      // A Chrome profile folder (Settings), else a fresh temporary profile. Extensions are never turned off.
      ...(profileDir ? { userDataDir: profileDir } : {}),
      ignoreDefaultArgs: KEEP_EXTENSIONS,
      // The profile's extensions, loaded from their files and switched on (Chrome drops a copied
      // profile's extensions: src/lib/browser-profile.ts).
      ...(profileDir ? { enableExtensions: await profileExtensionDirs(profileDir) } : {}),
      args: [
        `--proxy-server=${proxy.server}`,
        // WebRTC could otherwise go around the proxy and show this computer's IP (src/lib/no-webrtc.ts).
        ...NO_WEBRTC_ARGS,
        "--lang=vi-VN",
        ...(profileDir ? PROFILE_ARGS : []),
      ],
    })
    .catch((err: unknown) => {
      // Open in another Chrome window: say so plainly.
      const locked = profileDir ? profileLockedMessage(err, profileDir) : null;
      throw locked ? new Error(locked) : err;
    });
  // Everything happens in the one tab Chrome starts with. Any other tab (e.g. Adobe Acrobat's welcome
  // page, opened by the extension itself) is closed at once.
  const tab: Page = (await browser.pages())[0] ?? (await browser.newPage());
  browser.on("targetcreated", async (target: Target) => {
    if (target.type() !== "page") return;
    const other = await target.page().catch(() => null);
    if (other && other !== tab) void other.close().catch(() => {});
  });

  // Where the searches really come from, before any search: wrong or unknown, no search at all.
  try {
    if (proxy.username) await tab.authenticate({ username: proxy.username, password: proxy.password ?? "" });
    await tab.evaluateOnNewDocument(NO_WEBRTC_SCRIPT);
    await tab.emulateTimezone("Asia/Ho_Chi_Minh");
    await tab.setViewport({ width: 1366, height: 768 });
    // A saved Chrome profile: make sure it's Chrome on that profile.
    if (profileDir) console.log(`[ranking] ${await checkChromeProfile(tab, profileDir)}`);
    const [exit, ownIp] = await Promise.all([tab.goto("about:blank").then(() => lookupExit((url) => tab.evaluate(fetchJsonInPage, url))), ownPublicIp()]);
    if (!exit) throw new Error(`couldn't confirm the proxy's IP and country (proxy ${proxy.address})`);
    if (ownIp && exit.ip === ownIp) throw new Error(`the search would come from this computer's own IP (${ownIp}), not the proxy`);
    if (exit.countryCode !== BROWSER_SEARCH_COUNTRY) throw new Error(`the proxy's IP (${exit.ip}) is in ${exit.country ?? "an unknown country"}, not Vietnam`);
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }

  return {
    async page(p, n) {
      await tab.goto(googleResultsUrl(p, n), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

      let blocked = googleBlocked(tab.url(), !!(await tab.$("#captcha-form")));
      if (blocked === "captcha") {
        console.log(`[ranking] Google asked for a CAPTCHA (proxy ${proxy.address}): waiting up to ${CAPTCHA_WAIT_MS / 1000}s for it to be solved in the browser window…`);
        blocked = (await waitForCaptcha(async () => (tab.isClosed() ? "closed" : googleBlocked(tab.url(), !!(await tab.$("#captcha-form"))) === "captcha"))) ? null : "captcha";
      }
      // The browser was closed (by hand, or the app stopping): the check ends, it isn't tried again.
      if (tab.isClosed() || !browser.connected) throw new Error("the browser was closed");
      if (blocked === "captcha") throw new GoogleBlockedError(`Google asked for a CAPTCHA and it wasn't solved in ${CAPTCHA_WAIT_MS / 1000}s (proxy ${proxy.address})`);
      if (blocked) throw new GoogleBlockedError("Google showed its cookie consent page instead of results");
      await tab.waitForSelector("#search", { timeout: 10_000 }).catch(() => {});
      return await tab.evaluate(readOrganicResults);
    },
    close: () => browser.close().catch(() => {}),
  };
}

/** The Google results page for a search (page 1 = top 10, 2 = 11–20). Shared with campaign visits. */
export function googleResultsUrl(p: BrowserSearchParams, n = 1): string {
  const url = new URL("https://www.google.com/search");
  url.search = new URLSearchParams({ q: p.q, gl: p.gl, hl: p.hl, num: "10", pws: "0", ...(n > 1 ? { start: String((n - 1) * 10) } : {}) }).toString();
  return url.toString();
}

/**
 * How long a search waits for a CAPTCHA to be solved in the browser window (by a person or an
 * extension), before giving up on the search.
 */
export const CAPTCHA_WAIT_MS = 30_000;

/**
 * Google didn't show results (a CAPTCHA not solved in CAPTCHA_WAIT_MS, its consent page, the search
 * failing): nothing is skipped, the browser is closed and the search tried again in a new one with a
 * new proxy IP, until it gets through (ranking checks: src/lib/serp.ts; visits: src/lib/campaigns/visits.ts).
 */
export class GoogleBlockedError extends Error {}

/**
 * Waits until the CAPTCHA is gone (Google then goes on to the results), checking every 2 seconds, for
 * up to waitMs (CAPTCHA_WAIT_MS; Infinity = until it's solved). True when it's gone; false when it's
 * still there, or the tab was closed ("closed": the visit or check was stopped, so no more waiting).
 */
export async function waitForCaptcha(stillThere: () => Promise<boolean | "closed">, waitMs = CAPTCHA_WAIT_MS): Promise<boolean> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const there = await stillThere();
      if (there === "closed") return false;
      if (!there) return true;
    } catch {
      /* the page is moving on (Google redirecting to the results): check again */
    }
  }
  return false;
}

/** Why Google didn't show results, from the page's URL and whether it has a CAPTCHA form; null when it did. */
export function googleBlocked(at: string, captchaForm: boolean): "captcha" | "consent" | null {
  if (at.includes("/sorry/") || captchaForm) return "captcha";
  if (at.includes("consent.google.")) return "consent";
  return null;
}

/**
 * Runs inside the results page (Puppeteer or Playwright evaluate): the organic results, links with
 * a heading inside the results column (ads sit outside it). Self-contained: it's sent to the page as text.
 */
export function readOrganicResults(): BrowserResult[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("#search a[href]"))
    .filter((a) => a.querySelector("h3") && /^https?:/.test(a.href) && !/(^|\.)google\./.test(new URL(a.href).hostname))
    .map((a) => {
      const block = a.closest("[data-hveid], .g") ?? a.parentElement;
      const snippet = block?.querySelector<HTMLElement>("[data-sncf], .VwiC3b")?.innerText ?? "";
      return { title: a.querySelector("h3")!.textContent?.trim() ?? "", link: a.href, snippet: snippet.trim() };
    });
}
