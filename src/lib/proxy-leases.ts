// Server-only: who uses each proxy API link right now, across every computer, in the database. A link
// is used by one job at a time (asking its API for a new IP changes the IP under whoever is using it),
// and the computers share the links saved in Settings: so each claims a link here before using it.
// One statement claims a free one at random (two computers can't get the same one), a claim is renewed
// every minute (one write for all a computer holds) and lapses after a few minutes if not (the computer
// crashed or slept), and a link's rest (its provider gives a new IP only after N seconds) is shared too.
// The links themselves aren't stored (they hold the provider's token): only a fingerprint of each.

import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { withDbRetry } from "./db-retry";

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** A claim lapses after this long without being renewed. */
const HOLD_SEC = 180;
/** Claims held here are renewed this often. */
const RENEW_MS = 60_000;

const SCHEMA = `CREATE TABLE IF NOT EXISTS ctr_proxy_links (
  link_key TEXT PRIMARY KEY,
  holder TEXT,
  computer_id TEXT,
  expires_at TIMESTAMPTZ,
  rest_until TIMESTAMPTZ
)`;

let testQuery: Query | null = null;
/** Tests only: run queries against another database. */
export function useProxyLeasesQueryForTests(q: Query | null) {
  testQuery = q;
  state.ready = null;
  state.ensured = "";
}

// On globalThis: every copy of this module in the server (routes, scheduler) shares the claims held.
const g = globalThis as typeof globalThis & {
  __proxyLeases?: { ready: Promise<void> | null; ensured: string; held: Set<string>; timer: ReturnType<typeof setInterval> | null };
};
const state = (g.__proxyLeases ??= { ready: null, ensured: "", held: new Set(), timer: null });

/** The database, or null when none is set (one computer on its own: links are shared in memory only). */
async function db(): Promise<Query | null> {
  let q = testQuery;
  if (!q) {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    const sql = neon(url);
    q = (text, params = []) => withDbRetry(() => sql.query(text, params) as Promise<Record<string, unknown>[]>);
  }
  const run = q;
  state.ready ??= run(SCHEMA).then(
    () => undefined,
    (err) => {
      // Another computer created it at the same moment (Postgres then refuses all but one): it's there.
      const code = (err as { code?: string }).code;
      if (code === "23505" || code === "42P07") return;
      state.ready = null;
      throw err;
    },
  );
  await state.ready;
  return run;
}

/** A link's fingerprint: what the database knows it by. */
export const linkKey = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 32);

/** Every link has its row (once per set of links, not on every claim). */
async function ensure(q: Query, keys: string[]): Promise<void> {
  const id = keys.slice().sort().join(",");
  if (state.ensured === id) return;
  await q(`INSERT INTO ctr_proxy_links (link_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, [keys]);
  state.ensured = id;
}

export type Claim = { key: string; holder: string } | { none: true; busy: number; restSec: number | null } | null;

/**
 * Claims one of these links (keys) for `computerId`, at random among the free ones: not held (or its
 * claim lapsed) and not resting. When none is free: how many are held, and the soonest a resting one
 * is free again (seconds). Null: no database (the caller shares the links in memory only).
 */
export async function claimLink(keys: string[], computerId: string | null): Promise<Claim> {
  const q = await db();
  if (!q) return null;
  await ensure(q, keys);
  const holder = randomUUID();
  // The row is locked while it's picked (SKIP LOCKED: a computer claiming at the same moment takes
  // another one), and checked again when written: never held twice.
  const free = `(holder IS NULL OR expires_at < now()) AND (rest_until IS NULL OR rest_until <= now())`;
  const rows = await q(
    `UPDATE ctr_proxy_links SET holder = $2, computer_id = $3, expires_at = now() + make_interval(secs => $4)
     WHERE ${free} AND link_key = (
       SELECT link_key FROM ctr_proxy_links WHERE link_key = ANY($1::text[]) AND ${free} ORDER BY random() LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING link_key`,
    [keys, holder, computerId, HOLD_SEC],
  );
  if (rows[0]) {
    hold(holder);
    return { key: String(rows[0].link_key), holder };
  }
  const [w] = await q(
    `SELECT count(*) FILTER (WHERE holder IS NOT NULL AND expires_at >= now()) AS busy,
       ceil(extract(epoch FROM min(rest_until) FILTER (WHERE (holder IS NULL OR expires_at < now()) AND rest_until > now()) - now())) AS rest
     FROM ctr_proxy_links WHERE link_key = ANY($1::text[])`,
    [keys],
  );
  return { none: true, busy: Number(w?.busy ?? 0), restSec: w?.rest == null ? null : Number(w.rest) };
}

/** The link is free again (the claim is let go only if it's still this one's). */
export async function releaseLink(key: string, holder: string): Promise<void> {
  state.held.delete(holder);
  const q = await db();
  await q?.(`UPDATE ctr_proxy_links SET holder = NULL, computer_id = NULL, expires_at = NULL WHERE link_key = $1 AND holder = $2`, [key, holder]);
}

/** The link's provider gives a new IP only after `seconds`: no computer gets it before then. */
export async function restLink(key: string, seconds: number): Promise<void> {
  const q = await db();
  await q?.(`UPDATE ctr_proxy_links SET rest_until = now() + make_interval(secs => $2) WHERE link_key = $1`, [key, seconds]);
}

/** Keeps a claim from lapsing while it's used: renewed with the others held here, once a minute. */
function hold(holder: string): void {
  state.held.add(holder);
  state.timer ??= setInterval(() => void renew(), RENEW_MS);
}

async function renew(): Promise<void> {
  if (!state.held.size) return;
  try {
    const q = await db();
    await q?.(`UPDATE ctr_proxy_links SET expires_at = now() + make_interval(secs => $2) WHERE holder = ANY($1::text[])`, [[...state.held], HOLD_SEC]);
  } catch (err) {
    console.warn("Couldn't renew the proxy links held here:", err);
  }
}
