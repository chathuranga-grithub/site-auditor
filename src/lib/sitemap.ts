// Server-only: read a site's sitemap (including WordPress sitemap indexes) and return
// its page URLs. Shared by /api/sitemap (Site Audit) and campaign visits.

import * as cheerio from "cheerio";
import { BlockedUrlError, safeFetch } from "./safe-fetch";
import { normalizeUrl } from "./url";

// Yoast / Rank Math indexes first, then the generic name, then WordPress core (5.5+).
const CANDIDATE_PATHS = ["/sitemap-index.xml", "/sitemap_index.xml", "/sitemap.xml", "/wp-sitemap.xml"];

/** Caps so a huge or looping sitemap can't run forever. */
const MAX_SITEMAPS = 200;
const MAX_DEPTH = 3;
const CONCURRENCY = 5;

const XML_ACCEPT = "application/xml,text/xml;q=0.9,*/*;q=0.8";

interface ParsedSitemap {
  finalUrl: string;
  childSitemaps: string[];
  pageUrls: string[];
}

/** How sitemap files are downloaded. Campaign visits pass one that goes through its proxy. */
export type SitemapFetcher = (url: string, accept: string) => Promise<{ ok: boolean; finalUrl: string; text: () => Promise<string> }>;

/** Direct download from this server, with the SSRF guard. */
const directFetch: SitemapFetcher = async (url, accept) => {
  const { response, finalUrl } = await safeFetch(url, { accept });
  if (!response.ok) await response.body?.cancel();
  return { ok: response.ok, finalUrl, text: () => response.text() };
};

export interface SitemapRead {
  sitemapsFound: string[];
  /** Page URLs, de-duplicated by normalizeUrl, original spelling kept. */
  urls: string[];
}

/** null when the site has no sitemap. Throws when the site can't be reached at all. */
export async function readSitemap(origin: string, fetcher: SitemapFetcher = directFetch): Promise<SitemapRead | null> {
  const roots = await findRootSitemaps(origin, fetcher);
  if (roots.length === 0) return null;

  const { sitemapsFound, pageUrls } = await crawlSitemaps(roots, fetcher);
  const unique = new Map<string, string>();
  for (const url of pageUrls) {
    const key = normalizeUrl(url);
    if (key && !unique.has(key)) unique.set(key, url);
  }
  return { sitemapsFound, urls: [...unique.values()] };
}

/** First candidate path that is a real sitemap wins; otherwise fall back to robots.txt. */
async function findRootSitemaps(origin: string, fetcher: SitemapFetcher): Promise<ParsedSitemap[]> {
  let lastError: unknown = null;

  for (const path of CANDIDATE_PATHS) {
    try {
      const parsed = await fetchSitemap(`${origin}${path}`, fetcher);
      if (parsed) return [parsed];
    } catch (err) {
      if (err instanceof BlockedUrlError) throw err;
      lastError = err;
    }
  }

  const fromRobots = await sitemapsFromRobots(origin, fetcher);
  const results = await mapLimit(fromRobots, CONCURRENCY, (url) => fetchSitemap(url, fetcher).catch(() => null));
  const found = results.filter((r): r is ParsedSitemap => r !== null);

  // Nothing responded at all (DNS failure, timeouts): report that instead of "not found".
  if (found.length === 0 && lastError && fromRobots.length === 0) throw lastError;
  return found;
}

async function sitemapsFromRobots(origin: string, fetcher: SitemapFetcher): Promise<string[]> {
  try {
    const response = await fetcher(`${origin}/robots.txt`, "text/plain,*/*");
    if (!response.ok) return [];
    const text = await response.text();
    const urls = [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
    return [...new Set(urls)].filter((u) => URL.canParse(u));
  } catch {
    return [];
  }
}

/** Follows sitemap indexes breadth-first, up to MAX_DEPTH levels and MAX_SITEMAPS files. */
async function crawlSitemaps(roots: ParsedSitemap[], fetcher: SitemapFetcher) {
  const seen = new Set<string>(roots.map((r) => r.finalUrl));
  const sitemapsFound: string[] = [];
  const pageUrls: string[] = [];

  let level = roots;
  for (let depth = 0; level.length > 0; depth++) {
    const next: string[] = [];
    for (const sm of level) {
      sitemapsFound.push(sm.finalUrl);
      pageUrls.push(...sm.pageUrls);
      if (depth >= MAX_DEPTH) continue;
      for (const child of sm.childSitemaps) {
        if (!seen.has(child) && seen.size < MAX_SITEMAPS) {
          seen.add(child);
          next.push(child);
        }
      }
    }

    // A failed child sitemap is skipped rather than failing the whole read.
    const fetched = await mapLimit(next, CONCURRENCY, (url) => fetchSitemap(url, fetcher).catch(() => null));
    level = fetched.filter((r): r is ParsedSitemap => r !== null);
  }

  return { sitemapsFound, pageUrls };
}

/** Returns null when the URL responds but isn't a sitemap (404, HTML soft-404, etc.). */
async function fetchSitemap(url: string, fetcher: SitemapFetcher): Promise<ParsedSitemap | null> {
  const response = await fetcher(url, XML_ACCEPT);
  if (!response.ok) return null;
  const finalUrl = response.finalUrl;

  const $ = cheerio.load(await response.text(), { xml: true });
  const isIndex = $("sitemapindex").length > 0;
  if (!isIndex && $("urlset").length === 0) return null;

  const locs = (selector: string) =>
    $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((loc) => URL.canParse(loc));

  return {
    finalUrl,
    childSitemaps: isIndex ? locs("sitemap > loc") : [],
    pageUrls: isIndex ? [] : locs("url > loc"),
  };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
