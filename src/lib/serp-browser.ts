// Server-only, local only: Google results read in a real browser (Puppeteer) through the Vietnam
// proxy, instead of a paid SERP API. It only searches and reads the result list: it never clicks a
// result. Before searching it checks the proxy's IP: in Vietnam, and not this computer's own IP.
// Google sometimes answers a proxy IP with a CAPTCHA; then the search fails, and the daily check
// tries again later that day (src/lib/campaigns/scheduler.ts).

import { existsSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import { NO_WEBRTC_ARGS, NO_WEBRTC_SCRIPT } from "./no-webrtc";
import { getProxyOrReuse } from "./proxy-api";
import { lookupExit, ownPublicIp } from "./proxy-ip";
import { resolveProxyApi } from "./proxy-settings";

/** The proxy's country: browser searches are only right for this one. */
export const BROWSER_SEARCH_COUNTRY = "VN";

const NAV_TIMEOUT = 30_000;

/** Browsers already installed on this computer, tried in order. */
const BROWSER_PATHS = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
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

/** Opens a browser through a proxy from the proxy API; close() when done. */
export async function openBrowserSearch(): Promise<BrowserSearch> {
  const apiUrl = await resolveProxyApi(undefined);
  if (!apiUrl) throw new Error("no proxy API link saved (Settings)");
  const executablePath = BROWSER_PATHS.find((p): p is string => !!p && existsSync(p));
  if (!executablePath) throw new Error("no browser found (install Microsoft Edge or Google Chrome)");

  const proxy = await getProxyOrReuse(apiUrl);
  // Loaded only here: the browser library isn't available on Vercel.
  const puppeteer = await import("puppeteer-core");
  const browser: Browser = await puppeteer.launch({
    executablePath,
    // Headed: a visible browser window, like a person searching.
    headless: false,
    args: [
      `--proxy-server=${proxy.server}`,
      // WebRTC could otherwise go around the proxy and show this computer's IP (src/lib/no-webrtc.ts).
      ...NO_WEBRTC_ARGS,
      "--lang=vi-VN",
    ],
  });

  // Where the searches really come from, before any search: wrong or unknown, no search at all.
  try {
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

        const blocked = googleBlocked(tab.url(), !!(await tab.$("#captcha-form")));
        if (blocked) throw new Error(blocked === "captcha" ? `Google asked for a CAPTCHA (proxy ${proxy.address})` : "Google showed its cookie consent page");
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
