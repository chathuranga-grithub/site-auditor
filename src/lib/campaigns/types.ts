// Auto CTR: campaigns that follow one keyword for one site over a period, measuring REAL results
// (Google position, Search Console clicks / impressions / CTR / device split, GA4 time on page)
// against goals. Nothing is generated; every number comes from real visitors.

export const MAX_DURATION_DAYS = 365;
/** Used while the form's Tracking and Goals sections are switched off (they're not sent). */
export const DEFAULT_DURATION_DAYS = 30;
export const DEFAULT_TARGET_CTR = 5;

export type CampaignStatus = "active" | "finished" | "paused";

export interface Campaign {
  id: number;
  siteUrl: string;
  keyword: string;
  /** The page expected to rank for the keyword; empty = any page of the site. */
  pageUrl: string | null;
  country: string;
  durationDays: number;
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
  /** What couldn't be read that day, per source, in plain words. */
  notes: DayNotes;
}

export type DaySource = "serp" | "gsc" | "ga4";
export type DayNotes = Partial<Record<DaySource, string>>;

/** The columns of a day that one source fills in. */
export type DayFields = Partial<Omit<CampaignDay, "campaignId" | "day">>;

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
