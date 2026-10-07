"use client";

// Auto CTR: pieces shared by the dashboard, campaign list, form and campaign page.

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { CircleCheck, CircleDashed, CircleX, Pause, Square, Trash2, TriangleAlert } from "lucide-react";
import type { CampaignSummary, Health } from "@/lib/campaigns/metrics";
import { visitPlanProgress, type Campaign, type CampaignStatus, type CtrSetup } from "@/lib/campaigns/types";
import { Notice } from "@/components/ui/primitives";

export interface CampaignItem {
  campaign: Campaign;
  summary: CampaignSummary;
}

export function PageHeader({ section, title, intro, actions }: { section: string; title: ReactNode; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Auto CTR / {section}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-sm text-muted">{intro}</p>}
      </div>
      {actions}
    </header>
  );
}

/** Search Console and GA4: not used by campaigns for now, so not asked for. Set true to bring them back. */
const GOOGLE_CONNECTOR = false;

/** What still needs connecting, in plain steps. */
export function SetupNotice({ setup }: { setup: CtrSetup | null }) {
  if (!setup) return null;
  const missing: ReactNode[] = [];
  if (!setup.database) missing.push(<>Database: in Vercel, <b>Storage → Create → Neon</b>; it adds <code>DATABASE_URL</code>. Add it to <code>.env.local</code> too.</>);
  if (GOOGLE_CONNECTOR && !setup.searchConsole)
    missing.push(<>Google (Search Console and GA4): create a service account, put its JSON key in <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>, and add its email as a user of each site.</>);
  if (!setup.serp) missing.push(<>Google position: read in a browser through the Vietnam proxy, so it&apos;s only checked when the app runs on a computer.</>);
  if (!missing.length) return null;
  return (
    <Notice tone="warning">
      <div className="font-medium">Not connected yet</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {missing.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
      {GOOGLE_CONNECTOR && setup.serviceAccountEmail && (
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
  const style =
    status === "active"
      ? "text-status-good ring-status-good/40"
      : status === "paused"
        ? "text-status-warning ring-status-warning/40"
        : status === "stopped"
          ? "text-status-critical ring-status-critical/40"
          : "text-muted ring-line-strong";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ring-1 ${style}`}>
      {status === "paused" && <Pause className="size-2.5" aria-hidden />}
      {status === "stopped" && <Square className="size-2.5" aria-hidden />}
      {status}
    </span>
  );
}

/** What the popup says before stopping or deleting a campaign. */
export const CONFIRM = {
  stop: {
    title: "Stop this campaign?",
    text: "Tracking ends now and its data is kept.",
    warning: "It can't be started again.",
    confirmLabel: "Stop",
  },
  delete: {
    title: "Delete this campaign?",
    text: "The campaign and all its data are removed.",
    warning: "This can't be undone.",
    confirmLabel: "Delete",
  },
} as const;

/** Pause, Resume, Stop, Check now and Run visit only apply to these. */
export function isOpen(status: CampaignStatus) {
  return status === "active" || status === "paused";
}

/**
 * Confirm before stopping or deleting a campaign. Escape or a click outside counts as Cancel.
 */
export function CampaignConfirm({ kind, campaign: c, onConfirm, onCancel }: { kind: keyof typeof CONFIRM; campaign: Campaign; onConfirm: () => void; onCancel: () => void }) {
  const t = CONFIRM[kind];
  const Icon = kind === "stop" ? Square : Trash2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 motion-safe:animate-fade-in"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-text"
    >
      <div className="w-full max-w-sm rounded-2xl border border-line-strong bg-surface-solid p-5 shadow-2xl motion-safe:animate-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-status-critical/15 text-status-critical">
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="font-semibold text-ink">
              {t.title}
            </h2>
            <p className="mt-0.5 truncate font-mono text-xs text-link">{c.keyword}</p>
            <p id="confirm-text" className="mt-2 text-sm text-muted">
              {t.text} {t.warning}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} autoFocus className="h-10 rounded-lg border border-line-strong bg-surface text-sm font-medium text-ink transition hover:bg-surface-2">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-10 rounded-lg bg-status-critical text-sm font-semibold text-white transition hover:brightness-110">
            {t.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One row per campaign: what it tracks, where it is now, and whether it's on target. */
export function CampaignTable({ items, actions }: { items: CampaignItem[]; actions?: (item: CampaignItem) => ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Keyword · site</th>
            <th className="px-3 py-2.5 text-right font-medium">Position</th>
            <th className="px-3 py-2.5 text-right font-medium">CTR (7 days)</th>
            <th className="px-3 py-2.5 text-right font-medium">Clicks (7 days)</th>
            <th className="px-3 py-2.5 text-right font-medium" title="Visit runs done so far, out of the plan's total; today's runs done out of today's plan, and the balance">
              Visits
            </th>
            <th className="px-3 py-2.5 font-medium">Result</th>
            <th className="px-3 py-2.5 font-medium">Progress</th>
            {actions && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => {
            const { campaign: c, summary: s } = item;
            const plan = visitPlanProgress(c, s.dayNumber);
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
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {s.visitsDone.toLocaleString()}
                  <span className="text-subtle"> / {plan.total.toLocaleString()}</span>
                  <span className="block text-[10px] text-subtle">
                    {isOpen(c.status)
                      ? `today ${s.visitsDoneToday} / ${plan.today.toLocaleString()} · ${Math.max(0, plan.total - s.visitsDone).toLocaleString()} left`
                      : c.status === "stopped"
                        ? "ended early"
                        : "finished"}
                  </span>
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

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}
