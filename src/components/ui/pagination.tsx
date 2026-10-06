"use client";

// Page-by-page navigation for long result lists: "1–24 of 243", Previous, page numbers, Next.

import { ChevronLeft, ChevronRight } from "lucide-react";

/** Page numbers to show, with null for a gap: 1 … 4 5 6 … 11 */
function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < pages);
  const list: (number | null)[] = [1];
  if (around[0] > 2) list.push(null);
  list.push(...around);
  if (around[around.length - 1] < pages - 1) list.push(null);
  list.push(pages);
  return list;
}

export function Pagination({
  page,
  pageSize,
  total,
  unit,
  onPage,
}: {
  /** 1-based */
  page: number;
  pageSize: number;
  total: number;
  /** e.g. "pages", "rows" */
  unit: string;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const btn = "inline-grid h-7 min-w-7 place-items-center rounded-md px-1.5 font-mono text-[11px] tabular-nums transition disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2" aria-label="Pages of results">
      <span className="font-mono text-[11px] text-subtle tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {unit}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={`${btn} text-muted hover:bg-surface-2 hover:text-ink`}>
            <ChevronLeft className="size-3.5" />
          </button>
          {pageList(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 font-mono text-[11px] text-subtle">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                className={`${btn} ${p === page ? "bg-accent/20 text-ink ring-1 ring-accent/50" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page" className={`${btn} text-muted hover:bg-surface-2 hover:text-ink`}>
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </nav>
  );
}
