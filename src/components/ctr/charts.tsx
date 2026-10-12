"use client";

// The Auto CTR dashboard's charts, on Recharts: smooth lines with a soft glow over a gradient wash,
// rounded gradient bars, a frosted tooltip listing every series at that day, and animations (lines
// draw in, bars grow, numbers count up; always, even with Windows' animation effects off). The dataviz
// rules still hold: one y-axis per chart, whole-number ticks, hairline grid, a legend for two or
// more series, text in text tokens (never a series color), and a table view of every chart.
// Colors: the dark categorical slots, validated on this app's surface (#0f1118), in fixed order.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineIcon, Table2 } from "lucide-react";

/** Categorical slots (dark-surface steps), in fixed order: identity follows the entity, never its rank. */

export const SERIES = ["#3987e5", "#199e70", "#d95926", "#9085e9", "#c98500", "#d55181", "#008300", "#e66767"];
/** Phone and desktop (and any chart's two parts): blue and teal, the first two slots. */
export const PHONE = SERIES[0];
export const DESKTOP = SERIES[1];
/** A reference line (e.g. the plan): neutral ink, not a series hue. */
const REFERENCE = "#9aa0b4";
const GRID = "#ffffff12";
const TICK = { fill: "#646a80", fontSize: 10, fontFamily: "var(--font-geist-mono), monospace" };

export const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const compact = (n: number) => (Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : Math.round(n).toLocaleString());

/** True when the system asks for less motion: charts and numbers then appear at once. */
/**
 * Whether the element has been scrolled into view (a quarter of it on screen), once: charts play
 * their animation then, not when the page loads. Without IntersectionObserver: at once.
 */
export function useInView<T extends Element>(threshold = 0.25): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/**
 * Children that play their animation when scrolled into view: kept invisible until then (the page
 * keeps its layout), and drawn afresh at that moment, so bars rise, lines draw in and numbers count.
 */
export function PlayInView({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  return (
    <div ref={ref} className={className}>
      <div key={seen || reduced ? "in" : "out"} style={{ opacity: seen || reduced ? 1 : 0, transition: "opacity 300ms ease" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Whether to skip the animations. Never: the dashboard always animates, even when Windows' "Animation
 * effects" is off (which browsers pass on as prefers-reduced-motion) - asked for by the team.
 */
export function useReducedMotion(): boolean {
  return false;
}

/** A number counting up to its value (ease-out, ~0.9s), again when the value changes. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString(), duration = 1100 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const reduced = useReducedMotion();
  // Counts once it's on screen (a number further down starts when it's scrolled to).
  const [ref, seen] = useInView<HTMLSpanElement>(0.1);
  const [shown, setShown] = useState(0);
  // It counts up once; later changes (e.g. a live number updating) show the new value straight away.
  const counted = useRef(false);
  useEffect(() => {
    if (reduced || !seen) return;
    let raf = 0;
    if (counted.current) {
      raf = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (t: number) => {
      // A frame can be timed just before the start: never below 0.
      const k = Math.min(1, Math.max(0, (t - start) / duration));
      setShown(value * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
      else counted.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, seen, duration]);
  return (
    <span ref={ref} className="tabular-nums">
      {format(reduced ? value : shown)}
    </span>
  );
}

export interface Legend {
  label: string;
  color: string;
  kind: "bar" | "line" | "reference";
}

function LegendRow({ items }: { items: Legend[] }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {items.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5">
          {l.kind === "bar" ? (
            <span className="size-2.5 rounded-[3px]" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}66` }} aria-hidden />
          ) : (
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: l.color, opacity: l.kind === "reference" ? 0.7 : 1 }} aria-hidden />
          )}
          {l.label}
        </span>
      ))}
    </div>
  );
}

interface TipRow {
  label: string;
  value: string;
  color: string;
}

/** The hover readout: frosted, the day first, then each series' value (values lead, labels follow). */
function Tip({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="min-w-40 rounded-xl border border-white/10 bg-[#0f1118]/80 px-3 py-2.5 text-xs shadow-[0_8px_32px_-8px_rgba(0,0,0,0.8)] backdrop-blur-md">
      <div className="mb-1.5 font-mono text-[10px] tracking-wide text-subtle">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 whitespace-nowrap">
            <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden />
            <span className="font-mono font-semibold text-ink tabular-nums">{r.value}</span>
            <span className="text-muted">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A chart's frame: title, what it shows, its legend, and a switch to the same numbers as a table
 * (every value reachable without hovering). `empty`: nothing to plot yet, said in words.
 */
export function ChartCard({
  title,
  subtitle,
  legend = [],
  table,
  empty,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: Legend[];
  table: { head: string[]; rows: (string | number)[][] };
  empty?: string | false;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`glass group/card relative min-w-0 overflow-hidden rounded-2xl p-4 transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[0_16px_48px_-20px_#8b5cf680] ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity group-hover/card:opacity-100" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-subtle">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
          aria-label={asTable ? "Show as a chart" : "Show as a table"}
          title={asTable ? "Show as a chart" : "Show as a table"}
        >
          {asTable ? <LineIcon className="size-3.5" /> : <Table2 className="size-3.5" />}
        </button>
      </div>
      {!empty && !asTable && (
        <div className="mt-2">
          <LegendRow items={legend} />
        </div>
      )}
      <div className="mt-2">
        {asTable ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left font-mono text-[11px] tabular-nums">
              <thead className="sticky top-0 bg-surface-solid text-[10px] text-subtle uppercase">
                <tr>
                  {table.head.map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className="px-2 py-1 text-muted">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : empty ? (
          <div className="grid h-[200px] place-items-center rounded-xl border border-dashed border-line text-center text-xs text-subtle">
            <span className="max-w-64">{empty}</span>
          </div>
        ) : (
          <PlayInView>{children}</PlayInView>
        )}
      </div>
    </section>
  );
}

/** Whole-number ticks for counts (no "1, 1, 2, 2" from fractional steps). */
const axisProps = (format: (n: number) => string) => ({
  tick: TICK,
  tickLine: false,
  axisLine: false,
  width: 44,
  allowDecimals: false,
  tickFormatter: (v: number) => format(v),
});

/**
 * Columns per day, stacked (e.g. phone + desktop), with an optional reference line on the same
 * scale (e.g. the plan). Bars grow from the baseline; the top segment has a rounded end.
 */
export function ColumnChart({
  days,
  stacks,
  reference,
  height = 220,
  format = compact,
}: {
  days: string[];
  stacks: { label: string; color: string; values: number[] }[];
  reference?: { label: string; values: number[] };
  height?: number;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  // The day under the pointer stays solid; the other days dim.
  const [hover, setHover] = useState<number | null>(null);
  const data = days.map((d, i) => ({ day: d, ...Object.fromEntries(stacks.map((s, k) => [`s${k}`, s.values[i] ?? 0])), planned: reference?.values[i] ?? null }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="32%"
          onMouseMove={(s) => setHover(s?.activeTooltipIndex != null ? Number(s.activeTooltipIndex) : null)}
          onMouseLeave={() => setHover(null)}
        >
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={TICK} tickLine={false} axisLine={{ stroke: "#ffffff26" }} minTickGap={24} />
          <YAxis {...axisProps(format)} />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <Tip
                  title={shortDay(String(label))}
                  rows={[
                    { label: "total", value: format(stacks.reduce((n, _, k) => n + Number(payload[0].payload[`s${k}`] ?? 0), 0)), color: "#ffffff40" },
                    ...stacks.map((s, k) => ({ label: s.label, value: format(Number(payload[0].payload[`s${k}`] ?? 0)), color: s.color })),
                    ...(reference ? [{ label: reference.label, value: format(Number(payload[0].payload.planned ?? 0)), color: REFERENCE }] : []),
                  ]}
                />
              ) : null
            }
          />
          {stacks.map((s, k) => (
            <Bar
              key={k}
              dataKey={`s${k}`}
              stackId="a"
              fill={s.color}
              // Crisp: square ends with a hint of rounding on top, and a surface gap between segments (the
              // same outline on every segment, so they all keep the same width).
              radius={k === stacks.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              stroke="#0f1118"
              strokeWidth={stacks.length > 1 ? 1 : 0}
              maxBarSize={40}
              // On opening: the bars rise one after another, left to right (a CSS wave, see bar-rise in
              // globals.css; none with reduced motion), the upper segment just after the lower one.
              isAnimationActive={false}
              shape={(p: BarShapeProps) => <RisingBar {...p} delay={(p.index ?? 0) * 45 + k * 140} />}
            >
              {data.map((_, i) => (
                <Cell key={i} fillOpacity={hover == null || hover === i ? 1 : 0.4} style={{ transition: "fill-opacity 200ms ease" }} />
              ))}
            </Bar>
          ))}
          {reference && (
            <Line
              dataKey="planned"
              type="linear"
              stroke={REFERENCE}
              strokeWidth={1.5}
              strokeOpacity={0.8}
              dot={{ r: 2, fill: REFERENCE, strokeWidth: 0 }}
              activeDot={{ r: 4, fill: REFERENCE, stroke: "#0f1118", strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={600}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export type BarShapeProps = React.ComponentProps<typeof Rectangle> & { index?: number };

/** One bar segment that rises from its bottom when it first appears, after `delay` ms. */
export function RisingBar({ delay, ...p }: BarShapeProps & { delay: number }) {
  return (
    <g className="bar-rise" style={{ animationDelay: `${delay}ms` }}>
      <Rectangle {...p} />
    </g>
  );
}

/**
 * Smooth lines per day over a soft gradient wash, with a glow (null = no value that day: a gap).
 * `invert`: smaller is better and on top (a Google position). The tooltip lists every series.
 */
export function LineChart({
  days,
  series,
  height = 220,
  invert = false,
  format = compact,
  min,
  max,
}: {
  days: string[];
  series: { label: string; color: string; values: (number | null)[] }[];
  height?: number;
  invert?: boolean;
  format?: (n: number) => string;
  min?: number;
  max?: number;
}) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const data = days.map((d, i) => ({ day: d, ...Object.fromEntries(series.map((s, k) => [`s${k}`, s.values[i]])) }));
  const lo = min ?? (invert ? 1 : 0);
  const show = (v: number) => (invert ? `#${format(v)}` : format(v));
  // One wash only, under a single series: several overlapping fills would muddy each other.
  const wash = series.length === 1;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${id}-a${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={wash ? 0.22 : 0} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
          <YAxis {...axisProps(show)} reversed={invert} domain={[lo, max ?? "auto"]} />
          <Tooltip
            cursor={{ stroke: "#ffffff30", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <Tip
                  title={shortDay(String(label))}
                  rows={series.map((s, k) => {
                    const v = payload[0].payload[`s${k}`] as number | null | undefined;
                    return { label: s.label, value: v != null ? show(v) : "–", color: s.color };
                  })}
                />
              ) : null
            }
          />
          {series.map((s, k) => (
            <Area
              key={k}
              dataKey={`s${k}`}
              type="monotone"
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#${id}-a${k})`}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 5, fill: s.color, stroke: "#0f1118", strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={1100}
              animationBegin={k * 150}
              animationEasing="ease-out"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A tiny animated trend (no axes): a line over a gradient wash; for tiles, rows and cards. */
export function Sparkline({ values, width = 96, height = 28, color = SERIES[0] }: { values: (number | null)[]; width?: number; height?: number; color?: string }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>(0.5);
  if (values.filter((v) => v != null).length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden />;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div ref={ref} style={{ width, height }} aria-hidden>
      <AreaChart key={seen || reduced ? "in" : "out"} style={{ opacity: seen || reduced ? 1 : 0 }} width={width} height={height} data={data} margin={{ top: 3, right: 3, bottom: 1, left: 1 }}>
        <defs>
          <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area dataKey="v" type="monotone" stroke={color} strokeWidth={1.5} fill={`url(#${id}-s)`} dot={false} connectNulls isAnimationActive={!reduced} animationDuration={900} />
      </AreaChart>
    </div>
  );
}

/** One horizontal bar per row (one series: one color), growing in; the value at the bar's tip. */
export function BarList({ rows, format = compact }: { rows: { label: ReactNode; value: number; detail?: string; highlight?: boolean }[]; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  // The bars grow in when the list is scrolled into view.
  const [ref, seen] = useInView<HTMLUListElement>();
  const grown = reduced || seen;
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="py-6 text-center text-xs text-subtle">Nothing in this range yet.</div>;
  return (
    <ul ref={ref} className="space-y-3">
      {rows.map((r, i) => (
        <li key={i} className={`text-xs ${r.highlight ? "-mx-2 rounded-lg bg-accent/10 px-2 py-1.5 ring-1 ring-accent/40" : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-muted">{r.label}</span>
            <span className="shrink-0 font-mono text-ink tabular-nums">
              <CountUp value={r.value} format={format} />
              {r.detail && <span className="ml-1.5 text-subtle">{r.detail}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-2 rounded-full transition-[width] duration-1000 ease-out"
              style={{ width: grown ? `${Math.max(2, (r.value / max) * 100)}%` : "0%", background: `linear-gradient(90deg, ${SERIES[0]}99, ${SERIES[0]})`, boxShadow: `0 0 12px ${SERIES[0]}55`, transitionDelay: `${i * 80}ms` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
