// Auto CTR: summaries of a campaign's real daily numbers (pure, used by every page).

import { expectedCtr, type Campaign, type CampaignDay } from "./types";

export type Health = "good" | "warning" | "bad" | "waiting";

export interface CampaignSummary {
  /** Latest Google position (top 10 check), and its day. */
  position: number | null;
  positionDay: string | null;
  /** CTR % over the last 7 days that have Search Console data. */
  ctr: number | null;
  /** Typical CTR for the current position. */
  expected: number | null;
  clicks7: number | null;
  impressions7: number | null;
  /** Clicks in the 7 days before that, for growth. */
  clicksPrev7: number | null;
  /** Week-over-week click growth %. */
  growthPct: number | null;
  /** % of the last 7 days' clicks from phones / tablets. */
  mobileShare: number | null;
  /** Average GA4 time on page over the last 7 days with data, seconds. */
  engagementSec: number | null;
  /** Site visit runs finished: in all, and today. */
  visitsDone: number;
  visitsDoneToday: number;
  /** Day N of the campaign, and days left. */
  dayNumber: number;
  daysLeft: number;
  /** Overall: CTR vs target (and position vs target, when set). */
  health: Health;
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((n, x) => n + (x ?? 0), 0);

export function summarize(c: Campaign, days: CampaignDay[], today: string): CampaignSummary {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const ranked = sorted.filter((d) => d.position != null || d.notes.serp !== undefined);
  const lastRank = ranked[ranked.length - 1] ?? null;

  const gsc = sorted.filter((d) => d.impressions != null);
  const last7 = gsc.slice(-7);
  const prev7 = gsc.slice(-14, -7);
  const impressions7 = last7.length ? sum(last7.map((d) => d.impressions)) : null;
  const clicks7 = last7.length ? sum(last7.map((d) => d.clicks)) : null;
  const clicksPrev7 = prev7.length === 7 ? sum(prev7.map((d) => d.clicks)) : null;
  const mobile7 = sum(last7.map((d) => d.mobileClicks));
  const engaged = sorted.filter((d) => d.engagementSec != null).slice(-7);

  const ctr = impressions7 ? Math.round(((clicks7 ?? 0) / impressions7) * 1000) / 10 : null;
  const position = lastRank?.position ?? null;
  const dayNumber = Math.max(1, daysBetween(c.startDate, today) + 1);

  let health: Health = "waiting";
  if (ctr != null) {
    const ctrOk = ctr >= c.targetCtr;
    const posOk = c.targetPosition == null || (position != null && position <= c.targetPosition);
    health = ctrOk && posOk ? "good" : ctr >= c.targetCtr * 0.6 ? "warning" : "bad";
  }

  return {
    position,
    positionDay: lastRank?.day ?? null,
    ctr,
    expected: expectedCtr(position ?? (last7.length ? average(last7.map((d) => d.gscPosition)) : null)),
    clicks7,
    impressions7,
    clicksPrev7,
    growthPct: clicksPrev7 ? Math.round((((clicks7 ?? 0) - clicksPrev7) / clicksPrev7) * 1000) / 10 : null,
    mobileShare: clicks7 ? Math.round((mobile7 / clicks7) * 100) : null,
    engagementSec: engaged.length ? Math.round(average(engaged.map((d) => d.engagementSec))! * 10) / 10 : null,
    visitsDone: sum(sorted.map((d) => d.visitsDone)),
    visitsDoneToday: sorted.find((d) => d.day === today)?.visitsDone ?? 0,
    dayNumber: Math.min(dayNumber, c.durationDays),
    daysLeft: Math.max(0, daysBetween(today, c.endDate)),
    health,
  };
}

function average(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
