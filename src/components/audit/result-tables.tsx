"use client";

// Column and filter definitions for each Site Audit results tab.

import type { ReactNode } from "react";
import { DataTable, type Column, type QuickFilter } from "@/components/ui/data-table";
import { Notice, StatusCode, Tag, UrlLink } from "@/components/ui/primitives";
import { friendlyError } from "@/lib/report";
import type {
  BlockedLink,
  BrokenLink,
  CrawledUrl,
  OrphanPage,
  RedirectLink,
  ScanResult,
  UnreachableLink,
} from "@/lib/types";

// ---------- All URLs ----------

const URL_FILTERS: QuickFilter<CrawledUrl>[] = [
  { id: "pages", label: "HTML pages", test: (p) => p.isPage },
  { id: "files", label: "Files", test: (p) => !p.isPage },
  { id: "2xx", label: "2xx", test: (p) => p.status >= 200 && p.status < 300 && !p.redirected && !p.blocked },
  { id: "redirected", label: "Redirected", test: (p) => p.redirected },
  { id: "4xx", label: "4xx", test: (p) => p.status >= 400 && p.status < 500 && !p.blocked },
  { id: "5xx", label: "5xx", test: (p) => p.status >= 500 && !p.blocked },
  { id: "errors", label: "No response / blocked", test: (p) => p.status === 0 || p.blocked },
];

const URL_COLUMNS: Column<CrawledUrl>[] = [
  {
    id: "status",
    header: "Status",
    cell: (p) => <StatusCode status={p.status} redirected={p.redirected} />,
    sortValue: (p) => p.status,
    className: "w-20",
  },
  {
    id: "url",
    header: "URL",
    cell: (p) => (
      <div className="min-w-0 space-y-0.5">
        <UrlLink href={p.url} />
        {p.redirected && (
          <div className="font-mono text-[11px] text-subtle">
            → <UrlLink href={p.finalUrl} />
          </div>
        )}
        {(p.title || p.noindex || p.blocked) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {p.blocked && <Tag>challenge</Tag>}
            {p.noindex && <Tag>noindex</Tag>}
            {p.title && <span className="line-clamp-1">{p.title}</span>}
          </div>
        )}
      </div>
    ),
    sortValue: (p) => p.url,
  },
  {
    id: "type",
    header: "Type",
    cell: (p) => <span className="font-mono text-xs text-muted">{shortType(p.contentType)}</span>,
    sortValue: (p) => shortType(p.contentType),
    className: "w-20",
  },
  {
    id: "depth",
    header: "Depth",
    cell: (p) => <Num value={p.depth} />,
    sortValue: (p) => p.depth,
    className: "w-16 text-right",
  },
  {
    id: "inlinks",
    header: "In",
    cell: (p) => <Num value={p.inlinks} />,
    sortValue: (p) => p.inlinks,
    className: "w-14 text-right",
  },
  {
    id: "outlinks",
    header: "Out",
    cell: (p) => <Num value={p.outlinks} />,
    sortValue: (p) => p.outlinks,
    className: "w-14 text-right",
  },
  {
    id: "sitemap",
    header: "Sitemap",
    cell: (p) =>
      p.inSitemap ? <span className="font-mono text-xs text-status-good">yes</span> : <span className="font-mono text-xs text-subtle">—</span>,
    sortValue: (p) => (p.inSitemap ? 1 : 0),
    className: "w-20",
  },
  {
    id: "time",
    header: "Time",
    cell: (p) => (
      <span className={`font-mono text-xs tabular-nums ${p.durationMs > 2000 ? "text-status-warning" : "text-muted"}`}>
        {p.durationMs.toLocaleString()}ms
      </span>
    ),
    sortValue: (p) => p.durationMs,
    className: "w-20 text-right",
  },
];

export function AllUrlsTable({ result, toolbar }: { result: ScanResult; toolbar?: ReactNode }) {
  return (
    <DataTable
      rows={result.pages}
      columns={URL_COLUMNS}
      rowKey={(p) => p.url}
      searchText={(p) => `${p.url} ${p.finalUrl} ${p.title ?? ""}`}
      filters={URL_FILTERS}
      toolbar={toolbar}
      empty="No URLs crawled."
    />
  );
}

// ---------- Broken ----------

const BROKEN_COLUMNS: Column<BrokenLink>[] = [
  {
    id: "status",
    header: "Status",
    cell: (b) => <StatusCode status={b.status} />,
    sortValue: (b) => b.status,
    className: "w-20",
  },
  { id: "url", header: "Broken URL", cell: (b) => <UrlLink href={b.url} />, sortValue: (b) => b.url },
  {
    id: "refs",
    header: "Refs",
    cell: (b) => <Num value={b.foundOn.length} />,
    sortValue: (b) => b.foundOn.length,
    className: "w-16 text-right",
  },
  { id: "foundOn", header: "Found on", cell: (b) => <UrlList urls={b.foundOn} /> },
];

export function BrokenTable({ result, toolbar }: { result: ScanResult; toolbar?: ReactNode }) {
  return (
    <DataTable
      rows={result.brokenLinks}
      columns={BROKEN_COLUMNS}
      rowKey={(b) => b.url}
      searchText={(b) => `${b.url} ${b.foundOn.join(" ")}`}
      defaultSort={{ id: "refs", dir: "desc" }}
      toolbar={toolbar}
      empty="No broken internal links."
    />
  );
}

// ---------- Orphans ----------

const ORPHAN_COLUMNS: Column<OrphanPage>[] = [
  {
    id: "status",
    header: "Status",
    cell: (o) => (o.status === null ? <span className="font-mono text-xs text-subtle">—</span> : <StatusCode status={o.status} />),
    sortValue: (o) => o.status,
    className: "w-20",
  },
  {
    id: "url",
    header: "URL",
    cell: (o) => (
      <div className="space-y-0.5">
        <UrlLink href={o.url} />
        {o.finalUrl && o.finalUrl !== o.url && (
          <div className="font-mono text-[11px] text-subtle">
            → <UrlLink href={o.finalUrl} />
          </div>
        )}
      </div>
    ),
    sortValue: (o) => o.url,
  },
  {
    id: "flags",
    header: "Flags",
    cell: (o) => (o.noindex ? <Tag>noindex</Tag> : null),
    sortValue: (o) => (o.noindex ? 1 : 0),
    className: "w-24",
  },
];

export function OrphanTable({ result, toolbar }: { result: ScanResult; toolbar?: ReactNode }) {
  const empty = result.sitemapError
    ? "Orphan detection needs a sitemap."
    : result.cancelled
      ? "Orphans are only calculated when the scan finishes."
      : "No orphan pages. Every sitemap URL is linked from a crawled page.";
  return (
    <DataTable
      rows={result.orphans}
      columns={ORPHAN_COLUMNS}
      rowKey={(o) => o.url}
      searchText={(o) => o.url}
      toolbar={toolbar}
      empty={empty}
    />
  );
}

// ---------- Redirects ----------

const REDIRECT_COLUMNS: Column<RedirectLink>[] = [
  { id: "from", header: "From", cell: (r) => <UrlLink href={r.url} />, sortValue: (r) => r.url },
  {
    id: "to",
    header: "To",
    cell: (r) => (
      <span className="inline-flex gap-1.5">
        <span className="font-mono text-xs text-subtle" aria-hidden>
          →
        </span>
        <UrlLink href={r.finalUrl} />
      </span>
    ),
    sortValue: (r) => r.finalUrl,
  },
  {
    id: "status",
    header: "Final",
    cell: (r) => <StatusCode status={r.status} />,
    sortValue: (r) => r.status,
    className: "w-20",
  },
  { id: "foundOn", header: "Linked from", cell: (r) => <UrlList urls={r.foundOn} /> },
];

export function RedirectTable({ result, toolbar }: { result: ScanResult; toolbar?: ReactNode }) {
  return (
    <DataTable
      rows={result.redirects}
      columns={REDIRECT_COLUMNS}
      rowKey={(r) => r.url}
      searchText={(r) => `${r.url} ${r.finalUrl}`}
      toolbar={toolbar}
      empty="No internal links redirect."
    />
  );
}

// ---------- Blocked ----------

const BLOCKED_COLUMNS: Column<BlockedLink>[] = [
  {
    id: "status",
    header: "Status",
    cell: (b) => <StatusCode status={b.status} />,
    sortValue: (b) => b.status,
    className: "w-20",
  },
  { id: "url", header: "URL", cell: (b) => <UrlLink href={b.url} />, sortValue: (b) => b.url },
  { id: "foundOn", header: "Found on", cell: (b) => <UrlList urls={b.foundOn} /> },
];

export function BlockedTable({ result, toolbar }: { result: ScanResult; toolbar?: ReactNode }) {
  return (
    <div>
      {result.blocked.length > 0 && (
        <div className="border-b border-line p-3">
          <Notice tone="warning">
            Cloudflare served a bot challenge instead of these URLs, so they weren&apos;t verified and are not
            counted as broken. Whitelist the scanner in Cloudflare (Security → WAF → Custom rules → Skip) and scan
            again.
          </Notice>
        </div>
      )}
      <DataTable
        rows={result.blocked}
        columns={BLOCKED_COLUMNS}
        rowKey={(b) => b.url}
        searchText={(b) => b.url}
        toolbar={toolbar}
        empty="Nothing was blocked by Cloudflare."
      />
    </div>
  );
}

// ---------- Unreachable ----------

const UNREACHABLE_COLUMNS: Column<UnreachableLink>[] = [
  { id: "url", header: "URL", cell: (u) => <UrlLink href={u.url} />, sortValue: (u) => u.url },
  {
    id: "error",
    header: "Error",
    cell: (u) => <span className="text-xs text-muted">{friendlyError(u.error)}</span>,
    sortValue: (u) => u.error,
  },
  { id: "foundOn", header: "Found on", cell: (u) => <UrlList urls={u.foundOn} /> },
];

export function UnreachableTable({ result, toolbar }: { result: ScanResult; toolbar?: ReactNode }) {
  return (
    <DataTable
      rows={result.unreachable}
      columns={UNREACHABLE_COLUMNS}
      rowKey={(u) => u.url}
      searchText={(u) => `${u.url} ${u.error}`}
      toolbar={toolbar}
      empty="Every URL responded."
    />
  );
}

// ---------- Helpers ----------

/** First few URLs; the rest behind a "+N more" toggle. */
function UrlList({ urls }: { urls: string[] }) {
  if (!urls.length) return <span className="font-mono text-xs text-subtle">—</span>;
  const shown = urls.slice(0, 3);
  const rest = urls.slice(3);
  return (
    <div className="space-y-0.5">
      {shown.map((u) => (
        <div key={u}>
          <UrlLink href={u} />
        </div>
      ))}
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[11px] text-subtle hover:text-ink">
            +{rest.length} more
          </summary>
          <div className="mt-0.5 space-y-0.5">
            {rest.map((u) => (
              <div key={u}>
                <UrlLink href={u} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Num({ value }: { value: number }) {
  return <span className="font-mono text-xs text-ink tabular-nums">{value.toLocaleString()}</span>;
}

function shortType(contentType: string | null): string {
  if (!contentType) return "—";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("image/")) return mime.slice(6).replace("svg+xml", "svg");
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("javascript")) return "js";
  if (mime === "text/css") return "css";
  return mime.split("/")[1] ?? mime;
}
