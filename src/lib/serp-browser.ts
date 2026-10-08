// Server-only, local only: Google results read in a real browser (Puppeteer) through the Vietnam
// proxy, instead of a paid SERP API. It only searches and reads the result list: it never clicks a
// result. Before searching it checks the proxy's IP: in Vietnam, and not this computer's own IP.
// Google sometimes answers a proxy IP with a CAPTCHA: the search waits (CAPTCHA_WAIT_MS) for it to be
// solved in the browser window, by a person or an extension of the Chrome profile; the app itself
// doesn't touch it. Still there after that: the search fails, and the daily check tries again later
// that day (src/lib/campaigns/scheduler.ts).

import { existsSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import { NO_WEBRTC_ARGS, NO_WEBRTC_SCRIPT } from "./no-webrtc";
import { ProxyWaitError, getProxyOrReuse, type ProxyConfig } from "./proxy-api";
import { leaseProxyApi, restProxyApi } from "./proxy-pool";
import { checkChromeProfile, chromeExecutable, leaseChromeProfile, PROFILE_ARGS, KEEP_EXTENSIONS, profileLockedMessage, type ProfileLease } from "./browser-profile";
import { lookupExit, ownPublicIp } from "./proxy-ip";

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
 */
export async function openBrowserSearch(): Promise<BrowserSearch> {
  const executablePath = BROWSER_PATHS.find((p): p is string => !!p && existsSync(p));
  if (!executablePath) throw new Error("no browser found (install Google Chrome or Microsoft Edge)");

  const waitFor = AbortSignal.timeout(LEASE_WAIT_MS);
  for (;;) {
    let profile: ProfileLease | null = null;
    const lease = await leaseProxyApi(waitFor).catch((err: unknown) => {
      throw waitFor.aborted ? new Error(`every proxy link was busy with campaign visits for ${LEASE_WAIT_MS / 60_000} minutes`) : err;
    });
    try {
      const proxy = await getProxyOrReuse(lease.apiUrl);
      // Its own Chrome profile folder, when one is set (Settings): never one another browser has open.
      profile = await leaseChromeProfile("ranking");
      // A saved Chrome profile: Google Chrome only (never Edge).
      const chrome = profile ? chromeExecutable() : executablePath;
      if (!chrome) throw new Error("a Chrome profile is saved (Settings), but Google Chrome isn't installed on this computer");
      const search = await openWithProxy(chrome, proxy, profile?.dir);
      const held = profile;
      return {
        page: search.page,
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

  // Where the searches really come from, before any search: wrong or unknown, no search at all.
  try {
    // A saved Chrome profile: make sure it's Chrome on that profile.
    if (profileDir) console.log(`[ranking] ${await checkChromeProfile(await browser.newPage(), profileDir)}`);
    const [exit, ownIp] = await Promise.all([
      lookupExit(async (url) => {
        const tab = await browser.newPage();
        try {
          if (proxy.username) await tab.authenticate({ username: proxy.username, password: proxy.password ?? "" });
          return await (await tab.goto(url, { timeout: NAV_TIMEOUT }))?.json();
        } finally {
          await tab.close().catch(() => {});
        }
      }),
      ownPublicIp(),
    ]);
    if (!exit) throw new Error(`couldn't confirm the proxy's IP and country (proxy ${proxy.address})`);
    if (ownIp && exit.ip === ownIp) throw new Error(`the search would come from this computer's own IP (${ownIp}), not the proxy`);
    if (exit.countryCode !== BROWSER_SEARCH_COUNTRY) throw new Error(`the proxy's IP (${exit.ip}) is in ${exit.country ?? "an unknown country"}, not Vietnam`);
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }

  return {
    async page(p, n) {
      const tab = await browser.newPage();
      try {
        if (proxy.username) await tab.authenticate({ username: proxy.username, password: proxy.password ?? "" });
        await tab.evaluateOnNewDocument(NO_WEBRTC_SCRIPT);
        await tab.emulateTimezone("Asia/Ho_Chi_Minh");
        await tab.setViewport({ width: 1366, height: 768 });
        await tab.goto(googleResultsUrl(p, n), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

        let blocked = googleBlocked(tab.url(), !!(await tab.$("#captcha-form")));
        if (blocked === "captcha") {
          console.log(`[ranking] Google asked for a CAPTCHA (proxy ${proxy.address}): waiting up to ${CAPTCHA_WAIT_MS / 60_000} min for it to be solved in the browser window…`);
          blocked = (await waitForCaptcha(async () => (tab.isClosed() ? "closed" : googleBlocked(tab.url(), !!(await tab.$("#captcha-form"))) === "captcha"))) ? null : "captcha";
        }
        if (blocked) throw new Error(blocked === "captcha" ? `Google asked for a CAPTCHA and it wasn't solved (proxy ${proxy.address})` : "Google showed its cookie consent page");
        await tab.waitForSelector("#search", { timeout: 10_000 }).catch(() => {});
        return await tab.evaluate(readOrganicResults);
      } finally {
        await tab.close().catch(() => {});
      }
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

/** How long a search waits for a CAPTCHA to be solved in the browser window (by a person or an extension). */
export const CAPTCHA_WAIT_MS = 2 * 60_000;

/**
 * Waits until the CAPTCHA is gone (Google then goes on to the results), checking every 2 seconds, for
 * up to CAPTCHA_WAIT_MS. True when it's gone; false when it's still there, or the tab was closed
 * ("closed": the visit or check was stopped, so no more waiting).
 */
export async function waitForCaptcha(stillThere: () => Promise<boolean | "closed">): Promise<boolean> {
  const until = Date.now() + CAPTCHA_WAIT_MS;
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
