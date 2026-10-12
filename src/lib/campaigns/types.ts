// Auto CTR: campaigns that follow one keyword for one site over a period, measuring REAL results
// (Google position, Search Console clicks / impressions / CTR / device split, GA4 time on page)
// against goals. Nothing is generated; every number comes from real visitors.

export const MAX_DURATION_DAYS = 365;
/** Used while the form's Tracking and Goals sections are switched off (they're not sent). */
export const DEFAULT_DURATION_DAYS = 30;
export const DEFAULT_TARGET_CTR = 5;

/** Visit plan: visits on day 1, then compounded by a daily increase. */
export const DEFAULT_DAY1_VISITS = 10;
export const MAX_DAY1_VISITS = 1000;
export const DEFAULT_DAILY_INCREASE_PCT = 5;
export const MAX_DAILY_INCREASE_PCT = 100;
/** Visits run at the same time, each through its own proxy API link: at most the links saved in Settings. */
export const DEFAULT_CONCURRENCY = 1;
/** Dwell time: how long each visit stays on the site, a random number of seconds between the min and the max. */
export const DEFAULT_MIN_DWELL_SEC = 30;
export const DEFAULT_MAX_DWELL_SEC = 180;
export const MAX_DWELL_SEC = 3600;
/** Mobile traffic: the % of each day's visits made on a phone; the rest are on a desktop. */
export const DEFAULT_MOBILE_PCT = 70;

/** Of `visits`, how many are on a phone at `mobilePct`% (the rest are on a desktop). */
export function mobileVisits(visits: number, mobilePct: number): number {
  return Math.round((visits * mobilePct) / 100);
}

/** Visits planned for day `n` (1-based): day 1 visits, compounded by the daily increase. */
export function plannedVisits(day1Visits: number, dailyIncreasePct: number, n: number): number {
  return Math.round(day1Visits * (1 + dailyIncreasePct / 100) ** (n - 1));
}

/** Visits planned over the whole campaign. */
export function plannedVisitsTotal(day1Visits: number, dailyIncreasePct: number, durationDays: number): number {
  let total = 0;
  for (let n = 1; n <= durationDays; n++) total += plannedVisits(day1Visits, dailyIncreasePct, n);
  return total;
}

/** A campaign's visit plan on day `day`: planned up to and including today, today's, what's left, the total. */
export function visitPlanProgress(c: Pick<Campaign, "day1Visits" | "dailyIncreasePct" | "durationDays">, day: number) {
  const soFar = plannedVisitsTotal(c.day1Visits, c.dailyIncreasePct, day);
  const total = plannedVisitsTotal(c.day1Visits, c.dailyIncreasePct, c.durationDays);
  return { soFar, today: plannedVisits(c.day1Visits, c.dailyIncreasePct, day), balance: total - soFar, total };
}

/** finished: reached its end date. stopped: ended early by hand. Neither can be started again. */
export type CampaignStatus = "active" | "paused" | "finished" | "stopped";

export interface Campaign {
  id: number;
  siteUrl: string;
  keyword: string;
  /** The page expected to rank for the keyword; empty = any page of the site. */
  pageUrl: string | null;
  country: string;
  durationDays: number;
  /** Visit plan: visits on day 1, and the % they grow by each day (compounded). */
  day1Visits: number;
  dailyIncreasePct: number;
  /** Visits run at the same time (each through its own proxy API link). */
  concurrency: number;
  /** Dwell time: each visit stays on the site a random number of seconds from min to max. */
  minDwellSec: number;
  maxDwellSec: number;
  /** % of the visits made on a phone (0–100); the rest are on a desktop. */
  mobilePct: number;
  /** The computer that runs its visits and ranking checks (others only show it); null = none yet. */
  computerId: string | null;
  computerName: string | null;
  /** A page watches its live console from another computer until then (ISO); see src/lib/live-relay.ts. */
  liveUntil: string | null;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  /** Goals */
  targetCtr: number;
  targetPosition: number | null;
  /** Goal: grow real clicks by this % per week. */
  weeklyGrowthPct: number | null;
  /** Goal: average engagement (time on page) in seconds, from GA4. */
  targetEngagementSec: number | null;
  /** Search Console property, e.g. "sc-domain:example.com" or "https://example.com/". */
  gscProperty: string | null;
  /** GA4 property id (numbers only), for time on page. */
  ga4Property: string | null;
  status: CampaignStatus;
  createdAt: string;
}

/** The last day of a campaign that starts on `startDate` and runs `durationDays` (YYYY-MM-DD). */
export function endDateOf(startDate: string, durationDays: number): string {
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + durationDays - 1);
  return end.toISOString().slice(0, 10);
}

/** The settings an edit can change (the start date stays: each day's numbers hang on it). */
export const EDITABLE_FIELDS = [
  "siteUrl",
  "keyword",
  "pageUrl",
  "durationDays",
  "day1Visits",
  "dailyIncreasePct",
  "concurrency",
  "minDwellSec",
  "maxDwellSec",
  "mobilePct",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** How each tracked field is named in the change history. */
export const FIELD_LABELS: Record<string, string> = {
  siteUrl: "Website",
  keyword: "Keyword",
  pageUrl: "Page",
  durationDays: "Duration (days)",
  endDate: "End date",
  day1Visits: "Day 1 visits",
  dailyIncreasePct: "Daily increase %",
  concurrency: "Concurrency",
  minDwellSec: "Min dwell time (s)",
  maxDwellSec: "Max dwell time (s)",
  mobilePct: "Mobile traffic %",
  status: "Status",
  computer: "Computer",
};

/** One field's change: what it was, what it is now (null: none). */
export interface FieldChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

/**
 * One entry of a campaign's change history: created, edited, its status changed (by hand, or finished
 * by the daily check), or moved to another computer. `by`: who (null: the app itself).
 */
export interface CampaignChange {
  id: number;
  campaignId: number;
  at: string;
  by: string | null;
  kind: "created" | "edited" | "status" | "moved";
  changes: FieldChange[];
}

/**
 * A computer with the app that can run campaigns: each one says it's on every minute
 * (src/lib/campaigns/scheduler.ts), so campaigns can be started on it from any other computer.
 */
export interface KnownComputer {
  id: string;
  name: string;
  /** The Windows computer name; null for one that ran campaigns before computers said they're on. */
  hostname: string | null;
  appVersion: string | null;
  /** When it last said it's on (ISO); null: never (see hostname). */
  lastSeen: string | null;
  /** Said it's on in the last few minutes: the app runs there now. */
  online: boolean;
  /** Its campaigns that are active or paused. */
  campaigns: number;
}

/** One day of real numbers for a campaign. */
export interface CampaignDay {
  campaignId: number;
  /** YYYY-MM-DD: the day the numbers are for. */
  day: string;
  /** Google position for the keyword (from the SERP check); null = not in the top results. */
  position: number | null;
  rankingUrl: string | null;
  /** Search Console (for that day). */
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  gscPosition: number | null;
  mobileClicks: number | null;
  desktopClicks: number | null;
  mobileImpressions: number | null;
  desktopImpressions: number | null;
  /** GA4 average engagement time on the page, seconds. */
  engagementSec: number | null;
  /** Site visit runs that finished that day (Vietnam date). */
  visitsDone: number;
  /** Of those, the ones made on a phone. */
  mobileVisitsDone: number;
  /** Visit tries that didn't count (a CAPTCHA not solved, the site not found, a proxy failing…). */
  visitTriesFailed: number;
  /** Google CAPTCHAs the visits met, and how many were solved. */
  captchasMet: number;
  captchasSolved: number;
  /** Seconds on the site and pages read, over the visits that counted. */
  visitSeconds: number;
  pagesRead: number;
  /** The site's Google position in the visits' own searches: average and best (null: none seen). */
  visitPositionAvg: number | null;
  visitPositionBest: number | null;
  /** The day's last visit that counted (ISO time), and the computer that made it. */
  lastVisitAt: string | null;
  lastComputer: string | null;
  /** What couldn't be read that day, per source, in plain words. */
  notes: DayNotes;
}

export type DaySource = "serp" | "gsc" | "ga4";
export type DayNotes = Partial<Record<DaySource, string>>;

/** The columns of a day that one source fills in. */
/** (Visit runs are counted on their own, recordVisits.) */
export type DayFields = Partial<
  Omit<
    CampaignDay,
    | "campaignId"
    | "day"
    | "visitsDone"
    | "mobileVisitsDone"
    | "visitTriesFailed"
    | "captchasMet"
    | "captchasSolved"
    | "visitSeconds"
    | "pagesRead"
    | "visitPositionAvg"
    | "visitPositionBest"
    | "lastVisitAt"
    | "lastComputer"
  >
>;

export interface CampaignNote {
  id: number;
  campaignId: number;
  day: string;
  text: string;
  createdAt: string;
}

/** Input for a new campaign (from the form). */
export interface NewCampaign {
  siteUrl: string;
  keyword: string;
  pageUrl?: string | null;
  durationDays: number;
  day1Visits: number;
  dailyIncreasePct: number;
  concurrency: number;
  minDwellSec: number;
  maxDwellSec: number;
  mobilePct: number;
  targetCtr: number;
  targetPosition?: number | null;
  weeklyGrowthPct?: number | null;
  targetEngagementSec?: number | null;
  gscProperty?: string | null;
  ga4Property?: string | null;
}

/** What's connected, so the pages can say what's missing. */
export interface CtrSetup {
  database: boolean;
  searchConsole: boolean;
  analytics: boolean;
  serp: boolean;
  /** Proxy API links saved in Settings: the most visits a campaign can run at the same time. */
  proxyApis: number;
  /** The service account email to add in Search Console / GA4, when one is configured. */
  serviceAccountEmail: string | null;
}

/**
 * Typical Google CTR by position (organic, desktop + mobile), used to say whether a page gets the
 * clicks its position should give. Rough industry averages; real CTR also depends on the query
 * and what else is on the results page.
 */
const EXPECTED_CTR = [0, 28, 15, 11, 8, 7, 5, 4, 3, 2.5, 2];

export function expectedCtr(position: number | null): number | null {
  if (position == null || position < 1) return null;
  const p = Math.round(position);
  return p <= 10 ? EXPECTED_CTR[p] : p <= 20 ? 1 : 0.5;
}
