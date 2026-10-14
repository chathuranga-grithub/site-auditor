// The Auto CTR dashboard's numbers, from the campaigns and their days (no database access: the page
// gets both from GET /api/ctr/campaigns). Everything is for one date range (Vietnam dates) and,
// optionally, one site: totals, one point per day for the charts, and breakdowns by site, computer
// and campaign. Visit details (failed tries, CAPTCHAs, time on site, pages, position in visits) are
// counted from desktop app 1.0.2; days before that only have the visits done and the daily check.

import { daysBetween } from "./metrics";
import { stripWwwHost } from "./site";
import { plannedVisits, type Campaign, type CampaignDay } from "./types";

export interface OverviewItem {
  campaign: Campaign;
  days: CampaignDay[];
}

/** Sums over some days (a day of every campaign, a campaign over the range, a site…). */
export interface Totals {
  visits: number;
  mobile: number;
  planned: number;
  failed: number;
  captchasMet: number;
  captchasSolved: number;
  /** Seconds on the site and pages read, and the visits they're for (those with details). */
  seconds: number;
  pages: number;
  detailedVisits: number;
  /** Google position seen in the visits, weighted by visits: sum and count. */
  positionSum: number;
  positionCount: number;
  bestPosition: number | null;
  /** The daily ranking check: the latest position (null: not in the top results / not checked). */
  checkPosition: number | null;
  checkDay: string | null;
}

const empty = (): Totals => ({
  visits: 0,
  mobile: 0,
  planned: 0,
  failed: 0,
  captchasMet: 0,
  captchasSolved: 0,
  seconds: 0,
  pages: 0,
  detailedVisits: 0,
  positionSum: 0,
  positionCount: 0,
  bestPosition: null,
  checkPosition: null,
  checkDay: null,
});

/** Visits planned for a campaign on a day: its plan while it runs (a stopped one, up to its last visits). */
export function plannedOn(c: Campaign, day: string, lastDay: string | null): number {
  if (day < c.startDate || day > c.endDate) return 0;
  if (c.status === "stopped" && (!lastDay || day > lastDay)) return 0;
  return plannedVisits(c.day1Visits, c.dailyIncreasePct, daysBetween(c.startDate, day) + 1);
}

function add(t: Totals, d: CampaignDay | undefined, planned: number) {
  t.planned += planned;
  if (!d) return;
  t.visits += d.visitsDone;
  t.mobile += d.mobileVisitsDone;
  t.failed += d.visitTriesFailed;
  t.captchasMet += d.captchasMet;
  t.captchasSolved += d.captchasSolved;
  if (d.visitSeconds > 0) {
    t.seconds += d.visitSeconds;
    t.pages += d.pagesRead;
    t.detailedVisits += d.visitsDone;
  }
  if (d.visitPositionAvg != null && d.visitsDone) {
    t.positionSum += d.visitPositionAvg * d.visitsDone;
    t.positionCount += d.visitsDone;
  }
  if (d.visitPositionBest != null) t.bestPosition = t.bestPosition == null ? d.visitPositionBest : Math.min(t.bestPosition, d.visitPositionBest);
  if (d.position != null && (!t.checkDay || d.day >= t.checkDay)) {
    t.checkPosition = d.position;
    t.checkDay = d.day;
  }
}

/** Derived figures, null when there's nothing to measure. */
export function rates(t: Totals) {
  return {
    planPct: t.planned ? Math.round((t.visits / t.planned) * 100) : null,
    successPct: t.visits + t.failed ? Math.round((t.visits / (t.visits + t.failed)) * 100) : null,
    captchaSolvedPct: t.captchasMet ? Math.round((t.captchasSolved / t.captchasMet) * 100) : null,
    secondsPerVisit: t.detailedVisits ? t.seconds / t.detailedVisits : null,
    pagesPerVisit: t.detailedVisits ? t.pages / t.detailedVisits : null,
    position: t.positionCount ? Math.round((t.positionSum / t.positionCount) * 10) / 10 : null,
    mobilePct: t.visits ? Math.round((t.mobile / t.visits) * 100) : null,
  };
}

/** The days of a range ending today: `n` days, or from the first campaign's start ("all"). */
export function rangeDays(today: string, n: number | "all", items: OverviewItem[]): string[] {
  const first = n === "all" ? items.map((i) => i.campaign.startDate).sort()[0] ?? today : null;
  const count = n === "all" ? Math.max(1, daysBetween(first!, today) + 1) : n;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (count - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The site a campaign is for, as shown and grouped: its host without www. */
export const siteOf = (c: Campaign) => (c.siteUrl ? stripWwwHost(c.siteUrl) || c.siteUrl : NO_SITE);

/** How a search-only campaign without a website shows where a site would (and is grouped on the dashboard). */
export const NO_SITE = "Search only (no website)";

export interface Overview {
  days: string[];
  total: Totals;
  /** The same length of time just before the range, for the change shown on the tiles. */
  previous: Totals;
  perDay: Totals[];
  sites: { site: string; campaigns: OverviewItem[]; total: Totals; perDay: Totals[] }[];
  computers: { name: string; total: Totals }[];
  /** Where the visits came from (their proxy IPs' cities), most first: for the map. */
  places: { label: string; visits: number; lat: number | null; lon: number | null }[];
  campaigns: { item: OverviewItem; total: Totals; perDay: Totals[]; allTime: Totals }[];
}

export function buildOverview(items: OverviewItem[], days: string[]): Overview {
  const before = days.map((d) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - days.length);
    return x.toISOString().slice(0, 10);
  });
  const total = empty();
  const previous = empty();
  const perDay = days.map(() => empty());
  const bySite = new Map<string, Overview["sites"][number]>();
  const byComputer = new Map<string, Totals>();
  const byPlace = new Map<string, Overview["places"][number]>();
  const campaigns: Overview["campaigns"] = [];

  for (const item of items) {
    const c = item.campaign;
    const byDay = new Map(item.days.map((d) => [d.day, d]));
    const lastDay = item.days.filter((d) => d.visitsDone > 0).map((d) => d.day).sort().at(-1) ?? null;
    const site = siteOf(c);
    const s = bySite.get(site) ?? { site, campaigns: [], total: empty(), perDay: days.map(() => empty()) };
    s.campaigns.push(item);
    bySite.set(site, s);
    const mine = { item, total: empty(), perDay: days.map(() => empty()), allTime: empty() };
    days.forEach((day, i) => {
      const d = byDay.get(day);
      const planned = plannedOn(c, day, lastDay);
      for (const t of [total, perDay[i], s.total, s.perDay[i], mine.total, mine.perDay[i]]) add(t, d, planned);
      const pc = d?.lastComputer ?? c.computerName;
      if (d?.visitsDone && pc) {
        const t = byComputer.get(pc) ?? empty();
        add(t, d, 0);
        byComputer.set(pc, t);
      }
      for (const [label, at] of Object.entries(d?.places ?? {})) {
        const p = byPlace.get(label) ?? { label, visits: 0, lat: at.lat, lon: at.lon };
        p.visits += at.n;
        byPlace.set(label, p);
      }
    });
    before.forEach((day) => add(previous, byDay.get(day), plannedOn(c, day, lastDay)));
    // Its whole run so far, whatever the range: every day from its start to its end (or today).
    const until = [c.endDate, days.at(-1) ?? c.endDate].sort()[0];
    for (let day = c.startDate; day <= until; day = nextDay(day)) add(mine.allTime, byDay.get(day), plannedOn(c, day, lastDay));
    campaigns.push(mine);
  }
  return {
    days,
    total,
    previous,
    perDay,
    sites: [...bySite.values()].sort((a, b) => b.total.visits - a.total.visits || a.site.localeCompare(b.site)),
    computers: [...byComputer].map(([name, t]) => ({ name, total: t })).sort((a, b) => b.total.visits - a.total.visits),
    places: [...byPlace.values()].sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label)),
    campaigns,
  };
}
