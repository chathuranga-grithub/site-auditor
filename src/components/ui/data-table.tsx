"use client";

// Generic table for tool results: text search, quick-filter chips, sortable columns,
// and "show more" paging. Column and filter definitions come from the caller.

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables sorting on this column. null sorts last. */
  sortValue?: (row: T) => string | number | null;
  /** Extra classes for both <th> and <td> (width, alignment). */
  className?: string;
}

export interface QuickFilter<T> {
  id: string;
  label: string;
  test: (row: T) => boolean;
}

type SortState = { id: string; dir: "asc" | "desc" } | null;

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Text matched by the search box. Omit to hide search. */
  searchText?: (row: T) => string;
  filters?: QuickFilter<T>[];
  defaultSort?: SortState;
  empty: ReactNode;
  toolbar?: ReactNode;
  pageSize?: number;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  filters = [],
  defaultSort = null,
  empty,
  toolbar,
  pageSize = 100,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [filterId, setFilterId] = useState("all");
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [limit, setLimit] = useState(pageSize);

  const filterCounts = useMemo(
    () => new Map(filters.map((f) => [f.id, rows.filter(f.test).length])),
    [filters, rows],
  );

  const visible = useMemo(() => {
    const active = filters.find((f) => f.id === filterId);
    const q = query.trim().toLowerCase();
    let out = rows.filter(
      (row) => (!active || active.test(row)) && (!q || !searchText || searchText(row).toLowerCase().includes(q)),
    );
    const col = sort && columns.find((c) => c.id === sort.id);
    if (sort && col?.sortValue) {
      const value = col.sortValue;
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (va === vb) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return (va < vb ? -1 : 1) * dir;
      });
    }
    return out;
  }, [rows, filters, filterId, query, searchText, sort, columns]);

  const toggleSort = (id: string) =>
    setSort((s) => (s?.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));

  return (
    <div>
      {(searchText || filters.length > 0 || toolbar) && (
        <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
          {searchText && (
            <label className="relative block lg:w-72">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(pageSize);
                }}
                placeholder="Search URLs…"
                className="h-8 w-full rounded-lg border border-line bg-canvas/60 pr-3 pl-9 font-mono text-xs text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              />
            </label>
          )}
          {filters.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
              <FilterChip
                active={filterId === "all"}
                onClick={() => setFilterId("all")}
                label="All"
                count={rows.length}
              />
              {filters.map((f) => (
                <FilterChip
                  key={f.id}
                  active={filterId === f.id}
                  onClick={() => {
                    setFilterId(f.id);
                    setLimit(pageSize);
                  }}
                  label={f.label}
                  count={filterCounts.get(f.id) ?? 0}
                />
              ))}
            </div>
          )}
          {toolbar && <div className="flex gap-1.5 lg:ml-auto">{toolbar}</div>}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted">{rows.length ? "No rows match." : empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-surface font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={sort?.id === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`px-4 py-2.5 font-medium whitespace-nowrap ${c.className ?? ""}`}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className="inline-flex items-center gap-1 uppercase hover:text-ink"
                      >
                        {c.header}
                        {sort?.id === c.id ? (
                          sort.dir === "asc" ? (
                            <ArrowUp className="size-3 text-accent-2" />
                          ) : (
                            <ArrowDown className="size-3 text-accent-2" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.slice(0, limit).map((row) => (
                <tr key={rowKey(row)} className="transition-colors hover:bg-surface-2">
                  {columns.map((c) => (
                    <td key={c.id} className={`px-4 py-2 align-top ${c.className ?? ""}`}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line px-4 py-2 font-mono text-[11px] text-subtle">
        <span>
          {Math.min(limit, visible.length).toLocaleString()} / {visible.length.toLocaleString()} rows
          {visible.length !== rows.length && ` · filtered from ${rows.length.toLocaleString()}`}
        </span>
        {visible.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + pageSize)}
            className="rounded-md px-2 py-0.5 text-muted hover:bg-surface-2 hover:text-ink"
          >
            Show {Math.min(pageSize, visible.length - limit)} more
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition ${
        active
          ? "border-accent/60 bg-accent/15 text-ink"
          : "border-line text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {label}
      <span className="font-mono tabular-nums opacity-70">{count}</span>
    </button>
  );
}
