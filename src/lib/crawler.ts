// Client-side crawler used by the Site Audit tool (src/components/audit/site-audit.tsx).
// Runs the crawl queue in the browser and calls /api/fetch once per URL, so no single
// serverless call has to crawl the whole site (Vercel free-plan time limits).
//
// Flow: /api/sitemap -> BFS crawl from the homepage -> check orphans -> soft-404 check.

import type {
  BlockedLink,
  BrokenLink,
  CrawledUrl,
  FetchResponse,
  FetchResult,
  OrphanPage,
  RedirectLink,
  ScanPhase,
  ScanProgress,
  ScanResult,
  SitemapResponse,
  Soft404Check,
  UnreachableLink,
} from "./types";
import { isInternal, normalizeUrl, parseSiteUrl, shouldSkipCrawl } from "./url";

export interface ScanOptions {
  /** Max HTML pages to crawl. Files that only get a status check don't count. */
  maxPages?: number;
  /** Parallel /api/fetch requests. */
  concurrency?: number;
  /**
   * Abort to stop the scan; runScan then resolves with a partial result (cancelled: true).
   * Aborting while the sitemap is still loading rejects with an AbortError instead.
   */
  signal?: AbortSignal;
  /** Called after every /api/fetch response, for a live request log. */
  onFetch?: (result: FetchResult, phase: ScanPhase) => void;
}

interface Queue {
  items: string[];
  head: number;
}

export async function runScan(
  siteUrl: string,
  { maxPages = 2000, concurrency = 5, signal, onFetch }: ScanOptions = {},
  onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  const startedAt = new Date().toISOString();

  // Keyed by normalizeUrl.
  const seen = new Set<string>();
  const inbound = new Map<string, Set<string>>();
  const results = new Map<string, FetchResult>();
  const depth = new Map<string, number>();

  const queue: Queue = { items: [], head: 0 };
  let crawled = 0;
  let pagesQueued = 0;
  let truncated = false;

  const report = (phase: ScanPhase, q: Queue = queue) =>
    onProgress?.({ phase, crawled, queued: q.items.length - q.head, found: queue.items.length });

  // 1. Sitemap
  report("sitemap");
  const sitemap = await loadSitemap(siteUrl, signal);
  const origin = sitemap.origin;
  const siteHost = new URL(origin).hostname;
  const rootKey = normalizeUrl(origin);

  // 2. BFS crawl from the homepage
  const enqueue = (url: string, level: number) => {
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) return;
    if (!shouldSkipCrawl(url)) {
      if (pagesQueued >= maxPages) {
        truncated = true;
        return;
      }
      pagesQueued++;
    }
    seen.add(key);
    depth.set(key, level);
    queue.items.push(url);
  };

  const processPage = (result: FetchResult) => {
    const key = normalizeUrl(result.url);
    if (!key) return;
    results.set(key, result);

    // Don't crawl a redirect target again under its own URL.
    const finalKey = normalizeUrl(result.finalUrl);
    if (finalKey) seen.add(finalKey);

    // Links on error pages, challenge pages, and off-site redirect targets don't count.
    const usable =
      result.status >= 200 &&
      result.status < 400 &&
      !result.blocked &&
      isInternal(result.finalUrl, siteHost);
    if (!usable) return;

    const nextLevel = (depth.get(key) ?? 0) + 1;
    for (const link of result.links) {
      // /api/fetch already filters to internal links; enforce it here too so an
      // external URL can never enter the queue.
      if (!isInternal(link.href, siteHost)) continue;
      const target = normalizeUrl(link.href);
      if (!target || target === key || target === finalKey) continue; // self-link

      let sources = inbound.get(target);
      if (!sources) inbound.set(target, (sources = new Set()));
      sources.add(result.finalUrl);
      enqueue(link.href, nextLevel);
    }
  };

  enqueue(new URL("/", origin).toString(), 0);
  report("crawl");
  await runQueue(queue, concurrency, signal, async (url) => {
    const result = await fetchUrl(url, siteHost, signal);
    if (!result) return; // aborted
    crawled++;
    onFetch?.(result, "crawl");
    processPage(result);
    report("crawl");
  });
  const crawlFinished = !signal?.aborted;

  // 3. Orphans: sitemap URLs nothing links to. The homepage is the entry point, never an orphan.
  const orphans: OrphanPage[] = [];
  if (crawlFinished) {
    for (const url of sitemap.urls) {
      const key = normalizeUrl(url);
      if (!key || key === rootKey || inbound.get(key)?.size) continue;
      const known = results.get(key);
      orphans.push({
        url,
        status: known?.status ?? null,
        finalUrl: known?.finalUrl ?? null,
        noindex: known?.noindex ?? false,
      });
    }

    const unchecked: Queue = { items: orphans.filter((o) => o.status === null).map((o) => o.url), head: 0 };
    const byUrl = new Map(orphans.map((o) => [o.url, o]));
    report("orphans", unchecked);
    await runQueue(unchecked, concurrency, signal, async (url) => {
      const result = await fetchUrl(url, siteHost, signal);
      if (!result) return;
      crawled++;
      onFetch?.(result, "orphans");
      Object.assign(byUrl.get(url)!, {
        status: result.status,
        finalUrl: result.finalUrl,
        noindex: result.noindex,
      });
      report("orphans", unchecked);
    });
  }

  // 4. Soft-404: a made-up URL should return 404, otherwise broken links can hide behind 200s.
  let soft404: Soft404Check | null = null;
  if (!signal?.aborted) {
    report("soft404");
    const testUrl = `${origin}/this-page-should-not-exist-${Math.random().toString(36).slice(2, 10)}`;
    const result = await fetchUrl(testUrl, siteHost, signal);
    if (result) {
      crawled++;
      onFetch?.(result, "soft404");
      // No HTTP response at all means the test couldn't run, not that it failed.
      if (result.status !== 0) {
        soft404 = { url: testUrl, status: result.status, passed: result.status === 404 };
      }
    }
  }

  // 5. Build the report from the crawl results.
  const brokenLinks: BrokenLink[] = [];
  const blocked: BlockedLink[] = [];
  const redirects: RedirectLink[] = [];
  const unreachable: UnreachableLink[] = [];
  const pages: CrawledUrl[] = [];
  const sitemapKeys = new Set(sitemap.urls.map((u) => normalizeUrl(u)));

  for (const [key, r] of results) {
    const foundOn = [...(inbound.get(key) ?? [])];
    const isPage = !shouldSkipCrawl(r.url);
    const finalKey = normalizeUrl(r.finalUrl);

    pages.push({
      url: r.url,
      finalUrl: r.finalUrl,
      status: r.status,
      redirected: r.redirected,
      blocked: r.blocked,
      contentType: r.contentType,
      title: r.title,
      noindex: r.noindex,
      depth: depth.get(key) ?? 0,
      inlinks: foundOn.length,
      outlinks: r.links.length,
      inSitemap: sitemapKeys.has(key) || (!!finalKey && sitemapKeys.has(finalKey)),
      isPage,
      durationMs: r.durationMs,
      error: r.error,
    });

    if (r.blocked) blocked.push({ url: r.url, status: r.status, foundOn });
    else if (r.status === 0) unreachable.push({ url: r.url, error: r.error ?? "Request failed", foundOn });
    else if (r.status >= 400) brokenLinks.push({ url: r.url, status: r.status, foundOn });

    if (r.redirected && foundOn.length > 0) {
      redirects.push({ url: r.url, finalUrl: r.finalUrl, status: r.status, foundOn });
    }
  }

  report("done");
  return {
    origin,
    startedAt,
    finishedAt: new Date().toISOString(),
    sitemapCount: sitemap.urls.length,
    sitemapError: sitemap.error,
    // Only pages that answered; a homepage that never responded isn't a crawled page.
    pagesCrawled: pages.filter((p) => p.isPage && p.status !== 0).length,
    urlsChecked: results.size,
    pages,
    orphans,
    brokenLinks,
    blocked,
    redirects,
    unreachable,
    soft404,
    cancelled: !!signal?.aborted,
    truncated,
  };
}

/**
 * Invalid or blocked input throws (nothing to scan). Any other sitemap failure is
 * reported in `error` and the crawl still runs, since broken links are useful on their own.
 */
async function loadSitemap(siteUrl: string, signal?: AbortSignal) {
  const res = await fetch("/api/sitemap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: siteUrl }),
    signal,
  });
  const data = (await res.json().catch(() => ({ error: `Sitemap API error (${res.status})` }))) as SitemapResponse;

  if ("urls" in data) return { origin: data.origin, urls: data.urls, error: null };
  if (res.status === 400 || res.status === 403) throw new Error(data.error);

  const site = parseSiteUrl(siteUrl);
  if (!site) throw new Error("Invalid URL");
  return { origin: site.origin, urls: [] as string[], error: data.error };
}

/** One /api/fetch call. Returns null only when aborted; API failures become status 0 results. */
async function fetchUrl(url: string, siteHost: string, signal?: AbortSignal): Promise<FetchResult | null> {
  try {
    const res = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, siteHost }),
      signal,
    });
    const data = (await res.json().catch(() => ({ error: `Fetch API error (${res.status})` }))) as FetchResponse;
    return "status" in data ? data : failedResult(url, data.error);
  } catch (err) {
    if (signal?.aborted) return null;
    return failedResult(url, err instanceof Error ? err.message : String(err));
  }
}

function failedResult(url: string, error: string): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 0,
    redirected: false,
    blocked: false,
    contentType: null,
    title: null,
    noindex: false,
    links: [],
    durationMs: 0,
    error,
  };
}

/**
 * Runs `handle` over a queue that can grow while it runs, `concurrency` at a time.
 * Resolves when the queue is drained (or aborted) and no request is in flight.
 */
function runQueue(
  queue: Queue,
  concurrency: number,
  signal: AbortSignal | undefined,
  handle: (url: string) => Promise<void>,
): Promise<void> {
  return new Promise((resolve) => {
    let active = 0;
    const pump = () => {
      while (!signal?.aborted && active < concurrency && queue.head < queue.items.length) {
        const url = queue.items[queue.head++];
        active++;
        handle(url)
          .catch((err) => console.error("Crawler error", url, err))
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (signal?.aborted || queue.head >= queue.items.length)) resolve();
    };
    pump();
  });
}
