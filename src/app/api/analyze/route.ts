// POST /api/analyze  body: { url }
// Fetches one ranking page (SSRF-safe) and measures its on-page SEO for the Keyword
// Rankings report: title, description, headings, word count, schema, Open Graph, etc.

import * as cheerio from "cheerio";
import type { ApiError, PageSeo } from "@/lib/rankings-types";
import { BlockedUrlError, describeFetchError, safeFetch } from "@/lib/safe-fetch";
import { isBlockedHost, normalizeUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 30;

const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
const MAX_HTML_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  let target: URL;
  try {
    const body = (await request.json()) as { url?: unknown };
    target = new URL(String(body?.url ?? ""));
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return json({ error: "Invalid URL" }, 400);
  if (isBlockedHost(target.hostname)) return json({ error: "This host is not allowed" }, 403);

  const url = target.toString();
  const result = emptyResult(url);
  const started = performance.now();

  try {
    const { response, finalUrl, redirected } = await safeFetch(url, { accept: HTML_ACCEPT });
    Object.assign(result, { finalUrl, redirected, status: response.status, https: finalUrl.startsWith("https:") });

    const contentType = response.headers.get("content-type") ?? "";
    const html = /html/i.test(contentType) || !contentType ? await response.text() : "";
    if (!html) await response.body?.cancel();
    result.bytes = new TextEncoder().encode(html).length;

    if ((response.status === 403 || response.status === 503) && (response.headers.has("cf-mitigated") || html.includes("cf-chl"))) {
      result.blocked = true;
    } else if (html && result.bytes <= MAX_HTML_BYTES) {
      Object.assign(result, analyzeHtml(html, finalUrl, response.headers.get("x-robots-tag")));
    }
  } catch (err) {
    result.error = err instanceof BlockedUrlError ? "Redirected to a blocked address" : describeFetchError(err);
  }
  result.durationMs = Math.round(performance.now() - started);
  return json(result);
}

function analyzeHtml(html: string, pageUrl: string, robotsHeader: string | null): Partial<PageSeo> {
  const $ = cheerio.load(html);
  const text = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() || null;
  const meta = (name: string) =>
    $("meta[name]")
      .filter((_, el) => ($(el).attr("name") ?? "").toLowerCase() === name)
      .first()
      .attr("content");
  const prop = (p: string) =>
    $("meta[property]")
      .filter((_, el) => ($(el).attr("property") ?? "").toLowerCase() === p)
      .first()
      .attr("content");

  // Canonical
  const canonicalHref = $("link[rel]")
    .filter((_, el) => ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"))
    .first()
    .attr("href")
    ?.trim();
  const canonical = canonicalHref && URL.canParse(canonicalHref, pageUrl) ? new URL(canonicalHref, pageUrl).toString() : null;

  // Robots
  const robots = [meta("robots"), meta("googlebot"), robotsHeader].filter(Boolean).join(",");

  // Structured data (JSON-LD), including @graph
  const schemaTypes = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectTypes(JSON.parse($(el).text()), schemaTypes);
    } catch {
      /* invalid JSON-LD is ignored */
    }
  });

  // Links
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  let internalLinks = 0;
  let externalLinks = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim() ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href) || !URL.canParse(href, pageUrl)) return;
    const u = new URL(href, pageUrl);
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.hostname.replace(/^www\./, "") === host) internalLinks++;
    else externalLinks++;
  });

  // Images
  const images = $("img");
  const imagesMissingAlt = images.filter((_, el) => !($(el).attr("alt") ?? "").trim()).length;

  // Visible words: drop scripts/styles/SVG and elements hidden from visitors.
  $("script, style, noscript, template, svg, iframe").remove();
  $("[hidden], [aria-hidden='true'], [style*='display:none'], [style*='display: none']").remove();
  const wordCount = ($("body").text().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

  return {
    title: text($("title").first().text()),
    description: text(meta("description")),
    h1: text($("h1").first().text()),
    h1Count: $("h1").length,
    h2Count: $("h2").length,
    wordCount,
    canonical,
    canonicalSelf: !!canonical && normalizeUrl(canonical) === normalizeUrl(pageUrl),
    noindex: /\b(noindex|none)\b/i.test(robots),
    lang: $("html").attr("lang")?.trim() || null,
    viewport: !!meta("viewport"),
    schemaTypes: [...schemaTypes].slice(0, 12),
    ogTitle: !!prop("og:title"),
    ogImage: !!prop("og:image"),
    images: images.length,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
  };
}

function collectTypes(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
  if (obj["@graph"]) collectTypes(obj["@graph"], out);
}

function emptyResult(url: string): PageSeo {
  return {
    url,
    finalUrl: url,
    status: 0,
    redirected: false,
    blocked: false,
    https: url.startsWith("https:"),
    durationMs: 0,
    bytes: 0,
    title: null,
    description: null,
    h1: null,
    h1Count: 0,
    h2Count: 0,
    wordCount: 0,
    canonical: null,
    canonicalSelf: false,
    noindex: false,
    lang: null,
    viewport: false,
    schemaTypes: [],
    ogTitle: false,
    ogImage: false,
    images: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
  };
}

function json(body: PageSeo | ApiError, status = 200) {
  return Response.json(body, { status });
}
