// POST /api/sitemap  body: { url }
// Fetches the site's sitemap (including WordPress sitemap indexes) and returns
// the flat list of page URLs. This list is the source of truth for orphan detection.

import { BlockedUrlError, describeFetchError } from "@/lib/safe-fetch";
import { readSitemap } from "@/lib/sitemap";
import type { SitemapResponse } from "@/lib/types";
import { isBlockedHost, parseSiteUrl } from "@/lib/url";

// Node runtime is required (node:dns in safe-fetch). 30s leaves room for a slow sitemap index.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
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
    const sitemap = await readSitemap(origin);
    if (!sitemap) return json({ error: `No sitemap found for ${origin}` }, 404);
    return json({ origin, sitemapsFound: sitemap.sitemapsFound, urls: sitemap.urls });
  } catch (err) {
    if (err instanceof BlockedUrlError) return json({ error: "This host is not allowed" }, 403);
    return json({ error: `Could not read sitemap: ${describeFetchError(err)}` }, 502);
  }
}

function json(body: SitemapResponse, status = 200) {
  return Response.json(body, { status });
}
