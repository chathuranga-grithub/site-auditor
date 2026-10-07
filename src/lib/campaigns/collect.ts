// Server-only: the daily check for one campaign. Reads REAL numbers only:
// - Google position for the keyword in Vietnam today (Serper, 1–2 search credits);
// - Search Console clicks / impressions / CTR / device split, and GA4 time on page, for
//   GSC_DELAY_DAYS ago (Google's data takes a few days to settle).

import { configuredProviders, searchGoogle } from "../serp";
import { stripWwwHost } from "./site";
import { setCampaignStatus, upsertDay } from "./db";
import { engagementSeconds, searchConsoleDay, serviceAccountEmail } from "./google";
import type { Campaign, CtrSetup } from "./types";

/** Search Console and GA4 numbers are read for this many days ago. */
export const GSC_DELAY_DAYS = 3;

export function daysAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface CollectResult {
  campaignId: number;
  position: number | null;
  /** The day Search Console / GA4 numbers were saved for. */
  dataDay: string;
  problems: string[];
}

export async function collectCampaign(c: Campaign, today: string): Promise<CollectResult> {
  const problems: string[] = [];
  const dataDay = daysAgo(today, GSC_DELAY_DAYS);
  let position: number | null = null;

  // 1. Google position today
  if (!configuredProviders().length) {
    problems.push("Google position: search isn't set up (SERPER_API_KEY).");
    await upsertDay(c.id, today, { notes: { serp: "Search isn't set up (SERPER_API_KEY)." } });
  } else {
    try {
      const serp = await searchGoogle(c.keyword, c.country, 10);
      const host = stripWwwHost(c.siteUrl);
      const hit = serp.results.find((r) => (c.pageUrl ? sameUrl(r.url, c.pageUrl) : stripWwwHost(r.url) === host));
      position = hit?.position ?? null;
      await upsertDay(c.id, today, { position, rankingUrl: hit?.url ?? null, notes: { serp: hit ? "" : "Not in the top 10 today." } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      problems.push(`Google position: ${msg}`);
      await upsertDay(c.id, today, { notes: { serp: msg } });
    }
  }

  // 2. Search Console
  if (c.gscProperty) {
    try {
      const g = await searchConsoleDay(c.gscProperty, dataDay, c.keyword, c.pageUrl);
      await upsertDay(c.id, dataDay, { ...g, gscPosition: g.position, notes: { gsc: g.impressions ? "" : "No impressions that day." } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      problems.push(`Search Console: ${msg}`);
      await upsertDay(c.id, dataDay, { notes: { gsc: msg } });
    }
  }

  // 3. GA4 time on page (needs the page URL)
  if (c.ga4Property && c.pageUrl) {
    try {
      const sec = await engagementSeconds(c.ga4Property, dataDay, new URL(c.pageUrl).pathname);
      await upsertDay(c.id, dataDay, { engagementSec: sec, notes: { ga4: sec == null ? "No visitors that day." : "" } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      problems.push(`Google Analytics: ${msg}`);
      await upsertDay(c.id, dataDay, { notes: { ga4: msg } });
    }
  }

  if (today >= c.endDate && c.status === "active") await setCampaignStatus(c.id, "finished");
  return { campaignId: c.id, position, dataDay, problems };
}

export function ctrSetup(): CtrSetup {
  const email = serviceAccountEmail();
  return {
    database: !!process.env.DATABASE_URL,
    searchConsole: !!email,
    analytics: !!email,
    serp: configuredProviders().length > 0,
    serviceAccountEmail: email,
  };
}

function sameUrl(a: string, b: string) {
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}
