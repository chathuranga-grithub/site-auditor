// Server-only helpers for the Auto CTR API routes: input checks and error responses.

import { isBlockedHost, parseSiteUrl } from "../url";
import { NotConfiguredError } from "./db";
import {
  DEFAULT_DAILY_INCREASE_PCT,
  DEFAULT_DAY1_VISITS,
  DEFAULT_DURATION_DAYS,
  DEFAULT_TARGET_CTR,
  MAX_DAILY_INCREASE_PCT,
  MAX_DAY1_VISITS,
  MAX_DURATION_DAYS,
  type NewCampaign,
} from "./types";

export function errorResponse(err: unknown) {
  if (err instanceof NotConfiguredError) return Response.json({ error: err.message, notConfigured: true }, { status: 503 });
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** Checks the form input; returns the campaign or an error message. */
export function parseNewCampaign(body: Record<string, unknown>): NewCampaign | string {
  const site = typeof body.siteUrl === "string" ? parseSiteUrl(body.siteUrl) : null;
  if (!site || !site.hostname.includes(".") || isBlockedHost(site.hostname)) return "Enter the website URL, e.g. https://example.vn";
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword || keyword.length > 200) return "Enter the keyword to track.";

  let pageUrl: string | null = null;
  if (typeof body.pageUrl === "string" && body.pageUrl.trim()) {
    const page = parseSiteUrl(body.pageUrl);
    if (!page || page.hostname.replace(/^www\./, "") !== site.hostname.replace(/^www\./, "")) return "The page URL must be on the same website.";
    pageUrl = page.toString();
  }

  const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  const optional = (v: unknown) => (v === null || v === undefined || v === "" ? null : int(v));

  // Tracking and Goals are optional for now (the form doesn't send them): defaults, or none.
  const durationDays = optional(body.durationDays) ?? DEFAULT_DURATION_DAYS;
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) return `Duration must be 1 to ${MAX_DURATION_DAYS} days.`;
  const day1Visits = optional(body.day1Visits) ?? DEFAULT_DAY1_VISITS;
  if (!Number.isInteger(day1Visits) || day1Visits < 1 || day1Visits > MAX_DAY1_VISITS) return `Day 1 visits must be 1 to ${MAX_DAY1_VISITS}.`;
  const dailyIncreasePct = optional(body.dailyIncreasePct) ?? DEFAULT_DAILY_INCREASE_PCT;
  if (!(dailyIncreasePct >= 0 && dailyIncreasePct <= MAX_DAILY_INCREASE_PCT)) return `Daily increase must be 0 to ${MAX_DAILY_INCREASE_PCT}%.`;
  const targetCtr = optional(body.targetCtr) ?? DEFAULT_TARGET_CTR;
  if (!(targetCtr > 0 && targetCtr <= 100)) return "Target CTR must be between 0 and 100%.";
  const targetPosition = optional(body.targetPosition);
  if (targetPosition !== null && !(Number.isInteger(targetPosition) && targetPosition >= 1 && targetPosition <= 100)) return "Target position must be 1 to 100.";
  const weeklyGrowthPct = optional(body.weeklyGrowthPct);
  if (weeklyGrowthPct !== null && !(weeklyGrowthPct >= 0 && weeklyGrowthPct <= 1000)) return "Weekly click growth must be 0 to 1000%.";
  const targetEngagementSec = optional(body.targetEngagementSec);
  if (targetEngagementSec !== null && !(Number.isInteger(targetEngagementSec) && targetEngagementSec >= 1 && targetEngagementSec <= 3600)) return "Target time on page must be 1 to 3600 seconds.";

  const gscProperty = typeof body.gscProperty === "string" && body.gscProperty.trim() ? body.gscProperty.trim() : null;
  const ga4Property = typeof body.ga4Property === "string" && body.ga4Property.trim() ? body.ga4Property.trim() : null;
  if (ga4Property && !/^\d+$/.test(ga4Property)) return "GA4 property ID is numbers only (Admin → Property details).";

  return {
    siteUrl: site.origin,
    keyword,
    pageUrl,
    durationDays,
    day1Visits,
    dailyIncreasePct,
    targetCtr,
    targetPosition,
    weeklyGrowthPct,
    targetEngagementSec,
    gscProperty,
    ga4Property,
  };
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
