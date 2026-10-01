// POST /api/fetch  body: { url, siteHost }
// Fetches ONE page server-side (avoids CORS) and returns its HTTP status, final URL
// after redirects, and the internal links found in it. Kept to a single page per call
// so each request stays well under Vercel's free-plan function time limit.

import * as cheerio from "cheerio";
import { isAuthorized } from "@/auth";
import { BlockedUrlError, describeFetchError, safeFetch } from "@/lib/safe-fetch";
import type { FetchResponse, FetchResult, PageLink } from "@/lib/types";
import { isBlockedHost, isInternal, shouldSkipCrawl } from "@/lib/url";

// Node runtime is required (node:dns in safe-fetch). 30s covers the 15s fetch timeout
// plus the HEAD -> GET fallback.
export const runtime = "nodejs";
export const maxDuration = 30;

const HTML_ACCEPT ="text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
const SKIP_SCHEMES = /^(mailto|tel|javascript):/i;

export async function POST(request: Request) {
  if (!(await isAuthorized())) return json({ error: "Sign in with your company Google account to use Site Auditor." }, 401);

  let body: { url?: unknown; siteHost?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON: { url, siteHost }" }, 400);
  }

  let target: URL;
  try {
    target = new URL(String(body?.url ?? ""));
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return json({ error: "Invalid URL" }, 400);
  }
  if (isBlockedHost(target.hostname)) return json({ error: "This host is not allowed" }, 403);

  const url = target.toString();
  const siteHost =
    typeof body.siteHost === "string" && body.siteHost.trim() ? body.siteHost.trim() : target.hostname;

  const result: FetchResult = {
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
  };

  const started = performance.now();
  try {
    if (shouldSkipCrawl(url)) {
      await checkStatusOnly(url, result);
    } else {
      await fetchPage(url, siteHost, result);
    }
  } catch (err) {
    // The target's failure is reported in the result, not as an API error.
    result.error =
      err instanceof BlockedUrlError ? "Redirected to a blocked address" : describeFetchError(err);
  }
  result.durationMs = Math.round(performance.now() - started);

  return json(result);
}

/** Files and WordPress system URLs: HEAD only, no body download. */
async function checkStatusOnly(url: string, result: FetchResult) {
  let { response, finalUrl, redirected } = await safeFetch(url, { method: "HEAD" });

  // Some servers don't support HEAD; fall back to GET and drop the body.
  if (response.status === 405 || response.status === 501) {
    ({ response, finalUrl, redirected } = await safeFetch(url));
    await response.body?.cancel();
  }

  Object.assign(result, {
    status: response.status,
    finalUrl,
    redirected,
    contentType: response.headers.get("content-type"),
    blocked: isChallengeStatus(response.status) && response.headers.has("cf-mitigated"),
  });
}

async function fetchPage(url: string, siteHost: string, result: FetchResult) {
  const { response, finalUrl, redirected } = await safeFetch(url, { accept: HTML_ACCEPT });
  const contentType = response.headers.get("content-type");
  const isHtml = /^(text\/html|application\/xhtml\+xml)/i.test(contentType ?? "");

  Object.assign(result, { status: response.status, finalUrl, redirected, contentType });

  // The body is only needed for HTML pages and for spotting a challenge page.
  if (!isHtml && !isChallengeStatus(response.status)) {
    await response.body?.cancel();
    return;
  }
  const html = await response.text();

  if (isChallengeStatus(response.status)) {
    result.blocked = response.headers.has("cf-mitigated") || html.includes("cf-chl");
    if (result.blocked) return;
  }
  if (!isHtml) return;

  const $ = cheerio.load(html);
  result.title = $("title").first().text().trim() || null;
  result.noindex = isNoindex($, response.headers.get("x-robots-tag"));
  result.links = extractLinks($, finalUrl, siteHost);
}

function isChallengeStatus(status: number) {
  return status === 403 || status === 503;
}

/** meta robots/googlebot or X-Robots-Tag containing "noindex" or "none". */
function isNoindex($: cheerio.CheerioAPI, robotsHeader: string | null): boolean {
  const meta = $("meta[name]")
    .filter((_, el) => /^(robots|googlebot)$/i.test($(el).attr("name") ?? ""))
    .map((_, el) => $(el).attr("content") ?? "")
    .get()
    .join(",");
  return /\b(noindex|none)\b/i.test(`${meta},${robotsHeader ?? ""}`);
}

/** Internal <a href> links as absolute URLs without hashes, one entry per unique href. */
function extractLinks($: cheerio.CheerioAPI, pageUrl: string, siteHost: string): PageLink[] {
  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref && URL.canParse(baseHref, pageUrl)) base = new URL(baseHref, pageUrl).toString();

  const links: PageLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href")?.trim();
    if (!raw || raw.startsWith("#") || SKIP_SCHEMES.test(raw) || !URL.canParse(raw, base)) return;

    const abs = new URL(raw, base);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    abs.hash = "";
    const href = abs.toString();
    if (seen.has(href) || !isInternal(href, siteHost)) return;
    seen.add(href);

    const $a = $(el);
    const text =
      $a.text().replace(/\s+/g, " ").trim() ||
      $a.attr("aria-label")?.trim() ||
      $a.find("img[alt]").first().attr("alt")?.trim() ||
      "";
    links.push({ href, text });
  });

  return links;
}

function json(body: FetchResponse, status = 200) {
  return Response.json(body, { status });
}
