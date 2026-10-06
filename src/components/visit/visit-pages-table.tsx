"use client";

// Visit Test list view: every page with small desktop and phone screenshots, its checks, search,
// problem filters, sorting and page-by-page navigation.

import { useMemo } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { pageActivities, pageProblems } from "@/lib/visit-checklist";
import type { VisitPage } from "@/lib/visit-types";
import { DataTable, type Column, type QuickFilter } from "@/components/ui/data-table";
import { StatusCode, UrlLink } from "@/components/ui/primitives";
import { ActivityIcons } from "./visit-page-cards";

const PAGE_SIZE = 50;

interface Row {
  n: number;
  page: VisitPage;
  problems: string[];
}

const thumbColumn = (onOpen: (page: VisitPage) => void): Column<Row> => ({
  id: "shot",
  header: "",
  cell: (r) => (
    <button
      type="button"
      onClick={() => onOpen(r.page)}
      aria-label={`Details for ${r.page.title ?? r.page.url}`}
      className="flex items-stretch gap-1 rounded transition hover:opacity-90"
    >
      <span className={`block h-[54px] w-24 overflow-hidden rounded border bg-black/30 ${r.problems.length ? "border-status-warning/50" : "border-line"}`}>
        {r.page.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot
          <img src={r.page.screenshot} alt="" loading="lazy" className="size-full object-cover object-top" />
        ) : (
          <span className="grid size-full place-items-center text-[10px] text-subtle">none</span>
        )}
      </span>
      {r.page.mobile?.screenshot && (
        <span className="block h-[54px] w-[27px] overflow-hidden rounded border border-line bg-black/30" title="Phone view">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL screenshot */}
          <img src={r.page.mobile.screenshot} alt="" loading="lazy" className="size-full object-cover object-top" />
        </span>
      )}
    </button>
  ),
  className: "w-36",
});

const COLUMNS: Column<Row>[] = [
  {
    id: "n",
    header: "#",
    cell: (r) => <span className="font-mono text-xs text-subtle tabular-nums">{r.n}</span>,
    sortValue: (r) => r.n,
    className: "w-12",
  },
  {
    id: "status",
    header: "Status",
    cell: (r) => (r.page.status !== null ? <StatusCode status={r.page.status} /> : <span className="font-mono text-xs text-status-serious">none</span>),
    sortValue: (r) => r.page.status,
    className: "w-20",
  },
  {
    id: "page",
    header: "Page",
    cell: (r) => (
      <div className="min-w-0 space-y-0.5">
        <div className="truncate text-ink">{r.page.title ?? "(no title)"}</div>
        <UrlLink href={r.page.finalUrl} />
      </div>
    ),
    sortValue: (r) => r.page.finalUrl,
  },
  {
    id: "found",
    header: "Found in",
    cell: (r) => <span className="text-xs text-muted">{r.page.kind === "start" ? "start page" : r.page.foundIn === "another page" ? "link on a page" : r.page.foundIn}</span>,
    sortValue: (r) => (r.page.kind === "start" ? "" : (r.page.foundIn ?? "")),
    className: "w-28",
  },
  {
    id: "load",
    header: "Load",
    cell: (r) => (
      <span className={`font-mono text-xs tabular-nums ${(r.page.loadMs ?? 0) > 8000 ? "text-status-warning" : "text-muted"}`}>
        {r.page.loadMs != null ? formatMs(r.page.loadMs) : "–"}
      </span>
    ),
    sortValue: (r) => r.page.loadMs,
    className: "w-20 text-right",
  },
  {
    id: "result",
    header: "Result / checks",
    cell: (r) => (
      <div className="space-y-1.5">
        {r.problems.length ? (
          <span className="flex gap-1.5 text-xs text-status-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {r.problems.join(" · ")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-status-good">
            <CircleCheck className="size-3.5" aria-hidden /> OK
          </span>
        )}
        <ActivityIcons items={pageActivities(r.page)} />
      </div>
    ),
    sortValue: (r) => r.problems.length,
    className: "w-64",
  },
];

const FILTERS: QuickFilter<Row>[] = [
  { id: "problems", label: "Problems", test: (r) => r.problems.length > 0 },
  { id: "errors", label: "Didn't load", test: (r) => !r.page.ok },
  { id: "slow", label: "Slow", test: (r) => (r.page.loadMs ?? 0) > 8000 },
  { id: "images", label: "Broken images", test: (r) => !!r.page.scroll?.brokenImages.length },
  { id: "phone", label: "Phone problems", test: (r) => r.problems.some((p) => p.startsWith("Phone")) },
];

export function VisitPagesTable({ pages, onOpen }: { pages: VisitPage[]; onOpen: (page: VisitPage) => void }) {
  const rows: Row[] = pages.map((page, i) => ({ n: i + 1, page, problems: pageProblems(page) }));
  const columns = useMemo(() => [COLUMNS[0], thumbColumn(onOpen), ...COLUMNS.slice(1)], [onOpen]);
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => `${r.n}`}
      searchText={(r) => `${r.page.url} ${r.page.finalUrl} ${r.page.title ?? ""}`}
      filters={FILTERS}
      empty="No pages visited yet."
      pageSize={PAGE_SIZE}
      paged
    />
  );
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
