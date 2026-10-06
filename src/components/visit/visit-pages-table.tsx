"use client";

// Visit Test: every page the test opened, with search, problem filters and sorting.

import { CircleCheck, TriangleAlert } from "lucide-react";
import { pageProblems } from "@/lib/visit-checklist";
import type { VisitPage } from "@/lib/visit-types";
import { DataTable, type Column, type QuickFilter } from "@/components/ui/data-table";
import { StatusCode, UrlLink } from "@/components/ui/primitives";

interface Row {
  n: number;
  page: VisitPage;
  problems: string[];
}

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
    header: "Result",
    cell: (r) =>
      r.problems.length ? (
        <span className="flex gap-1.5 text-xs text-status-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {r.problems.join(" · ")}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-status-good">
          <CircleCheck className="size-3.5" aria-hidden /> OK
        </span>
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
];

export function VisitPagesTable({ pages }: { pages: VisitPage[] }) {
  const rows: Row[] = pages.map((page, i) => ({ n: i + 1, page, problems: pageProblems(page) }));
  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      rowKey={(r) => `${r.n}`}
      searchText={(r) => `${r.page.url} ${r.page.finalUrl} ${r.page.title ?? ""}`}
      filters={FILTERS}
      empty="No pages visited yet."
    />
  );
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
