"use client";

// Visit Test: every page as a card with its screenshot. Click a card for the full details.

import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { pageProblems } from "@/lib/visit-checklist";
import type { VisitPage } from "@/lib/visit-types";
import { StatusCode, displayUrl } from "@/components/ui/primitives";

const PAGE_SIZE = 48;

type Filter = "all" | "problems" | "ok";

export function VisitPageCards({ pages, renderDetail }: { pages: VisitPage[]; renderDetail: (page: VisitPage) => ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<VisitPage | null>(null);

  const rows = pages.map((page, i) => ({ n: i + 1, page, problems: pageProblems(page) }));
  const counts = { all: rows.length, problems: rows.filter((r) => r.problems.length).length, ok: rows.filter((r) => !r.problems.length).length };
  const visible = rows.filter((r) => filter === "all" || (filter === "problems") === r.problems.length > 0);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 border-b border-line p-3" role="group" aria-label="Show pages">
        {(["all", "problems", "ok"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(PAGE_SIZE);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              filter === f ? "border-accent/50 bg-accent/15 text-ink" : "border-line text-muted hover:text-ink"
            }`}
          >
            {f === "all" ? "All" : f === "problems" ? "Problems" : "OK"}
            <span className="font-mono text-[10px] text-subtle tabular-nums">{counts[f]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted">{filter === "problems" ? "No pages with problems." : "No pages yet."}</div>
      ) : (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.slice(0, limit).map(({ n, page, problems }) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => setOpen(page)}
                className={`group flex h-full w-full flex-col overflow-hidden rounded-lg border bg-surface text-left transition hover:border-line-strong hover:bg-surface-2 ${
                  problems.length ? "border-status-warning/50" : "border-line"
                }`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-black/30">
                  {page.screenshot ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot
                    <img src={page.screenshot} alt="" loading="lazy" className="size-full object-cover object-top transition group-hover:scale-[1.02]" />
                  ) : (
                    <div className="grid size-full place-items-center text-xs text-subtle">No screenshot</div>
                  )}
                  <span className="absolute top-1.5 left-1.5 rounded bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">#{n}</span>
                  <span className="absolute top-1.5 right-1.5 rounded bg-canvas/85 px-1.5 py-0.5 text-xs">
                    {page.status !== null ? <StatusCode status={page.status} /> : <span className="font-mono text-status-serious">none</span>}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                  <div className="truncate text-sm font-medium text-ink">{page.title ?? "(no title)"}</div>
                  <div className="truncate font-mono text-[11px] text-link" title={page.finalUrl}>
                    {displayUrl(page.finalUrl)}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs">
                    {problems.length ? (
                      <span className="flex min-w-0 items-center gap-1 text-status-warning">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate" title={problems.join(" · ")}>
                          {problems.join(" · ")}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-status-good">
                        <CircleCheck className="size-3.5" aria-hidden /> OK
                      </span>
                    )}
                    <span className={`shrink-0 font-mono tabular-nums ${(page.loadMs ?? 0) > 8000 ? "text-status-warning" : "text-subtle"}`}>
                      {page.loadMs != null ? formatMs(page.loadMs) : "–"}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-line px-4 py-2 font-mono text-[11px] text-subtle">
        <span>
          {Math.min(limit, visible.length).toLocaleString()} / {visible.length.toLocaleString()} pages
        </span>
        {visible.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="rounded-md px-2 py-0.5 text-muted hover:bg-surface-2 hover:text-ink">
            Show {Math.min(PAGE_SIZE, visible.length - limit)} more
          </button>
        )}
      </div>

      {open && <DetailDialog onClose={() => setOpen(null)}>{renderDetail(open)}</DetailDialog>}
    </div>
  );
}

function DetailDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label="Page details">
      <div className="relative mx-auto max-w-4xl rounded-xl bg-canvas" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-2 -right-2 z-10 grid size-8 place-items-center rounded-full border border-line bg-surface text-muted shadow-lg hover:text-ink"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
