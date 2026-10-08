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
  /** What couldn't be read that day, per source, in plain words. */
  notes: DayNotes;
}

export type DaySource = "serp" | "gsc" | "ga4";
export type DayNotes = Partial<Record<DaySource, string>>;

/** The columns of a day that one source fills in. */
/** (Visit runs are counted on their own, addVisitDone.) */
export type DayFields = Partial<Omit<CampaignDay, "campaignId" | "day" | "visitsDone">>;

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
