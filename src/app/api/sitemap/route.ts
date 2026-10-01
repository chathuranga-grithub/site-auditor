// POST /api/sitemap  body: { url }
// Fetches the site's sitemap (including WordPress sitemap indexes) and returns
// the flat list of page URLs. This list is the source of truth for orphan detection.

import * as cheerio from "cheerio";
import { isAuthorized } from "@/auth";
import { BlockedUrlError, describeFetchError, safeFetch } from "@/lib/safe-fetch";
import type { SitemapResponse } from "@/lib/types";
import { isBlockedHost, normalizeUrl, parseSiteUrl } from "@/lib/url";

// Node runtime is required (node:dns in safe-fetch). 30s leaves room for a slow sitemap index.
export const runtime = "nodejs";
export const maxDuration = 30;

const CANDIDATE_PATHS =["/sitemap-index.xml", "/sitemap_index.xml", "/sitemap.xml"];

/** Caps so a huge or looping sitemap can't run past the function time limit. */
const MAX_SITEMAPS = 200;
const MAX_DEPTH = 3;
const CONCURRENCY = 5;

const XML_ACCEPT = "application/xml,text/xml;q=0.9,*/*;q=0.8";

interface ParsedSitemap {
  finalUrl: string;
  childSitemaps: string[];
  pageUrls: string[];
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) return json({ error: "Sign in with your company Google account to use Site Auditor." }, 401);

  let input: unknown;
  try {
    input = ((await request.json()) as { url?: unknown })?.url;
  } catch {
    return json({ error: "Request body must be JSON: { url }" }, 400);
  }
  if (typeof input !== "string" || !input.trim()) {
    return json({ error: "Missing url" }, 400);
  }

  const site = parseSiteUrl(input);
  if (!site) return json({ error: "Invalid URL" }, 400);
  if (isBlockedHost(site.hostname)) return json({ error: "This host is not allowed" }, 403);
  // A single word like "abc" isn't a public website (IPv6 literals keep their brackets).
  if (!site.hostname.includes(".") && !site.hostname.startsWith("[")) return json({ error: "Invalid URL" }, 400);

  const origin = site.origin;

  try {
    const roots = await findRootSitemaps(origin);
    if (roots.length === 0) {
      return json({ error: `No sitemap found for ${origin}` }, 404);
    }

    const { sitemapsFound, pageUrls } = await crawlSitemaps(roots);

    // Deduplicate by normalized key, keep the first original spelling.
    const unique = new Map<string, string>();
    for (const url of pageUrls) {
      const key = normalizeUrl(url);
      if (key && !unique.has(key)) unique.set(key, url);
    }

    return json({ origin, sitemapsFound, urls: [...unique.values()] });
  } catch (err) {
    if (err instanceof BlockedUrlError) return json({ error: "This host is not allowed" }, 403);
    return json({ error: `Could not read sitemap: ${describeFetchError(err)}` }, 502);
  }
}

/** First candidate path that is a real sitemap wins; otherwise fall back to robots.txt. */
async function findRootSitemaps(origin: string): Promise<ParsedSitemap[]> {
  let lastError: unknown = null;

  for (const path of CANDIDATE_PATHS) {
    try {
      const parsed = await fetchSitemap(`${origin}${path}`);
      if (parsed) return [parsed];
    } catch (err) {
      if (err instanceof BlockedUrlError) throw err;
      lastError = err;
    }
  }

  const fromRobots = await sitemapsFromRobots(origin);
  const results = await mapLimit(fromRobots, CONCURRENCY, (url) =>
    fetchSitemap(url).catch(() => null),
  );
  const found = results.filter((r): r is ParsedSitemap => r !== null);

  // Nothing responded at all (DNS failure, timeouts): report that instead of "not found".
  if (found.length === 0 && lastError && fromRobots.length === 0) throw lastError;
  return found;
}

async function sitemapsFromRobots(origin: string): Promise<string[]> {
  try {
    const { response } = await safeFetch(`${origin}/robots.txt`, { accept: "text/plain,*/*" });
    if (!response.ok) return [];
    const text = await response.text();
    const urls = [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
    return [...new Set(urls)].filter((u) => URL.canParse(u));
  } catch {
    return [];
  }
}

/** Follows sitemap indexes breadth-first, up to MAX_DEPTH levels and MAX_SITEMAPS files. */
async function crawlSitemaps(roots: ParsedSitemap[]) {
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

    // A failed child sitemap is skipped rather than failing the whole request.
    const fetched = await mapLimit(next, CONCURRENCY, (url) => fetchSitemap(url).catch(() => null));
    level = fetched.filter((r): r is ParsedSitemap => r !== null);
  }

  return { sitemapsFound, pageUrls };
}

/** Returns null when the URL responds but isn't a sitemap (404, HTML soft-404, etc.). */
async function fetchSitemap(url: string): Promise<ParsedSitemap | null> {
  const { response, finalUrl } = await safeFetch(url, { accept: XML_ACCEPT });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }

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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

function json(body: SitemapResponse, status = 200) {
  return Response.json(body, { status });
}
