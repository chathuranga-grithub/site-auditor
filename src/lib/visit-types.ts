// Shared types for campaign visits (local only): one real-browser visit to every page
// of a company site through a proxy, scrolling each page, to check the site works for a
// visitor in that location.

/** Safety ceiling on pages per run (the proxy is only valid for about 30 minutes). */
export const MAX_PAGES = 500;

/** Country the visit must come from. The test stops before visiting pages if it doesn't. */
export const EXPECTED_COUNTRY = "VN";

import type { NetworkType } from "./network-type";

/** What the visit is made on: a desktop browser, or a phone (phone screen, touch, phone browser). */
export type VisitDevice = "desktop" | "phone";

/** Proxy returned by the proxy provider's API. */
export interface ProxyInfo {
  /** "host:port" */
  address: string;
  /** Provider's location label, e.g. "hp". */
  location: string | null;
  /** Seconds until the provider rotates the IP, if it says. */
  nextChangeSec: number | null;
  usesLogin: boolean;
  /** True when the provider said "wait for a new IP" and the previous, still-valid proxy was reused. */
  reused?: boolean;
}

/** Where the visit really came from, as seen by an IP lookup service. */
export interface ExitInfo {
  ip: string;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  /** Network / ISP, e.g. "AS7552 Viettel Group". */
  org: string | null;
  /** Residential (home / mobile ISP) or datacenter, guessed from the ISP name. */
  network: NetworkType;
  /** How long the IP lookup took through the proxy: a quick speed reading of the proxy. */
  lookupMs: number | null;
}

export interface VisitPage {
  kind: "start" | "internal";
  /** URL we meant to open. */
  url: string;
  finalUrl: string;
  status: number | null;
  title: string | null;
  /** Full page load time (navigation start to load event). */
  loadMs: number | null;
  /** Time to first byte. */
  ttfbMs: number | null;
  ok: boolean;
  /** Where the page was found: a start-page link, the sitemap, or a link on another visited page. */
  foundIn?: "start page" | "sitemap" | "another page";
  /** Start-page links only: whether a visitor can click the link (visible, not covered). */
  clickable?: boolean;
  linkText?: string;
  note?: string;
  /** Phone check; undefined when it was turned off. */
  mobile?: MobileCheck | null;
  /** Start page only. */
  menus?: MenuCheck;
  /** Scrolled to the bottom and checked images (null when the page didn't load). */
  scroll?: ScrollResult | null;
  consoleErrors: string[];
  /** Seconds spent reading the page after it loaded (visits that read each page). */
  readSec?: number;
  /**
   * The page showed, but these files (e.g. a chat widget, tracker or video) were still loading
   * 30s later, so the browser never reported it fully loaded. A warning: visitors can use the page.
   */
  stillLoading?: string[];
  /** Same-site files (images, scripts, CSS…) that failed or returned 4xx/5xx. */
  failedRequests: string[];
  error?: string;
}

/** A page wider than the phone screen by more than this lets visitors scroll sideways. */
export const OVERFLOW_PX = 8;

/** The same page opened again on a phone-sized screen (touch, phone browser). */
export interface MobileCheck {
  ok: boolean;
  status: number | null;
  error?: string;
  /** How far the page is wider than the phone screen (0 = fits). Over a few pixels, visitors scroll sideways. */
  overflowPx: number;
  /** <meta name="viewport" content="width=device-width…">: without it phones show a tiny desktop page. */
  viewportTag: boolean;
  images: number;
  brokenImages: string[];
}

/** Menu check, done once on the start page (WordPress uses the same menu on every page). */
export interface MenuCheck {
  /** Phone: the ☰ button. null when the phone check is off or the page didn't open on a phone. */
  mobile: { buttonFound: boolean; opened: boolean; linksShown: number; note?: string } | null;
}

export interface ScrollResult {
  steps: number;
  pageHeight: number;
  reachedBottom: boolean;
  images: number;
  imagesLoaded: number;
  /** src of images that failed to load. */
  brokenImages: string[];
}

export interface VisitReport {
  url: string;
  startedAt: string;
  finishedAt: string;
  proxy: ProxyInfo | null;
  /** Where the visit came from, checked inside the proxied browser before any page is opened. */
  exit: ExitInfo | null;
  /** Checked again after the last page, to catch the proxy changing IP or country mid-test. */
  exitEnd: ExitInfo | null;
  start: VisitPage | null;
  scroll: ScrollResult | null;
  /** Every other internal page, in the order visited. */
  pages: VisitPage[];
  discovery: Discovery | null;
  /** Why the run ended early (other than Stop), e.g. the proxy stopped working. */
  stopReason: string | null;
  /** Plain-language problems found, empty when everything is fine. */
  issues: string[];
  cancelled: boolean;
  /** Whether each page was also checked on a phone screen. */
  mobileChecked: boolean;
  /** What the visit was made on (older reports: desktop). */
  device?: VisitDevice;
  /** The exact device, e.g. "iPhone 15 (iOS 18.6)" (campaign visits). */
  deviceName?: string;
}

/** How many internal pages the test found, and where. */
export interface Discovery {
  /** Pages listed in the sitemap (same site, safe to open). */
  sitemap: number;
  /** Internal links on the start page. */
  startPage: number;
  /** Start-page links that aren't in the sitemap. */
  startPageOnly: number;
  /** Found only through links on other visited pages (not in the sitemap or on the start page). */
  fromLinks: number;
  /** Pages to visit (all of them, unless over MAX_PAGES). Grows while pages are visited. */
  total: number;
  /** Pages left out because the site has more than MAX_PAGES. */
  leftOut: number;
  /** True when no sitemap was found (pages are found by following links only). */
  noSitemap: boolean;
}

/**
 * Where a campaign visit is, for the steps shown on its page: the browser opening, the Google search,
 * its CAPTCHA (only when Google asks), the click on the site's result, the site visited, all done.
 */
export type VisitStage = "browser" | "search" | "captcha" | "click" | "visit" | "done";

/** Streamed from GET /api/ctr/campaigns/:id/visit, one JSON object per line. */
export type VisitEvent =
  | { type: "step"; message: string }
  | { type: "stage"; stage: VisitStage }
  /** A campaign's visit is several runs in a row: run `n` of `of` starts, with a new proxy IP. */
  | { type: "run"; n: number; of: number; link?: { number: number; of: number }; device?: VisitDevice; deviceName?: string }
  | { type: "proxy"; proxy: ProxyInfo; exit: ExitInfo | null }
  | { type: "page"; page: VisitPage }
  | { type: "scroll"; scroll: ScrollResult }
  | { type: "discovered"; discovery: Discovery }
  | { type: "done"; report: VisitReport }
  | { type: "error"; message: string }
  /**
   * The visit is waiting: for `reason` (e.g. "a new proxy IP from the provider"), for `seconds` when
   * that's known, else until "waited". No reason: the proxy provider's wait for a new IP.
   */
  | { type: "wait"; seconds: number | null; reason?: string }
  /** The wait is over. */
  | { type: "waited" };
