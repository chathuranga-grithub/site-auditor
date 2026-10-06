// Shared types for the Visit Test tool (local only): one real-browser visit to a company
// site through a proxy, with scrolling and a few internal-link clicks, to check the site
// works for a visitor in that location.

export const PAGE_LIMITS = [3, 5, 10] as const;
export type PageLimit = (typeof PAGE_LIMITS)[number];

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
  /** Internal pages: clicked like a visitor, or opened directly because the link couldn't be clicked. */
  how?: "clicked" | "opened directly";
  linkText?: string;
  note?: string;
  consoleErrors: string[];
  /** Same-site files (images, scripts, CSS…) that failed or returned 4xx/5xx. */
  failedRequests: string[];
  /** JPEG data URL of the visible screen. */
  screenshot?: string;
  error?: string;
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
  exit: ExitInfo | null;
  start: VisitPage | null;
  scroll: ScrollResult | null;
  pages: VisitPage[];
  /** Internal links found on the start page (before picking which to visit). */
  linksFound: number;
  /** Plain-language problems found, empty when everything is fine. */
  issues: string[];
  cancelled: boolean;
}

/** Streamed from POST /api/visit-test, one JSON object per line. */
export type VisitEvent =
  | { type: "step"; message: string }
  | { type: "proxy"; proxy: ProxyInfo; exit: ExitInfo | null }
  | { type: "page"; page: VisitPage }
  | { type: "scroll"; scroll: ScrollResult }
  | { type: "done"; report: VisitReport }
  | { type: "error"; message: string }
  /** The proxy provider only allows a new IP after this many seconds. */
  | { type: "wait"; seconds: number };
