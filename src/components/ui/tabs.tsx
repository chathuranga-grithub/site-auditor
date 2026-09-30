"use client";

// Tab bar with optional counts. The caller renders the active panel.

import { SEVERITY_DOT, type Severity } from "./primitives";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  /** Shows a status dot when the tab has something to look at. */
  severity?: Severity;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
      {items.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`relative inline-flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
              active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t.severity && !!t.count && (
              <span className={`size-1.5 rounded-full ${SEVERITY_DOT[t.severity]}`} aria-hidden />
            )}
            {t.label}
            {t.count !== undefined && (
              <span
                className={`rounded-md px-1.5 font-mono text-[11px] tabular-nums ${
                  active ? "bg-accent/20 text-ink" : "bg-surface-2 text-subtle"
                }`}
              >
                {t.count.toLocaleString()}
              </span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-accent" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
