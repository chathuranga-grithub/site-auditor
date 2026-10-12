"use client";

// A campaign's realtime view, in the spirit of Google Analytics' Realtime report: visits in the last
// 30 minutes, one bar per minute (moving on live), what each browser is doing right now, and the
// last 30 minutes by device, visitor location and page. Only on the computer that runs the campaign:
// it's read from the live visit console (no database reads), which holds every visit since the app
// started. Nothing in it animates: it changes all the time, so its numbers and bars are shown as
// they are (the dashboard's charts animate; this one stays still).

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Globe, Loader2, MousePointerClick, Search, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
import type { VisitRun } from "@/components/visit/visit-run";
import type { VisitStage } from "@/lib/visit-types";
import { BarList, DESKTOP, PHONE, SERIES } from "./charts";

const MINUTES = 30;
const GRID = "#ffffff12";
const TICK = { fill: "#646a80", fontSize: 10, fontFamily: "var(--font-geist-mono), monospace" };

/** What a browser is doing now, from its lane's step (or its wait). */
const NOW: { key: VisitStage | "wait"; label: string; icon: LucideIcon }[] = [
  { key: "browser", label: "Opening a browser", icon: Loader2 },
  { key: "search", label: "Searching Google", icon: Search },
  { key: "captcha", label: "Solving a CAPTCHA", icon: ShieldCheck },
  { key: "click", label: "Clicking the result", icon: MousePointerClick },
  { key: "visit", label: "On the site", icon: Globe },
  { key: "wait", label: "Waiting", icon: Timer },
];

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

/** Counts per name, most first. */
function tally(names: string[]) {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

export function RealtimePanel({ run }: { run: VisitRun }) {
  // The clock the minutes are counted from: checked every few seconds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const [hover, setHover] = useState<number | null>(null);

  // Like Google Analytics' realtime chart: when a new minute starts, the bars slide one step to the
  // left (from where they were) and the new minute comes in on the right. The only movement here,
  // once a minute; the axis stays put.
  const minute = Math.floor(now / 60_000);
  const chartBox = useRef<HTMLDivElement>(null);
  const lastMinute = useRef(minute);
  useEffect(() => {
    if (minute === lastMinute.current) return;
    lastMinute.current = minute;
    const box = chartBox.current;
    const bars = box?.querySelector<SVGGElement>(".recharts-bar-rectangles");
    if (!box || !bars) return;
    const step = (box.clientWidth - 32) / MINUTES; // the plot's width (less the y-axis) per minute
    bars.animate([{ transform: `translateX(${step}px)` }, { transform: "translateX(0)" }], { duration: 700, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [minute]);

  const recent = useMemo(() => run.visits.filter((v) => now - v.at < MINUTES * 60_000 && !v.report.cancelled), [run.visits, now]);
  const counted = recent.filter((v) => !v.report.stopReason);

  // One bar per minute, oldest on the left, this minute on the right.
  const perMinute = useMemo(() => {
    const rows = Array.from({ length: MINUTES }, (_, i) => ({ ago: MINUTES - 1 - i, visits: 0, phone: 0, desktop: 0, pages: 0, failed: 0 }));
    for (const v of recent) {
      const ago = Math.floor((now - v.at) / 60_000);
      const row = rows[MINUTES - 1 - ago];
      if (!row) continue;
      if (v.report.stopReason) {
        row.failed++;
        continue;
      }
      row.visits++;
      if (v.report.device === "phone") row.phone++;
      else row.desktop++;
      row.pages += (v.report.start?.ok ? 1 : 0) + v.report.pages.length;
    }
    return rows;
  }, [recent, now]);

  const pageViews = perMinute.reduce((n, r) => n + r.pages, 0);
  const failed = perMinute.reduce((n, r) => n + r.failed, 0);
  const avgSec = counted.length ? counted.reduce((n, v) => n + (v.report.onSiteSec ?? 0), 0) / counted.length : null;

  // What each browser (lane) is doing right now.
  const doing = new Map<string, number>();
  if (run.running) {
    for (const n of run.laneNumbers) {
      const l = run.lanes[n];
      if (!l || l.stopped) continue;
      const key = l.wait ? "wait" : (l.stage ?? "browser");
      if (key === "done") continue;
      doing.set(key, (doing.get(key) ?? 0) + 1);
    }
  }
  const active = [...doing.values()].reduce((a, b) => a + b, 0);

  const devices = tally(counted.map((v) => v.report.deviceName ?? (v.report.device === "phone" ? "Phone" : "Desktop")));
  const places = tally(counted.map((v) => [v.report.exit?.city, v.report.exit?.country].filter(Boolean).join(", ") || "Unknown"));
  const pages = tally(counted.flatMap((v) => [...(v.report.start?.ok ? [v.report.start.finalUrl] : []), ...v.report.pages.filter((p) => p.ok).map((p) => p.finalUrl)].map(pathOf)));

  return (
    <section className="glass relative overflow-hidden rounded-2xl p-4">
      <div className="pointer-events-none absolute -top-24 right-0 size-72 rounded-full bg-accent/15 blur-3xl" aria-hidden />
      <header className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5" aria-hidden>
            {/* Still, not pulsing: nothing in this panel keeps animating (it updates for as long as the page is open). */}
            <span className={`relative inline-flex size-2.5 rounded-full ${run.running ? "bg-status-good" : "bg-subtle"}`} />
          </span>
          <h2 className="text-sm font-semibold">Realtime</h2>
          <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${run.running ? "bg-status-good/15 text-status-good" : "bg-surface-2 text-subtle"}`}>
            {run.running ? "Live" : "Not running"}
          </span>
          <span className="text-xs text-subtle">last {MINUTES} minutes · on this PC</span>
        </div>
        <span className="font-mono text-[10px] text-subtle">updates as visits finish</span>
      </header>

      <div className="relative mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <div className="flex flex-col justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Visits in the last {MINUTES} minutes</div>
            <div className="mt-1 text-5xl font-semibold tracking-tight">
              {counted.length.toLocaleString()}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            {[
              ["Page views", pageViews.toLocaleString()],
              ["Didn't count", failed.toLocaleString()],
              ["Time on site", avgSec != null ? `${Math.round(avgSec)}s avg` : "—"],
              ["Browsers now", String(active)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface px-2.5 py-1.5">
                <dt className="text-[10px] text-subtle">{k}</dt>
                <dd className="font-mono font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <div className="mb-1 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Visits per minute</div>
          <div ref={chartBox} className="overflow-hidden" style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={perMinute}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                barCategoryGap="22%"
                onMouseMove={(s) => setHover(s?.activeTooltipIndex != null ? Number(s.activeTooltipIndex) : null)}
                onMouseLeave={() => setHover(null)}
              >
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="ago" tick={TICK} tickLine={false} axisLine={{ stroke: "#ffffff26" }} interval={0} tickFormatter={(v: number) => (v === 0 ? "now" : v % 5 === 0 ? `-${v} min` : "")} />
                <YAxis tick={TICK} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={({ active: on, payload }) => {
                    const r = on && payload?.length ? (payload[0].payload as (typeof perMinute)[number]) : null;
                    if (!r) return null;
                    return (
                      <div className="min-w-40 rounded-xl border border-white/10 bg-[#0f1118]/80 px-3 py-2.5 text-xs shadow-[0_8px_32px_-8px_rgba(0,0,0,0.8)] backdrop-blur-md">
                        <div className="mb-1.5 font-mono text-[10px] text-subtle">{r.ago === 0 ? "this minute" : `${r.ago} min ago`}</div>
                        {[
                          [r.visits, "visits", SERIES[0]],
                          [r.phone, "on a phone", PHONE],
                          [r.desktop, "on a desktop", DESKTOP],
                          [r.pages, "page views", "#9aa0b4"],
                          [r.failed, "didn't count", "#646a80"],
                        ].map(([v, label, color]) => (
                          <div key={String(label)} className="flex items-center gap-2 whitespace-nowrap">
                            <span className="h-0.5 w-3 rounded-full" style={{ background: String(color) }} aria-hidden />
                            <span className="font-mono font-semibold text-ink">{v}</span>
                            <span className="text-muted">{label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="visits" fill={SERIES[0]} radius={[2, 2, 0, 0]} maxBarSize={24} minPointSize={2} isAnimationActive={false}>
                  {perMinute.map((r, i) => (
                    <Cell key={r.ago} fill={r.visits ? SERIES[0] : "#ffffff14"} fillOpacity={hover == null || hover === i ? 1 : 0.4} style={{ transition: "fill-opacity 200ms ease" }} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Right now: what the browsers are doing. */}
      <div className="relative mt-4">
        <div className="mb-2 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Happening now</div>
        <div className="flex flex-wrap gap-2">
          {NOW.map(({ key, label, icon: Icon }) => {
            const n = doing.get(key) ?? 0;
            return (
              <span
                key={key}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition ${n ? "border-accent/50 bg-accent/10 text-ink shadow-[0_0_16px_-4px_#8b5cf680]" : "border-line text-subtle"}`}
              >
                <Icon className={`size-3.5 ${n ? "text-accent" : ""}`} aria-hidden />
                {label}
                <span className="font-mono font-semibold">{n}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* The last 30 minutes, broken down. */}
      <div className="relative mt-4 grid gap-4 md:grid-cols-3">
        {(
          [
            ["Devices", devices],
            ["Visitor locations", places],
            ["Top pages", pages],
          ] as const
        ).map(([title, rows]) => (
          <div key={title} className="rounded-xl border border-line bg-surface p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold">{title}</h3>
              <span className="font-mono text-[10px] text-subtle">last {MINUTES} min</span>
            </div>
            <BarList still rows={rows.slice(0, 5).map(([name, n]) => ({ label: <span className={title === "Top pages" ? "font-mono" : ""}>{name}</span>, value: n }))} />
          </div>
        ))}
      </div>
    </section>
  );
}
