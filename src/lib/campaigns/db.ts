// Server-only: Auto CTR storage in Postgres (Neon, via DATABASE_URL). Tables are created on
// first use. All queries go through `query()`, so tests can swap in an in-memory Postgres. A query
// that can't reach the database is tried again for a while (src/lib/db-retry.ts).

import { neon } from "@neondatabase/serverless";
import { withDbRetry } from "../db-retry";
import type { Computer } from "../this-computer";
import { endDateOf, type Campaign, type CampaignChange, type CampaignDay, type CampaignNote, type CampaignStatus, type DayFields, type DayNotes, type EditableField, type FieldChange, type KnownComputer, type NewCampaign } from "./types";

/** The computer a campaign runs on: its id, and the name shown for it. */
type RunsOn = Pick<Computer, "id" | "name">;

/** A computer that said it's on less than this long ago counts as on (it says so every minute). */
const ONLINE_MS = 3 * 60_000;

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

function neonSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new NotConfiguredError("The database isn't connected yet: add DATABASE_URL (Neon).");
  return neon(url);
}

function query(): Query {
  if (testQuery) return testQuery;
  const sql = neonSql();
  return (text, params = []) => withDbRetry(() => sql.query(text, params) as Promise<Record<string, unknown>[]>);
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
  // Visits at the same time, added later: older campaigns run one at a time.
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS concurrency INT NOT NULL DEFAULT 1`,
  // Dwell time (seconds on the site per visit), added later: older campaigns get the defaults.
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS min_dwell_sec INT NOT NULL DEFAULT 30`,
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS max_dwell_sec INT NOT NULL DEFAULT 120`,
  // Mobile traffic (% of visits on a phone), added later: older campaigns get the default.
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS mobile_pct INT NOT NULL DEFAULT 70`,
  // The computer that runs the campaign (src/lib/this-computer.ts), added later: older campaigns have
  // none until a computer takes them.
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS computer_id TEXT`,
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS computer_name TEXT`,
  // A page watches its live console from another computer until then (src/lib/live-relay.ts), added later.
  `ALTER TABLE ctr_campaigns ADD COLUMN IF NOT EXISTS live_until TIMESTAMPTZ`,
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
  // Of those, the ones on a phone, added later.
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS mobile_visits_done INT NOT NULL DEFAULT 0`,
  // What the day's visits did (added later, saved with each visit's count: no extra writes): the tries
  // that didn't count, the CAPTCHAs met and solved, seconds on the site and pages read, the site's
  // Google position seen in the visits' own searches, and the last visit (when, on which computer).
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS visit_tries_failed INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS captchas_met INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS captchas_solved INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS visit_seconds INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS pages_read INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS visit_position_sum INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS visit_position_count INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS visit_position_best INT`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ`,
  `ALTER TABLE ctr_days ADD COLUMN IF NOT EXISTS last_computer TEXT`,
  // The computers with the app (src/lib/this-computer.ts), added later: each says it's on every
  // minute, so a campaign can be started on any of them from another computer.
  `CREATE TABLE IF NOT EXISTS ctr_computers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT,
    app_version TEXT,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Each campaign's change history (created, edited, status, moved: who, when, from what to what), added later.
  `CREATE TABLE IF NOT EXISTS ctr_campaign_changes (
    id SERIAL PRIMARY KEY,
    campaign_id INT NOT NULL REFERENCES ctr_campaigns(id) ON DELETE CASCADE,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    by_user TEXT,
    kind TEXT NOT NULL,
    changes JSONB NOT NULL DEFAULT '[]'::jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS ctr_campaign_changes_campaign ON ctr_campaign_changes (campaign_id, at)`,
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
    if (testQuery) {
      for (const stmt of SCHEMA) await q(stmt);
      return;
    }
    // All in one round trip to the database (it's far away), not one per statement.
    const sql = neonSql();
    await withDbRetry(() => sql.transaction(SCHEMA.map((stmt) => sql.query(stmt))));
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
    concurrency: Number(r.concurrency),
    minDwellSec: Number(r.min_dwell_sec),
    maxDwellSec: Number(r.max_dwell_sec),
    mobilePct: Number(r.mobile_pct),
    computerId: (r.computer_id as string | null) ?? null,
    computerName: (r.computer_name as string | null) ?? null,
    liveUntil: r.live_until ? iso(r.live_until) : null,
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
    mobileVisitsDone: Number(r.mobile_visits_done ?? 0),
    visitTriesFailed: Number(r.visit_tries_failed ?? 0),
    captchasMet: Number(r.captchas_met ?? 0),
    captchasSolved: Number(r.captchas_solved ?? 0),
    visitSeconds: Number(r.visit_seconds ?? 0),
    pagesRead: Number(r.pages_read ?? 0),
    visitPositionAvg: Number(r.visit_position_count ?? 0) > 0 ? Math.round((Number(r.visit_position_sum) / Number(r.visit_position_count)) * 10) / 10 : null,
    visitPositionBest: num(r.visit_position_best),
    lastVisitAt: r.last_visit_at ? new Date(r.last_visit_at as string).toISOString() : null,
    lastComputer: (r.last_computer as string | null) ?? null,
    notes,
  };
}

/**
 * Saves a change and its entry in the change history in one statement (both or neither): `change` is a
 * statement on ctr_campaigns ending in RETURNING * (`paramCount` parameters, then who made it), and
 * `changes` the SQL for the entry's field changes (`c`: the row as changed). No row changed: no entry.
 */
function withHistory(change: string, kind: CampaignChange["kind"], changes: string, paramCount: number) {
  return `WITH c AS (${change}),
     h AS (INSERT INTO ctr_campaign_changes (campaign_id, by_user, kind, changes) SELECT c.id, $${paramCount + 1}, '${kind}', ${changes} FROM c)
   SELECT * FROM c`;
}

/** `computer`: the one that runs it (null: none yet, the first computer that starts takes it). `by`: who made it. */
export async function createCampaign(input: NewCampaign, today: string, computer: RunsOn | null, by: string | null = null): Promise<Campaign> {
  const q = await db();
  const rows = await q(
    withHistory(
      `INSERT INTO ctr_campaigns (site_url, keyword, page_url, duration_days, start_date, end_date, target_ctr, target_position,
         weekly_growth_pct, target_engagement_sec, gsc_property, ga4_property, day1_visits, daily_increase_pct, concurrency,
         min_dwell_sec, max_dwell_sec, mobile_pct, computer_id, computer_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      "created",
      `jsonb_build_array(jsonb_build_object('field', 'computer', 'from', NULL, 'to', c.computer_name))`,
      20,
    ),
    [
      input.siteUrl,
      input.keyword,
      input.pageUrl || null,
      input.durationDays,
      today,
      endDateOf(today, input.durationDays),
      input.targetCtr,
      input.targetPosition ?? null,
      input.weeklyGrowthPct ?? null,
      input.targetEngagementSec ?? null,
      input.gscProperty || null,
      input.ga4Property || null,
      input.day1Visits,
      input.dailyIncreasePct,
      input.concurrency,
      input.minDwellSec,
      input.maxDwellSec,
      input.mobilePct,
      computer?.id ?? null,
      computer?.name ?? null,
      by,
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

/** Paused, resumed, stopped (`by`: who), or finished by the daily check (`by` null). Kept in the change history. */
export async function setCampaignStatus(id: number, status: CampaignStatus, by: string | null = null): Promise<void> {
  const q = await db();
  // `o`: the row before the change (every part of the statement sees the database as it was).
  await q(
    withHistory(
      `UPDATE ctr_campaigns SET status = $2 WHERE id = $1 AND status <> $2 RETURNING *`,
      "status",
      `(SELECT jsonb_build_array(jsonb_build_object('field', 'status', 'from', o.status, 'to', c.status)) FROM ctr_campaigns o WHERE o.id = c.id)`,
      2,
    ),
    [id, status, by],
  );
}

/** A campaign no computer runs yet: this one takes it. Null if another computer took it first. */
export async function claimCampaign(id: number, computer: Computer): Promise<Campaign | null> {
  const q = await db();
  const rows = await q(
    withHistory(
      `UPDATE ctr_campaigns SET computer_id = $2, computer_name = $3 WHERE id = $1 AND computer_id IS NULL RETURNING *`,
      "moved",
      `jsonb_build_array(jsonb_build_object('field', 'computer', 'from', NULL, 'to', c.computer_name))`,
      3,
    ),
    [id, computer.id, computer.name, null],
  );
  return rows[0] ? toCampaign(rows[0]) : null;
}

/** The campaign moves to `computer` (this one, or any other), from whichever computer ran it. `by`: who moved it. */
export async function moveCampaign(id: number, computer: RunsOn, by: string | null = null): Promise<Campaign | null> {
  const q = await db();
  const rows = await q(
    withHistory(
      `UPDATE ctr_campaigns SET computer_id = $2, computer_name = $3 WHERE id = $1 AND computer_id IS DISTINCT FROM $2 RETURNING *`,
      "moved",
      `(SELECT jsonb_build_array(jsonb_build_object('field', 'computer', 'from', o.computer_name, 'to', c.computer_name)) FROM ctr_campaigns o WHERE o.id = c.id)`,
      3,
    ),
    [id, computer.id, computer.name, by],
  );
  return rows[0] ? toCampaign(rows[0]) : getCampaign(id);
}

const EDIT_COLUMNS: Record<EditableField | "endDate" | "status", string> = {
  siteUrl: "site_url",
  keyword: "keyword",
  pageUrl: "page_url",
  durationDays: "duration_days",
  endDate: "end_date",
  day1Visits: "day1_visits",
  dailyIncreasePct: "daily_increase_pct",
  concurrency: "concurrency",
  minDwellSec: "min_dwell_sec",
  maxDwellSec: "max_dwell_sec",
  mobilePct: "mobile_pct",
  status: "status",
};

/**
 * Saves an edit: `changes` (field, from, to; see FIELD_LABELS), kept in the change history with `by`.
 * Only the fields in `changes` are written. The campaign as it is now, or null if there's no such one.
 */
export async function updateCampaign(id: number, changes: FieldChange[], by: string | null): Promise<Campaign | null> {
  const writes = changes.filter((ch): ch is FieldChange & { field: keyof typeof EDIT_COLUMNS } => ch.field in EDIT_COLUMNS);
  if (!writes.length) return getCampaign(id);
  const q = await db();
  const sets = writes.map((ch, i) => `${EDIT_COLUMNS[ch.field]} = $${i + 2}`);
  const rows = await q(
    withHistory(`UPDATE ctr_campaigns SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, "edited", `$${writes.length + 3}::jsonb`, writes.length + 1),
    [id, ...writes.map((ch) => ch.to), by, JSON.stringify(changes)],
  );
  return rows[0] ? toCampaign(rows[0]) : null;
}

/** The campaign's change history, newest first. */
export async function listChanges(campaignId: number): Promise<CampaignChange[]> {
  const q = await db();
  const rows = await q(`SELECT * FROM ctr_campaign_changes WHERE campaign_id = $1 ORDER BY at DESC, id DESC`, [campaignId]);
  return rows.map((r) => ({
    id: Number(r.id),
    campaignId: Number(r.campaign_id),
    at: iso(r.at),
    by: (r.by_user as string | null) ?? null,
    kind: String(r.kind) as CampaignChange["kind"],
    changes: ((typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes) ?? []) as FieldChange[],
  }));
}

/**
 * A page watches the campaign's live console from another computer: the computer that runs it sends it
 * through the relay until `seconds` from now (asked again while the page stays open). Its computer, or
 * null if no such campaign.
 */
export async function requestLive(id: number, seconds: number): Promise<Pick<Campaign, "computerId" | "computerName"> | null> {
  const q = await db();
  const rows = await q(`UPDATE ctr_campaigns SET live_until = now() + make_interval(secs => $2) WHERE id = $1 RETURNING computer_id, computer_name`, [id, seconds]);
  return rows[0] ? { computerId: (rows[0].computer_id as string | null) ?? null, computerName: (rows[0].computer_name as string | null) ?? null } : null;
}

/** This computer is on (every minute): its name, Windows name and app version, and the time. */
export async function reportComputer(computer: Computer, appVersion: string | null): Promise<void> {
  const q = await db();
  await q(
    `INSERT INTO ctr_computers (id, name, hostname, app_version, last_seen) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hostname = EXCLUDED.hostname, app_version = EXCLUDED.app_version, last_seen = now()`,
    [computer.id, computer.name, computer.hostname, appVersion],
  );
}

/**
 * The computers campaigns can run on, those on first, then by name. Also the ones that only appear on
 * campaigns (their app is older than computers saying they're on): they still run what's theirs.
 */
export async function listComputers(): Promise<KnownComputer[]> {
  const q = await db();
  const rows = await q(
    `WITH open AS (
       SELECT computer_id, max(computer_name) AS name, count(*) FILTER (WHERE status IN ('active', 'paused')) AS campaigns
       FROM ctr_campaigns WHERE computer_id IS NOT NULL GROUP BY computer_id
     )
     SELECT coalesce(k.id, o.computer_id) AS id, coalesce(k.name, o.name, 'Unnamed PC') AS name, k.hostname, k.app_version, k.last_seen,
       coalesce(k.last_seen > now() - make_interval(secs => $1), false) AS online, coalesce(o.campaigns, 0) AS campaigns
     FROM ctr_computers k FULL JOIN open o ON o.computer_id = k.id
     ORDER BY online DESC, lower(coalesce(k.name, o.name, ''))`,
    [ONLINE_MS / 1000],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    hostname: (r.hostname as string | null) ?? null,
    appVersion: (r.app_version as string | null) ?? null,
    lastSeen: r.last_seen ? iso(r.last_seen) : null,
    online: r.online === true,
    campaigns: Number(r.campaigns),
  }));
}

/** One computer campaigns can run on (see listComputers); null if no such computer. */
export async function getComputer(id: string): Promise<KnownComputer | null> {
  return (await listComputers()).find((c) => c.id === id) ?? null;
}

/**
 * A computer got a new name (Settings): its campaigns, and their days' "last visit" made on it
 * (under its old name), show the new one. Two writes, only when the name changes.
 */
export async function renameComputer(computerId: string, oldName: string, newName: string): Promise<void> {
  if (oldName === newName) return;
  const q = await db();
  await q(`UPDATE ctr_days SET last_computer = $3 WHERE last_computer = $2 AND campaign_id IN (SELECT id FROM ctr_campaigns WHERE computer_id = $1)`, [computerId, oldName, newName]);
  await q(`UPDATE ctr_campaigns SET computer_name = $2 WHERE computer_id = $1`, [computerId, newName]);
  await q(`UPDATE ctr_computers SET name = $2 WHERE id = $1`, [computerId, newName]);
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

/** What visits add to a day: see recordVisits. */
export interface VisitDayDelta {
  /** Visits that counted (0: only tries that didn't, saved when a lane stops). */
  done: number;
  mobile: number;
  /** Tries that didn't count (a CAPTCHA not solved, the site not found, a proxy failing…). */
  failed: number;
  captchasMet: number;
  captchasSolved: number;
  /** Seconds on the site and pages read, over the visits that counted. */
  seconds: number;
  pages: number;
  /** The site's Google position in those visits' searches. */
  positions: number[];
  /** The computer that made them. */
  computer: string | null;
}

/**
 * Adds to a day's visit numbers in one write: each visit that counts is saved together with what
 * happened before it (its failed tries and CAPTCHAs), so the details cost no extra writes.
 */
export async function recordVisits(campaignId: number, day: string, d: VisitDayDelta): Promise<void> {
  const q = await db();
  const best = d.positions.length ? Math.min(...d.positions) : null;
  const sum = d.positions.reduce((a, b) => a + b, 0);
  await q(
    `INSERT INTO ctr_days (campaign_id, day, visits_done, mobile_visits_done, visit_tries_failed, captchas_met, captchas_solved,
       visit_seconds, pages_read, visit_position_sum, visit_position_count, visit_position_best, last_visit_at, last_computer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $3::int > 0 THEN now() END, $13)
     ON CONFLICT (campaign_id, day) DO UPDATE SET
       visits_done = ctr_days.visits_done + EXCLUDED.visits_done,
       mobile_visits_done = ctr_days.mobile_visits_done + EXCLUDED.mobile_visits_done,
       visit_tries_failed = ctr_days.visit_tries_failed + EXCLUDED.visit_tries_failed,
       captchas_met = ctr_days.captchas_met + EXCLUDED.captchas_met,
       captchas_solved = ctr_days.captchas_solved + EXCLUDED.captchas_solved,
       visit_seconds = ctr_days.visit_seconds + EXCLUDED.visit_seconds,
       pages_read = ctr_days.pages_read + EXCLUDED.pages_read,
       visit_position_sum = ctr_days.visit_position_sum + EXCLUDED.visit_position_sum,
       visit_position_count = ctr_days.visit_position_count + EXCLUDED.visit_position_count,
       visit_position_best = LEAST(ctr_days.visit_position_best, EXCLUDED.visit_position_best),
       last_visit_at = COALESCE(EXCLUDED.last_visit_at, ctr_days.last_visit_at),
       last_computer = COALESCE(EXCLUDED.last_computer, ctr_days.last_computer)`,
    [campaignId, day, d.done, d.mobile, d.failed, d.captchasMet, d.captchasSolved, d.seconds, d.pages, sum, d.positions.length, best, d.computer],
  );
}

/** Visit runs that finished on `day`, and how many of them were on a phone (0 if none). */
export async function visitsDoneOn(campaignId: number, day: string): Promise<{ total: number; mobile: number }> {
  const q = await db();
  const rows = await q(`SELECT visits_done, mobile_visits_done FROM ctr_days WHERE campaign_id = $1 AND day = $2`, [campaignId, day]);
  return { total: Number(rows[0]?.visits_done ?? 0), mobile: Number(rows[0]?.mobile_visits_done ?? 0) };
}

/** The days of several campaigns in one query, by campaign id (each in day order). */
export async function listDaysFor(campaignIds: number[]): Promise<Map<number, CampaignDay[]>> {
  const byCampaign = new Map<number, CampaignDay[]>(campaignIds.map((id) => [id, []]));
  if (!campaignIds.length) return byCampaign;
  const q = await db();
  for (const d of (await q(`SELECT * FROM ctr_days WHERE campaign_id = ANY($1::int[]) ORDER BY campaign_id, day`, [campaignIds])).map(toDay)) {
    byCampaign.get(d.campaignId)?.push(d);
  }
  return byCampaign;
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
