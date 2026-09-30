// Shared types used by both the API routes and the UI, so request/response
// shapes stay in sync (sitemap response, fetch-page result, audit report rows).

/** Successful response of POST /api/sitemap. */
export interface SitemapResult {
  /** Site origin the sitemap was read for, e.g. "https://example.com". */
  origin: string;
  /** Every sitemap file that was read (the index plus its child sitemaps). */
  sitemapsFound: string[];
  /** Page URLs listed in the sitemap(s), de-duplicated by normalizeUrl, original spelling kept. */
  urls: string[];
}

/** Error body returned by any API route. */
export interface ApiError {
  error: string;
}

export type SitemapResponse = SitemapResult | ApiError;

export type FetchResponse = FetchResult | ApiError;

/** One <a href> found on a page. */
export interface PageLink {
  /** Absolute URL, resolved against the page it was found on. */
  href: string;
  /** Visible anchor text (trimmed), useful for spotting the link on the page. */
  text: string;
}

/** Response of GET /api/fetch for a single page. */
export interface FetchResult {
  /** URL that was requested. */
  url: string;
  /** URL after following redirects. */
  finalUrl: string;
  /** HTTP status of the final response; 0 when the request failed (DNS, timeout, etc.). */
  status: number;
  redirected: boolean;
  /** True when a bot challenge (e.g. Cloudflare) answered instead of the page. Not a broken link. */
  blocked: boolean;
  contentType: string | null;
  title: string | null;
  /** True if the page has a robots noindex meta tag or X-Robots-Tag header. */
  noindex: boolean;
  /** Internal links only. Empty for non-HTML responses. */
  links: PageLink[];
  /** Server-side time for the request, redirects included. */
  durationMs: number;
  error?: string;
}

/** One URL requested during the crawl, flattened for the "All URLs" table and exports. */
export interface CrawledUrl {
  url: string;
  finalUrl: string;
  status: number;
  redirected: boolean;
  blocked: boolean;
  contentType: string | null;
  title: string | null;
  noindex: boolean;
  /** Clicks from the homepage (homepage = 0). */
  depth: number;
  /** Unique crawled pages linking here. */
  inlinks: number;
  /** Unique internal links on this page. */
  outlinks: number;
  inSitemap: boolean;
  /** False for files and WordPress system URLs that only got a status check. */
  isPage: boolean;
  durationMs: number;
  error?: string;
}

/** A link target that returned 4xx/5xx (or failed), with every page that links to it. */
export interface BrokenLink {
  url: string;
  status: number;
  foundOn: string[];
}

/** A link answered by a bot challenge (e.g. Cloudflare) instead of the page. Not counted as broken. */
export interface BlockedLink {
  url: string;
  status: number;
  foundOn: string[];
}

/** An internal link that redirects somewhere else. */
export interface RedirectLink {
  url: string;
  finalUrl: string;
  status: number;
  foundOn: string[];
}

/** A link that got no HTTP response at all (timeout, DNS error, blocked redirect). */
export interface UnreachableLink {
  url: string;
  error: string;
  foundOn: string[];
}

/** A sitemap URL that no crawled page links to. */
export interface OrphanPage {
  url: string;
  /** null if the scan was cancelled before this page was checked. */
  status: number | null;
  finalUrl: string | null;
  noindex: boolean;
}

/** Result of requesting a random URL that should not exist. */
export interface Soft404Check {
  url: string;
  status: number;
  /** True when the site answered 404. Otherwise broken links may be hidden behind 200s. */
  passed: boolean;
}

export type ScanPhase = "sitemap" | "crawl" | "orphans" | "soft404" | "done";

export interface ScanProgress {
  phase: ScanPhase;
  /** URLs fetched so far (all phases). */
  crawled: number;
  /** URLs waiting in the current phase's queue. */
  queued: number;
  /** Unique URLs discovered so far. */
  found: number;
}

/** Final report returned by runScan. */
export interface ScanResult {
  origin: string;
  startedAt: string;
  finishedAt: string;
  /** Number of URLs listed in the sitemap. */
  sitemapCount: number;
  /** Set when the sitemap couldn't be read; the crawl still runs but orphans can't be found. */
  sitemapError: string | null;
  /** HTML pages crawled (excludes files that only got a status check). */
  pagesCrawled: number;
  /** Every URL requested during the crawl, pages and files. */
  urlsChecked: number;
  /** Every URL requested during the crawl, in crawl order. */
  pages: CrawledUrl[];
  orphans: OrphanPage[];
  brokenLinks: BrokenLink[];
  blocked: BlockedLink[];
  redirects: RedirectLink[];
  unreachable: UnreachableLink[];
  /** null if the check didn't run (scan cancelled, or the test URL got no response). */
  soft404: Soft404Check | null;
  /** True if the user stopped the scan. Orphans are only computed when the crawl finished. */
  cancelled: boolean;
  /** True if maxPages was reached, so some pages were never crawled and orphans may be overstated. */
  truncated: boolean;
}
