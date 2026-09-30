"use client";

// Part-to-whole bar of HTTP status classes for every crawled URL.
// Status colors are the reserved status palette; every segment also has a labelled legend row.

import { useState } from "react";
import type { ScanResult } from "@/lib/types";
import { statusBreakdown } from "@/lib/report";

const SEGMENTS = [
  { key: "ok", label: "2xx OK", color: "bg-status-good" },
  { key: "redirect", label: "Redirected", color: "bg-status-warning" },
  { key: "client", label: "4xx Client error", color: "bg-status-serious" },
  { key: "server", label: "5xx Server error", color: "bg-status-critical" },
  { key: "other", label: "No response / blocked", color: "bg-subtle" },
] as const;

export function StatusBreakdown({ result }: { result: ScanResult }) {
  const counts = statusBreakdown(result);
  const total = result.pages.length;
  const [hover, setHover] = useState<string | null>(null);

  const parts = SEGMENTS.map((s) => ({ ...s, count: counts[s.key] })).filter((s) => s.count > 0);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  // Tooltip is centered over the hovered segment.
  const positioned = parts.map((p, i) => {
    const before = parts.slice(0, i).reduce((sum, q) => sum + pct(q.count), 0);
    return { ...p, mid: before + pct(p.count) / 2 };
  });
  const active = positioned.find((p) => p.key === hover);

  return (
    <div>
      <div className="relative pt-10">
        <div className="absolute top-0 left-0 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums">{total.toLocaleString()}</span>
          <span className="font-mono text-[11px] text-subtle">responses</span>
        </div>
        {active && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-surface-solid px-2.5 py-1 font-mono text-[11px] whitespace-nowrap text-ink shadow-lg"
            style={{ left: `clamp(4rem, ${active.mid}%, calc(100% - 4rem))` }}
          >
            {active.label}: <span className="font-semibold">{active.count.toLocaleString()}</span>{" "}
            <span className="text-muted">({pct(active.count).toFixed(1)}%)</span>
          </div>
        )}
        <div className="flex h-3 gap-[2px]" role="img" aria-label="HTTP status breakdown">
          {total === 0 ? (
            <div className="h-full flex-1 rounded bg-surface-2" />
          ) : (
            positioned.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-label={`${p.label}: ${p.count}`}
                onMouseEnter={() => setHover(p.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p.key)}
                onBlur={() => setHover(null)}
                className={`h-full min-w-[3px] rounded ${p.color} transition-opacity ${
                  hover && hover !== p.key ? "opacity-40" : ""
                }`}
                style={{ flexGrow: p.count, flexBasis: 0 }}
              />
            ))
          )}
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {SEGMENTS.map((s) => (
          <li
            key={s.key}
            className="flex items-center gap-2 text-xs"
            onMouseEnter={() => counts[s.key] && setHover(s.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span className={`size-2 shrink-0 rounded-sm ${s.color}`} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="ml-auto font-mono text-ink tabular-nums">{counts[s.key].toLocaleString()}</span>
            <span className="w-12 text-right font-mono text-subtle tabular-nums">{pct(counts[s.key]).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
