// Server-only helpers for the Auto CTR API routes: input checks and error responses.

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "../auth/session";
import { thisComputer } from "../this-computer";
import { isBlockedHost, parseSiteUrl } from "../url";
import { NotConfiguredError, getComputer } from "./db";
import { daysBetween } from "./metrics";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_DAILY_INCREASE_PCT,
  DEFAULT_DAY1_VISITS,
  DEFAULT_DURATION_DAYS,
  DEFAULT_MAX_DWELL_SEC,
  DEFAULT_MIN_DWELL_SEC,
  DEFAULT_MOBILE_PCT,
  DEFAULT_TARGET_CTR,
  MAX_DAILY_INCREASE_PCT,
  MAX_DAY1_VISITS,
  MAX_DURATION_DAYS,
  MAX_DWELL_SEC,
  EDITABLE_FIELDS,
  endDateOf,
  type Campaign,
  type FieldChange,
  type NewCampaign,
} from "./types";

export function errorResponse(err: unknown) {
  if (err instanceof NotConfiguredError) return Response.json({ error: err.message, notConfigured: true }, { status: 503 });
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * The computer picked to run a campaign (`computerId`): this one or any other the app is on. Not sent:
 * this computer (on the website: none yet, the first computer that starts takes it). An error message
 * if there's no such computer.
 */
export async function pickComputer(computerId: unknown): Promise<{ id: string; name: string } | null | string> {
  // This computer (also from a copy of the app that doesn't run its campaigns: the one that does takes it).
  const me = await thisComputer();
  if (computerId == null || computerId === "") return me;
  if (typeof computerId !== "string") return "Pick the computer to run the campaign on.";
  if (computerId === me?.id) return me;
  const pc = await getComputer(computerId);
  return pc ? { id: pc.id, name: pc.name } : "That computer isn't known (yet): open the app on it once, then pick it again.";
}

/** Checks the form input; returns the campaign or an error message. `proxyApis`: links saved in Settings. */
export function parseNewCampaign(body: Record<string, unknown>, proxyApis: number): NewCampaign | string {
  // Search only: the website is optional (given, where it ranks is noted; it's never clicked).
  const mode = body.mode === "search" ? "search" : "visit";
  const siteText = typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";
  const site = siteText ? parseSiteUrl(siteText) : null;
  if (siteText || mode === "visit") {
    if (!site || !site.hostname.includes(".") || isBlockedHost(site.hostname)) return "Enter the website URL, e.g. https://example.vn";
  }
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword || keyword.length > 200) return "Enter the keyword to track.";

  let pageUrl: string | null = null;
  if (site && typeof body.pageUrl === "string" && body.pageUrl.trim()) {
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
  if (!Number.isInteger(day1Visits) || day1Visits < 1 || day1Visits > MAX_DAY1_VISITS) return `Day 1 visits must be 1 to ${MAX_DAY1_VISITS.toLocaleString("en-US")}.`;
  const dailyIncreasePct = optional(body.dailyIncreasePct) ?? DEFAULT_DAILY_INCREASE_PCT;
  if (!(dailyIncreasePct >= 0 && dailyIncreasePct <= MAX_DAILY_INCREASE_PCT)) return `Daily increase must be 0 to ${MAX_DAILY_INCREASE_PCT}%.`;
  // Each visit at the same time needs its own proxy API link. With none saved yet, 1 is still allowed.
  const maxConcurrency = Math.max(1, proxyApis);
  const concurrency = optional(body.concurrency) ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > maxConcurrency) {
    return maxConcurrency === 1
      ? "Concurrency can only be 1: add more proxy API links in Settings to run visits at the same time."
      : `Concurrency must be 1 to ${maxConcurrency} (the proxy API links saved in Settings).`;
  }
  const minDwellSec = optional(body.minDwellSec) ?? DEFAULT_MIN_DWELL_SEC;
  if (!Number.isInteger(minDwellSec) || minDwellSec < 1 || minDwellSec > MAX_DWELL_SEC) return `Min dwell time must be 1 to ${MAX_DWELL_SEC} seconds.`;
  const maxDwellSec = optional(body.maxDwellSec) ?? Math.max(minDwellSec, DEFAULT_MAX_DWELL_SEC);
  if (!Number.isInteger(maxDwellSec) || maxDwellSec < 1 || maxDwellSec > MAX_DWELL_SEC) return `Max dwell time must be 1 to ${MAX_DWELL_SEC} seconds.`;
  if (maxDwellSec < minDwellSec) return "Max dwell time must be at least the min dwell time.";
  const mobilePct = optional(body.mobilePct) ?? DEFAULT_MOBILE_PCT;
  if (!Number.isInteger(mobilePct) || mobilePct < 0 || mobilePct > 100) return "Mobile traffic must be 0 to 100%.";
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
    mode,
    siteUrl: site?.origin ?? "",
    keyword,
    pageUrl,
    durationDays,
    day1Visits,
    dailyIncreasePct,
    concurrency,
    minDwellSec,
    maxDwellSec,
    mobilePct,
    targetCtr,
    targetPosition,
    weeklyGrowthPct,
    targetEngagementSec,
    gscProperty,
    ga4Property,
  };
}

/**
 * Checks an edit (the form's fields, any of them) against the campaign as it is: the same rules as a new
 * campaign. Returns what changes (field, from, to), or an error message. The end date follows the
 * duration, and can't be before today; a finished campaign given days again is active again.
 */
export function parseCampaignEdit(c: Campaign, body: Record<string, unknown>, proxyApis: number, today: string): FieldChange[] | string {
  if (c.status === "stopped") return "This campaign has been stopped for good, so it can't be changed.";
  const merged: Record<string, unknown> = { ...c, ...Object.fromEntries(EDITABLE_FIELDS.filter((f) => f in body).map((f) => [f, body[f]])) };
  // Concurrency it already has stays allowed, even if proxy links were removed since.
  const input = parseNewCampaign(merged, Math.max(proxyApis, c.concurrency));
  if (typeof input === "string") return input;

  const changes: FieldChange[] = [];
  for (const field of EDITABLE_FIELDS) {
    const from = c[field] ?? null;
    const to = input[field] ?? null;
    if (from !== to && !(typeof from === "number" && Number(to) === from)) changes.push({ field, from, to });
  }
  if (input.durationDays !== c.durationDays) {
    const endDate = endDateOf(c.startDate, input.durationDays);
    if (endDate < today) return `It can't end before today: day ${daysBetween(c.startDate, today) + 1} of the campaign is today, so at least ${daysBetween(c.startDate, today) + 1} days.`;
    changes.push({ field: "endDate", from: c.endDate, to: endDate });
    if (c.status === "finished") changes.push({ field: "status", from: "finished", to: "active" });
  }
  return changes;
}

/** Who is signed in (for the change history); null if no one. */
export async function signedInAs(): Promise<string | null> {
  return (await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value))?.username ?? null;
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
