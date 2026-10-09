// Server-only, local only: Google's cookies, kept between campaign visits. Each visit's browser starts
// from a fresh copy of the saved Chrome profile (src/lib/browser-profile.ts), so the cookies Google set
// in the last one (including the one that lets a browser through after a solved CAPTCHA) would be lost,
// and every visit would look like a brand-new browser. They're saved per proxy IP after a search
// (Google ties its CAPTCHA pass to the IP) and put back in the next browser on that IP.
// In %LOCALAPPDATA%\SiteAuditor\google-cookies.json, so a restart of the app keeps them too.

import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Cookie } from "playwright-core";

const FILE = path.join(process.env.LOCALAPPDATA ?? process.cwd(), "SiteAuditor", "google-cookies.json");

/** An IP's cookies are kept this long after they were last saved. */
const KEEP_MS = 7 * 24 * 60 * 60_000;

/** Google's own sites (its search, and the accounts / consent pages it sends cookies from). */
const GOOGLE_URLS = ["https://www.google.com", "https://google.com", "https://accounts.google.com", "https://consent.google.com"];

type Saved = Record<string, { savedAt: number; cookies: Cookie[] }>;

// Reads and writes one at a time (two visits finishing together don't lose each other's cookies).
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function load(): Promise<Saved> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Saved;
  } catch {
    return {};
  }
}

/** A cookie still valid now (session cookies, without an end, count as valid). */
const valid = (c: Cookie) => c.expires <= 0 || c.expires * 1000 > Date.now();

/** Puts back the Google cookies saved for this IP into the browser; how many (0: none saved). */
export function restoreGoogleCookies(context: BrowserContext, ip: string): Promise<number> {
  return inTurn(async () => {
    const entry = (await load())[ip];
    if (!entry || Date.now() - entry.savedAt > KEEP_MS) return 0;
    const cookies = entry.cookies.filter(valid);
    if (cookies.length) await context.addCookies(cookies).catch(() => {});
    return cookies.length;
  });
}

/** Saves the browser's Google cookies for this IP (and drops IPs not saved for KEEP_MS). */
export function saveGoogleCookies(context: BrowserContext, ip: string): Promise<void> {
  return inTurn(async () => {
    const cookies = (await context.cookies(GOOGLE_URLS).catch(() => [])).filter(valid);
    if (!cookies.length) return;
    const saved = await load();
    for (const [key, e] of Object.entries(saved)) if (Date.now() - e.savedAt > KEEP_MS) delete saved[key];
    saved[ip] = { savedAt: Date.now(), cookies };
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(saved));
  }).catch(() => {});
}
