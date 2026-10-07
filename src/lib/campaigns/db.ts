// Server-only: Auto CTR storage in Postgres (Neon, via DATABASE_URL). Tables are created on
// first use. All queries go through `query()`, so tests can swap in an in-memory Postgres.

import { neon } from "@neondatabase/serverless";
import type { Campaign, CampaignDay, CampaignNote, CampaignStatus, DayFields, DayNotes, NewCampaign } from "./types";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "NotConfiguredError";
  }
}

let testQuery: Query | null = null;
/** Tests only: run queries against another database. */
export function useQueryForTests(q: Query | null) {
  testQuery = q;
  schemaReady = null;
}

function query(): Query {
  if (testQuery) return testQuery;
  const url = process.env.DATABASE_URL;
  if (!url) throw new NotConfiguredError("The database isn't connected yet: add DATABASE_URL (Neon).");
  const sql = neon(url);
  return (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ctr_campaigns (
    id SERIAL PRIMARY KEY,
    site_url TEXT NOT NULL,
    keyword TEXT NOT NULL,
    page_url TEXT,
    country TEXT NOT NULL DEFAULT 'VN',
    duration_days INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_ctr NUMERIC NOT NULL,
    target_position INT,
    weekly_growth_pct NUMERIC,
    target_engagement_sec INT,
    gsc_property TEXT,
    ga4_property TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Visit plan, added later: older campaigns get the defaults.
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS day1_visits INT NOT NULL DEFAULT 10`,
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS daily_increase_pct NUMERIC NOT NULL DEFAULT 5`,
  `CREATE TABLE IF NOT EXISTS ctr_days (
    campaign_id INT NOT NULL REFERENCES ctr_campaigns(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    position INT,
    ranking_url TEXT,
    impressions INT,
    clicks INT,
    ctr NUMERIC,
    gsc_position NUMERIC,
    mobile_clicks INT,
    desktop_clicks INT,
    mobile_impressions INT,
    desktop_impressions INT,
    engagement_sec NUMERIC,
    notes JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (campaign_id, day)
  )`,
  // Visit runs finished per day, added later.
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS visits_done INT NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS ctr_notes (
    id SERIAL PRIMARY KEY,
    campaign_id INT NOT NULL REFERENCES ctr_campaigns(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

let schemaReady: Promise<void> | null = null;
async function db(): Promise<Query> {
  const q = query();
  schemaReady ??= (async () => {
    for (const stmt of SCHEMA) await q(stmt);
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  await schemaReady;
  return q;
}

const num = (v: unknown) => (v == null ? null : Number(v));
// The driver reads a DATE as midnight on this computer's clock, so its local date is the day.
// (toISOString would turn it into UTC: the day before, east of Greenwich.)
const isoDay = (v: unknown) =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    : String(v).slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toCampaign(r: Record<string, unknown>): Campaign {
  return {
    id: Number(r.id),
    siteUrl: String(r.site_url),
    keyword: String(r.keyword),
    pageUrl: (r.page_url as string | null) ?? null,
    country: String(r.country),
    durationDays: Number(r.duration_days),
    day1Visits: Number(r.day1_visits),
    dailyIncreasePct: Number(r.daily_increase_pct),
    startDate: isoDay(r.start_date),
    endDate: isoDay(r.end_date),
    targetCtr: Number(r.target_ctr),
    targetPosition: num(r.target_position),
    weeklyGrowthPct: num(r.weekly_growth_pct),
    targetEngagementSec: num(r.target_engagement_sec),
    gscProperty: (r.gsc_property as string | null) ?? null,
    ga4Property: (r.ga4_property as string | null) ?? null,
    status: String(r.status) as CampaignStatus,
    createdAt: iso(r.created_at),
  };
}

function toDay(r: Record<string, unknown>): CampaignDay {
  let notes: DayNotes = {};
  try {
    notes = (typeof r.notes === "string" ? JSON.parse(r.notes) : r.notes) ?? {};
  } catch {
    /* keep empty */
  }
  return {
    campaignId: Number(r.campaign_id),
    day: isoDay(r.day),
    position: num(r.position),
    rankingUrl: (r.ranking_url as string | null) ?? null,
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    ctr: num(r.ctr),
    gscPosition: num(r.gsc_position),
    mobileClicks: num(r.mobile_clicks),
    desktopClicks: num(r.desktop_clicks),
    mobileImpressions: num(r.mobile_impressions),
    desktopImpressions: num(r.desktop_impressions),
    engagementSec: num(r.engagement_sec),
    visitsDone: Number(r.visits_done ?? 0),
    notes,
  };
}

export async function createCampaign(input: NewCampaign, today: string): Promise<Campaign> {
  const q = await db();
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + input.durationDays - 1);
  const rows = await q(
    `INSERT INTO ctr_campaigns (site_url, keyword, page_url, duration_days, start_date, end_date, target_ctr, target_position,
       weekly_growth_pct, target_engagement_sec, gsc_property, ga4_property, day1_visits, daily_increase_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      input.siteUrl,
      input.keyword,
      input.pageUrl || null,
      input.durationDays,
      today,
      end.toISOString().slice(0, 10),
      input.targetCtr,
      input.targetPosition ?? null,
      input.weeklyGrowthPct ?? null,
      input.targetEngagementSec ?? null,
      input.gscProperty || null,
      input.ga4Property || null,
      input.day1Visits,
      input.dailyIncreasePct,
    ],
  );
  return toCampaign(rows[0]);
}

export async function listCampaigns(): Promise<Campaign[]> {
  const q = await db();
  return (await q(`SELECT * FROM ctr_campaigns ORDER BY created_at DESC, id DESC`)).map(toCampaign);
}

export async function getCampaign(id: number): Promise<Campaign | null> {
  const q = await db();
  const rows = await q(`SELECT * FROM ctr_campaigns WHERE id = $1`, [id]);
  return rows[0] ? toCampaign(rows[0]) : null;
}

export async function setCampaignStatus(id: number, status: CampaignStatus): Promise<void> {
  const q = await db();
  await q(`UPDATE ctr_campaigns SET status = $2 WHERE id = $1`, [id, status]);
}

export async function deleteCampaign(id: number): Promise<void> {
  const q = await db();
  await q(`DELETE FROM ctr_campaigns WHERE id = $1`, [id]);
}

const DAY_COLUMNS: Record<keyof DayFields, string> = {
  position: "position",
  rankingUrl: "ranking_url",
  impressions: "impressions",
  clicks: "clicks",
  ctr: "ctr",
  gscPosition: "gsc_position",
  mobileClicks: "mobile_clicks",
  desktopClicks: "desktop_clicks",
  mobileImpressions: "mobile_impressions",
  desktopImpressions: "desktop_impressions",
  engagementSec: "engagement_sec",
  notes: "notes",
};

/**
 * Saves some columns of one day, leaving the others as they are. The sources arrive on different
 * days (Google position today; Search Console and GA4 for a few days ago), so each fills in its part.
 * Notes are merged per source.
 */
export async function upsertDay(campaignId: number, day: string, fields: DayFields): Promise<void> {
  const q = await db();
  const keys = (Object.keys(fields) as (keyof DayFields)[]).filter((k) => fields[k] !== undefined);
  const cols = keys.map((k) => DAY_COLUMNS[k]);
  const values = keys.map((k) => (k === "notes" ? JSON.stringify(fields.notes) : fields[k]));
  const placeholders = keys.map((k, i) => (k === "notes" ? `$${i + 3}::jsonb` : `$${i + 3}`));
  const updates = cols.map((c) => (c === "notes" ? "notes = ctr_days.notes || EXCLUDED.notes" : `${c} = EXCLUDED.${c}`));
  await q(
    `INSERT INTO ctr_days (campaign_id, day${cols.map((c) => ", " + c).join("")}) VALUES ($1, $2${placeholders.map((p) => ", " + p).join("")})
     ON CONFLICT (campaign_id, day) DO ${updates.length ? "UPDATE SET " + updates.join(", ") : "NOTHING"}`,
    [campaignId, day, ...values],
  );
}

/** One more visit run finished on that day. */
export async function addVisitDone(campaignId: number, day: string): Promise<void> {
  const q = await db();
  await q(
    `INSERT INTO ctr_days (campaign_id, day, visits_done) VALUES ($1, $2, 1)
     ON CONFLICT (campaign_id, day) DO UPDATE SET visits_done = ctr_days.visits_done + 1`,
    [campaignId, day],
  );
}

/** Visit runs that finished on `day` (0 if none). */
export async function visitsDoneOn(campaignId: number, day: string): Promise<number> {
  const q = await db();
  const rows = await q(`SELECT visits_done FROM ctr_days WHERE campaign_id = $1 AND day = $2`, [campaignId, day]);
  return Number(rows[0]?.visits_done ?? 0);
}

export async function listDays(campaignId: number): Promise<CampaignDay[]> {
  const q = await db();
  return (await q(`SELECT * FROM ctr_days WHERE campaign_id = $1 ORDER BY day`, [campaignId])).map(toDay);
}

/** Latest day for every campaign, for the dashboard. */
export async function latestDays(): Promise<CampaignDay[]> {
  const q = await db();
  return (await q(`SELECT DISTINCT ON (campaign_id) * FROM ctr_days ORDER BY campaign_id, day DESC`)).map(toDay);
}

export async function addNote(campaignId: number, day: string, text: string): Promise<CampaignNote> {
  const q = await db();
  const rows = await q(`INSERT INTO ctr_notes (campaign_id, day, text) VALUES ($1,$2,$3) RETURNING *`, [campaignId, day, text]);
  return toNote(rows[0]);
}

export async function listNotes(campaignId: number): Promise<CampaignNote[]> {
  const q = await db();
  return (await q(`SELECT * FROM ctr_notes WHERE campaign_id = $1 ORDER BY day, id`, [campaignId])).map(toNote);
}

function toNote(r: Record<string, unknown>): CampaignNote {
  return { id: Number(r.id), campaignId: Number(r.campaign_id), day: isoDay(r.day), text: String(r.text), createdAt: iso(r.created_at) };
}
