"use client";

// Charts for the Keyword Rankings report.
// - PositionBars: one measure (e.g. word count) for each ranking position, single series.
// - CheckCoverage: how many of the top results pass each SEO check.
// Single-hue series colour (dataviz slot 1); status colours stay reserved for pass/fail.

import { useState } from "react";

export interface PositionDatum {
  position: number;
  domain: string;
  /** null = page couldn't be analysed. */
  value: number | null;
}

export function PositionBars({
  data,
  format,
  formatExact = format,
  caption,
}: {
  data: PositionDatum[];
  /** Short format for axis labels (e.g. "15k"). */
  format: (v: number) => string;
  /** Exact format for the tooltip (e.g. "14,563"). Defaults to `format`. */
  formatExact?: (v: number) => string;
  /** One-line explanation under the chart title. */
  caption?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = niceMax(values.length ? Math.max(...values) : 0);
  const ticks = [max, max / 2, 0];
  const active = data.find((d) => d.position === hover);

  return (
    <div>
      {caption && <p className="mb-3 text-xs text-muted">{caption}</p>}
      <div className="relative flex gap-3">
        {/* Y axis */}
        <div className="flex h-44 w-12 shrink-0 flex-col justify-between text-right font-mono text-[10px] text-subtle tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {format(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44" aria-hidden>
            {ticks.map((t, i) => (
              <div key={t} className="absolute inset-x-0 border-t border-line" style={{ top: `${(i / 2) * 100}%` }} />
            ))}
          </div>

          {/* Bars */}
          <div className="relative flex h-44 items-end gap-[2px]" role="img" aria-label={caption}>
            {data.map((d) => {
              const pct = d.value === null || max === 0 ? 0 : (d.value / max) * 100;
              return (
                <button
                  key={d.position}
                  type="button"
                  aria-label={`#${d.position} ${d.domain}: ${d.value === null ? "not analysed" : formatExact(d.value)}`}
                  onMouseEnter={() => setHover(d.position)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(d.position)}
                  onBlur={() => setHover(null)}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center px-0.5 sm:px-1.5"
                >
                  {d.value === null ? (
                    <span className="mb-0.5 block h-0 w-full max-w-10 border-t border-dashed border-subtle" />
                  ) : (
                    <span
                      className={`block w-full max-w-10 rounded-t-[4px] bg-series-1 transition-opacity ${
                        hover !== null && hover !== d.position ? "opacity-40" : ""
                      }`}
                      style={{ height: `${Math.max(pct, d.value > 0 ? 1.5 : 0)}%` }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* X axis */}
          <div className="mt-2 flex gap-[2px] font-mono text-[10px] text-subtle">
            {data.map((d) => (
              <span key={d.position} className={`flex-1 text-center ${hover === d.position ? "text-ink" : ""}`}>
                #{d.position}
              </span>
            ))}
          </div>

          {/* Tooltip */}
          {active && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-surface-solid px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
              style={{ left: `clamp(4rem, ${((active.position - 0.5) / data.length) * 100}%, calc(100% - 4rem))` }}
            >
              <div className="font-mono text-[10px] text-subtle">#{active.position}</div>
              <div className="text-ink">{active.domain}</div>
              <div className="font-mono font-semibold text-ink tabular-nums">
                {active.value === null ? "not analysed" : formatExact(active.value)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export interface CoverageItem {
  label: string;
  rule: string;
  passed: number;
  total: number;
}

/** Share of analysed results passing each check, as horizontal bars with direct labels. */
export function CheckCoverage({ items }: { items: CoverageItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const pct = it.total ? (it.passed / it.total) * 100 : 0;
        return (
          <li key={it.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 sm:grid-cols-[11rem_1fr_auto]">
            <span className="truncate text-xs text-ink" title={it.rule}>
              {it.label}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-r-[4px] bg-series-1" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-20 text-right font-mono text-xs text-ink tabular-nums">
              {it.passed}/{it.total}
              <span className="ml-1.5 text-subtle">{Math.round(pct)}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Round the axis maximum up to a readable number (1, 2, 2.5, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
