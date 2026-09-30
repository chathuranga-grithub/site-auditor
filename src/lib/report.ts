// Turns a ScanResult into shareable output: a plain-text report (for pasting into
// chat/email), friendly error messages, and stats shared by the UI and Excel export
// (the workbook itself is built in excel-report.ts).

import type { SiteJob } from "./batch";
import type { ScanResult } from "./types";
import { normalizeUrl } from "./url";

/** Human-readable version of API / network error messages. */
export function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m === "invalid url") return "That doesn't look like a website address. Try something like example.com.";
  if (m.includes("host is not allowed") || m.includes("blocked address"))
    return "That address points to a private or local network, which the scanner isn't allowed to access.";
  if (m.includes("enotfound") || m.includes("eai_again"))
    return "We couldn't find that domain. Check the spelling.";
  if (m.includes("timed out")) return "The site took too long to respond.";
  if (m.includes("econnrefused")) return "The site refused the connection.";
  if (m.includes("econnreset")) return "The site closed the connection unexpectedly.";
  if (m.includes("cert") || m.includes("ssl") || m.includes("tls"))
    return "The site's SSL certificate couldn't be verified.";
  if (m.includes("failed to fetch") || m.includes("networkerror"))
    return "Couldn't reach the Site Auditor server. Check your connection and try again.";
  return message;
}

export function friendlySitemapError(message: string): string {
  if (message.startsWith("No sitemap found"))
    return "No sitemap found (tried /sitemap-index.xml, /sitemap_index.xml, /sitemap.xml and robots.txt). Broken links were still checked, but orphan pages can't be detected without a sitemap.";
  return `Couldn't read the sitemap: ${friendlyError(message.replace(/^Could not read sitemap:\s*/, ""))} Orphan pages can't be detected.`;
}

/** Problems with the homepage itself, which usually mean the whole scan is empty. */
export function homepageProblem(result: ScanResult): string | null {
  const home = normalizeUrl(result.origin);
  const isHome = (url: string) => normalizeUrl(url) === home;

  const unreachable = result.unreachable.find((u) => isHome(u.url));
  if (unreachable) return `Couldn't reach the site. ${friendlyError(unreachable.error)}`;

  const blocked = result.blocked.find((b) => isHome(b.url));
  if (blocked)
    return "Cloudflare blocked the scanner on the homepage, so nothing could be crawled. Whitelist the scanner in Cloudflare and try again.";

  const broken = result.brokenLinks.find((b) => isHome(b.url));
  if (broken) return `The homepage returned HTTP ${broken.status}, so nothing could be crawled.`;

  return null;
}

/**
 * Warnings that change how much the results can be trusted.
 * Empty when the homepage itself failed, since homepageProblem already explains everything.
 */
export function scanWarnings(result: ScanResult): string[] {
  if (homepageProblem(result)) return [];
  const warnings: string[] = [];
  if (result.cancelled) warnings.push("The scan was stopped early. Results are incomplete and orphan pages weren't calculated.");
  if (result.truncated)
    warnings.push(
      `The site has more than ${result.pagesCrawled} pages, so the scan stopped at its page limit. Some orphan pages may actually be linked from pages that weren't crawled.`,
    );
  if (result.sitemapError) warnings.push(friendlySitemapError(result.sitemapError));
  if (result.soft404 && !result.soft404.passed)
    warnings.push(
      `Soft-404: a page that doesn't exist returned HTTP ${result.soft404.status} instead of 404, so some broken links may be hidden.`,
    );
  return warnings;
}

export function buildTextReport(result: ScanResult): string {
  const date = new Date(result.finishedAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const soft404 = result.soft404
    ? result.soft404.passed
      ? "PASS (a missing page correctly returns 404)"
      : `FAIL (a missing page returned ${result.soft404.status} instead of 404)`
    : "not run";

  const lines: string[] = [
    `Site audit: ${result.origin}`,
    `Scanned ${date}`,
    "",
    "SUMMARY",
    `- Sitemap URLs: ${result.sitemapCount}`,
    `- Pages crawled: ${result.pagesCrawled}`,
    `- Orphan pages: ${result.orphans.length}`,
    `- Broken links: ${result.brokenLinks.length}`,
    `- Redirects: ${result.redirects.length}`,
    `- Blocked by Cloudflare: ${result.blocked.length}`,
    `- Soft-404 test: ${soft404}`,
  ];

  const problem = homepageProblem(result);
  const notes = problem ? [problem] : scanWarnings(result);
  if (notes.length) lines.push("", "NOTES", ...notes.map((n) => `- ${n}`));

  const section = (title: string, rows: string[]) => {
    if (rows.length) lines.push("", `${title} (${rows.length})`, ...rows);
  };

  section(
    "BROKEN LINKS",
    result.brokenLinks.map(
      (b) => `- ${b.url} (${b.status})${b.foundOn.length ? `\n  found on: ${b.foundOn.join(", ")}` : ""}`,
    ),
  );
  section(
    "ORPHAN PAGES",
    result.orphans.map((o) => `- ${o.url}${o.status !== null ? ` (${o.status})` : ""}${o.noindex ? " [noindex]" : ""}`),
  );
  section(
    "REDIRECTS",
    result.redirects.map((r) => `- ${r.url} -> ${r.finalUrl}\n  linked from: ${r.foundOn.join(", ")}`),
  );
  section(
    "BLOCKED BY CLOUDFLARE (whitelist the scanner, then re-check)",
    result.blocked.map((b) => `- ${b.url} (${b.status})`),
  );
  section(
    "COULDN'T CHECK",
    result.unreachable.map((u) => `- ${u.url}: ${friendlyError(u.error)}`),
  );

  return lines.join("\n");
}

/** Plain-text summary of a bulk scan: one block per site with its key counts. */
export function buildBatchTextReport(jobs: SiteJob[]): string {
  const lines = [`Bulk site audit: ${jobs.length} sites`, `Generated ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`, ""];
  for (const job of jobs) {
    const r = job.result;
    if (!r) {
      lines.push(`${job.host}: ${job.status === "failed" ? `FAILED (${job.error ?? "error"})` : job.status.toUpperCase()}`);
      continue;
    }
    const soft = r.soft404 ? (r.soft404.passed ? "pass" : "FAIL") : "not run";
    lines.push(
      `${new URL(r.origin).host}${r.cancelled ? " (stopped early)" : ""}`,
      `  Broken links: ${r.brokenLinks.length} · Orphan pages: ${r.orphans.length} · Redirects: ${r.redirects.length} · Cloudflare: ${r.blocked.length} · Soft-404: ${soft}`,
    );
    for (const b of r.brokenLinks.slice(0, 5)) lines.push(`  - broken ${b.status}: ${b.url}`);
    if (r.brokenLinks.length > 5) lines.push(`  - …and ${r.brokenLinks.length - 5} more broken links`);
    for (const o of r.orphans.slice(0, 5)) lines.push(`  - orphan: ${o.url}`);
    if (r.orphans.length > 5) lines.push(`  - …and ${r.orphans.length - 5} more orphan pages`);
  }
  lines.push("", "Full details: download the bulk Excel report.");
  return lines.join("\n");
}

export function exportFileName(result: ScanResult, suffix: string, ext: "xlsx" | "json"): string {
  const host = new URL(result.origin).hostname.replace(/^www\./, "");
  return `site-audit-${host}-${result.finishedAt.slice(0, 10)}-${suffix}.${ext}`;
}

/** Median and 95th percentile of page response times (ms). */
export function responseTimes(result: ScanResult) {
  const times = result.pages
    .filter((p) => p.isPage && p.status !== 0)
    .map((p) => p.durationMs)
    .sort((a, b) => a - b);
  const pct = (q: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(q * times.length))] : null);
  return { median: pct(0.5), p95: pct(0.95) };
}

/** Status-class counts for the breakdown bar. Redirected URLs are counted separately. */
export function statusBreakdown(result: ScanResult) {
  const counts = { ok: 0, redirect: 0, client: 0, server: 0, other: 0 };
  for (const p of result.pages) {
    if (p.blocked || p.status === 0) counts.other++;
    else if (p.status >= 500) counts.server++;
    else if (p.status >= 400) counts.client++;
    else if (p.redirected || p.status >= 300) counts.redirect++;
    else counts.ok++;
  }
  return counts;
}
