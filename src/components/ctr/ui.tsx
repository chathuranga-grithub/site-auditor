"use client";

// CTR Tracker: pieces shared by the dashboard, campaign list, form and campaign page.

import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheck, CircleDashed, CircleX, Pause, TriangleAlert } from "lucide-react";
import type { CampaignSummary, Health } from "@/lib/campaigns/metrics";
import type { Campaign, CampaignStatus, CtrSetup } from "@/lib/campaigns/types";
import { Notice } from "@/components/ui/primitives";

export interface CampaignItem {
  campaign: Campaign;
  summary: CampaignSummary;
}

export function PageHeader({ section, title, intro, actions }: { section: string; title: ReactNode; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">CTR Tracker / {section}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-sm text-muted">{intro}</p>}
      </div>
      {actions}
    </header>
  );
}

/** What still needs connecting, in plain steps. */
export function SetupNotice({ setup }: { setup: CtrSetup | null }) {
  if (!setup) return null;
  const missing: ReactNode[] = [];
  if (!setup.database) missing.push(<>Database: in Vercel, <b>Storage → Create → Neon</b>; it adds <code>DATABASE_URL</code>. Add it to <code>.env.local</code> too.</>);
  if (!setup.searchConsole)
    missing.push(<>Google (Search Console and GA4): create a service account, put its JSON key in <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>, and add its email as a user of each site.</>);
  if (!setup.serp) missing.push(<>Google position: <code>SERPER_API_KEY</code> (already used by Keyword Rankings).</>);
  if (!missing.length) return null;
  return (
    <Notice tone="warning">
      <div className="font-medium">Not connected yet</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {missing.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
      {setup.serviceAccountEmail && (
        <div className="mt-1 text-xs">
          Service account to add in Search Console and GA4: <code>{setup.serviceAccountEmail}</code>
        </div>
      )}
    </Notice>
  );
}

const HEALTH: Record<Health, { icon: typeof CircleCheck; color: string; text: string }> = {
  good: { icon: CircleCheck, color: "text-status-good", text: "On target" },
  warning: { icon: TriangleAlert, color: "text-status-warning", text: "Near target" },
  bad: { icon: CircleX, color: "text-status-critical", text: "Below target" },
  waiting: { icon: CircleDashed, color: "text-subtle", text: "Waiting for data" },
};

export function HealthBadge({ health }: { health: Health }) {
  const H = HEALTH[health];
  return (
    <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${H.color}`}>
      <H.icon className="size-3.5" aria-hidden /> {H.text}
    </span>
  );
}

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const style = status === "active" ? "text-status-good ring-status-good/40" : status === "paused" ? "text-status-warning ring-status-warning/40" : "text-muted ring-line-strong";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ring-1 ${style}`}>
      {status === "paused" && <Pause className="size-2.5" aria-hidden />}
      {status}
    </span>
  );
}

/** One row per campaign: what it tracks, where it is now, and whether it's on target. */
export function CampaignTable({ items, actions }: { items: CampaignItem[]; actions?: (item: CampaignItem) => ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Keyword · site</th>
            <th className="px-3 py-2.5 text-right font-medium">Position</th>
            <th className="px-3 py-2.5 text-right font-medium">CTR (7 days)</th>
            <th className="px-3 py-2.5 text-right font-medium">Clicks (7 days)</th>
            <th className="px-3 py-2.5 font-medium">Result</th>
            <th className="px-3 py-2.5 font-medium">Progress</th>
            {actions && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => {
            const { campaign: c, summary: s } = item;
            return (
              <tr key={c.id} className="align-top hover:bg-surface-2">
                <td className="max-w-0 px-4 py-2.5">
                  <Link href={`/ctr/campaigns/${c.id}`} className="block truncate font-medium text-ink hover:underline">
                    {c.keyword}
                  </Link>
                  <div className="truncate font-mono text-[11px] text-link">{(c.pageUrl ?? c.siteUrl).replace(/^https?:\/\//, "")}</div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {s.position ?? <span className="text-subtle">–</span>}
                  {c.targetPosition != null && <span className="block text-[10px] text-subtle">goal ≤ {c.targetPosition}</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {s.ctr != null ? `${s.ctr}%` : <span className="text-subtle">–</span>}
                  <span className="block text-[10px] text-subtle">goal {c.targetCtr}%</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {s.clicks7 ?? <span className="text-subtle">–</span>}
                  {s.growthPct != null && (
                    <span className={`block text-[10px] ${s.growthPct >= (c.weeklyGrowthPct ?? 0) ? "text-status-good" : "text-status-warning"}`}>
                      {s.growthPct > 0 ? "+" : ""}
                      {s.growthPct}% vs last week
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <HealthBadge health={s.health} />
                  <div className="mt-1">
                    <StatusBadge status={c.status} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <Progress day={s.dayNumber} total={c.durationDays} />
                </td>
                {actions && <td className="px-3 py-2.5 text-right whitespace-nowrap">{actions(item)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Progress({ day, total }: { day: number; total: number }) {
  const pct = Math.min(100, Math.round((day / total) * 100));
  return (
    <div className="w-28">
      <div className="font-mono text-[11px] text-muted tabular-nums">
        Day {day} / {total}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={day} aria-valuemin={1} aria-valuemax={total} aria-label="Campaign progress">
        <div className="h-full rounded-full bg-series-1" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface ChartPoint {
  day: string;
  value: number | null;
}

/**
 * Small line chart for one daily series, with an optional dashed goal line. `invert` puts lower
 * values on top (Google position: 1 is best). Missing days leave a gap.
 */
export function LineChart({ points, goal, invert = false, unit = "", label }: { points: ChartPoint[]; goal?: number | null; invert?: boolean; unit?: string; label: string }) {
  const W = 600;
  const H = 160;
  const pad = { l: 36, r: 10, t: 10, b: 22 };
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!values.length) return <div className="grid h-40 place-items-center text-xs text-subtle">No data yet</div>;
  let lo = Math.min(...values, goal ?? Infinity);
  let hi = Math.max(...values, goal ?? -Infinity);
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => {
    const t = (v - lo) / (hi - lo);
    return pad.t + (invert ? t : 1 - t) * (H - pad.t - pad.b);
  };
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.value == null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const fmt = (v: number) => `${Math.round(v * 10) / 10}${unit}`;
  const top = invert ? lo : hi;
  const bottom = invert ? hi : lo;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label={label}>
      <line x1={pad.l} x2={W - pad.r} y1={pad.t} y2={pad.t} stroke="var(--color-line)" />
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-line)" />
      <text x={pad.l - 6} y={pad.t + 4} textAnchor="end" className="fill-subtle font-mono text-[10px]">
        {fmt(top)}
      </text>
      <text x={pad.l - 6} y={H - pad.b + 4} textAnchor="end" className="fill-subtle font-mono text-[10px]">
        {fmt(bottom)}
      </text>
      {goal != null && (
        <>
          <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} stroke="var(--color-status-good)" strokeDasharray="5 4" strokeOpacity=".8" />
          <text x={W - pad.r} y={y(goal) - 4} textAnchor="end" className="fill-status-good font-mono text-[10px]">
            goal {fmt(goal)}
          </text>
        </>
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--color-series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {points.map((p, i) =>
        p.value == null ? null : (
          <circle key={p.day} cx={x(i)} cy={y(p.value)} r="2.5" fill="var(--color-series-1)">
            <title>{`${p.day}: ${fmt(p.value)}`}</title>
          </circle>
        ),
      )}
      <text x={pad.l} y={H - 6} className="fill-subtle font-mono text-[10px]">
        {points[0].day}
      </text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-subtle font-mono text-[10px]">
        {points[points.length - 1].day}
      </text>
    </svg>
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}
