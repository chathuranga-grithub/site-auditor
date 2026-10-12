// Server-only: the live console relay (relay/server.mjs), so a campaign's live console can be watched
// from any computer or from home when it runs on another PC. Only on demand: a page watching a campaign
// from elsewhere marks it in the database (requestLive, every 2 minutes while it's open); the computer
// that runs it sees the mark in its usual minute check (scheduler.ts) and only then connects to the
// relay, sending that campaign's console (what happened so far, then live, a few lines at a time). Once
// no page watches any more, it lets go. Nothing is stored on the relay or in the database.
// Tokens are signed with a key made from AUTH_SECRET (not AUTH_SECRET itself: the relay holds it, and
// must never be able to sign anyone in). Plain WebSocket (built into Node): nothing extra loaded.

import { createHmac, hkdfSync } from "node:crypto";
import { readSecretSetting, writeSecretSetting, deleteSecretSetting } from "./secret-settings";
import type { Computer } from "./this-computer";
import { watchCampaignVisit, type LoggedVisitEvent } from "./campaigns/visits";

const URL_SETTING = "live_relay_url";
/** Lines are sent this often, together, not one message per line. */
const FLUSH_MS = 500;
/** What happened so far is sent in parts of this many lines, and only the last ones. */
const CHUNK = 200;
const MAX_REPLAY = 2000;

/** The relay's key (RELAY_SECRET on the relay): made from AUTH_SECRET, which can't be found from it. */
export function relaySecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  return Buffer.from(hkdfSync("sha256", secret, "seo-auditor", "live-relay-v1", 32)).toString("base64url");
}

/** A token the relay accepts, for `seconds` (only checked when connecting). */
export function relayToken(payload: { r: "pc"; pc: string } | { r: "v"; c: number; pc: string }, seconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url");
  return `${body}.${createHmac("sha256", relaySecret()).update(body).digest("base64url")}`;
}

/** The relay's address (wss://…): LIVE_RELAY_URL, else the one saved in Settings; null if none. */
export async function relayUrl(): Promise<string | null> {
  if (process.env.LIVE_RELAY_URL) return process.env.LIVE_RELAY_URL;
  const s = await readSecretSetting(URL_SETTING).catch(() => null);
  return s?.state === "ok" ? s.value : null;
}

/** Saves the relay's address (Settings); empty: none. Returns the address, or an error message. */
export async function saveRelayUrl(value: string, by: string | null): Promise<{ url: string | null } | string> {
  const raw = value.trim();
  if (!raw) {
    await deleteSecretSetting(URL_SETTING);
    return { url: null };
  }
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `wss://${raw}`);
  } catch {
    return "Enter the relay's address, e.g. wss://site-auditor-relay.onrender.com";
  }
  if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol === "http:") u.protocol = "ws:";
  if (u.protocol !== "wss:" && u.protocol !== "ws:") return "The relay's address starts with wss://";
  const url = u.toString().replace(/\/$/, "");
  await writeSecretSetting(URL_SETTING, url, by);
  return { url };
}

// ── This PC, connected to the relay while someone watches one of its campaigns ──

interface Watched {
  stop: () => void;
  /** The visit's console so far (the visit's own list, not a copy). */
  events: LoggedVisitEvent[];
  pending: LoggedVisitEvent[];
  ended: boolean;
}

const g = globalThis as typeof globalThis & {
  __liveRelay?: { ws: WebSocket | null; wanted: Set<number>; watched: Map<number, Watched>; timer: ReturnType<typeof setInterval> | null; me: Computer | null };
};
const state = (g.__liveRelay ??= { ws: null, wanted: new Set(), watched: new Map(), timer: null, me: null });

const send = (msg: object) => {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
};

/**
 * The campaigns of this computer pages watch from elsewhere now (from the minute check). Connects to
 * the relay when there are some, lets go when there are none and no page is left watching. `me` null:
 * this copy of the app doesn't run the computer's campaigns (any more): it lets go now.
 */
export async function serveLiveConsoles(me: Computer | null, campaignIds: number[]): Promise<void> {
  state.me = me;
  state.wanted = new Set(me ? campaignIds : []);
  if (!me) disconnect();
  else if (state.wanted.size) await connect();
  else if (!state.watched.size) disconnect();
}

async function connect(): Promise<void> {
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) return;
  const url = await relayUrl();
  if (!url || !state.me) return;
  const ws = new WebSocket(`${url}/?token=${encodeURIComponent(relayToken({ r: "pc", pc: state.me.id }, 600))}`);
  state.ws = ws;
  ws.addEventListener("message", (e) => onMessage(String(e.data)));
  ws.addEventListener("close", () => {
    if (state.ws !== ws) return;
    state.ws = null;
    stopAll();
    // Still wanted: connected again at the next minute check.
  });
  ws.addEventListener("error", () => {
    /* the close that follows handles it */
  });
  state.timer ??= setInterval(flush, FLUSH_MS);
}

function disconnect(): void {
  stopAll();
  state.ws?.close();
  state.ws = null;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function stopAll(): void {
  for (const w of state.watched.values()) w.stop();
  state.watched.clear();
}

function onMessage(text: string): void {
  let m: { t?: string; c?: number; v?: number };
  try {
    m = JSON.parse(text);
  } catch {
    return;
  }
  if (typeof m.c !== "number") return;
  if (m.t === "join" && typeof m.v === "number") join(m.c, m.v);
  else if (m.t === "leave") {
    state.watched.get(m.c)?.stop();
    state.watched.delete(m.c);
    if (!state.watched.size && !state.wanted.size) disconnect();
  }
}

/** A page started watching campaign `c`: it gets what happened so far, then the live lines. */
function join(c: number, viewer: number): void {
  // Only this computer's campaigns that a page asked for (the relay only sends those anyway).
  if (!state.wanted.has(c) && !state.watched.has(c)) return;
  let w = state.watched.get(c);
  if (!w) {
    const entry: Watched = { stop: () => {}, events: [], pending: [], ended: false };
    const live = watchCampaignVisit(
      c,
      (e) => entry.pending.push(e),
      () => (entry.ended = true),
    );
    Object.assign(entry, { stop: live?.stop ?? (() => {}), events: live?.events ?? [], ended: !live?.running });
    w = entry;
    state.watched.set(c, w);
  }
  // Lines not sent yet go to the pages already watching; this one gets them in what happened so far.
  flush();
  const lines = w.events.slice(-MAX_REPLAY);
  const end = w.ended;
  if (!lines.length) send({ t: "lines", c, to: viewer, first: true, lines: [], ...(end ? { end } : {}) });
  for (let i = 0; i < lines.length; i += CHUNK) {
    const last = i + CHUNK >= lines.length;
    send({ t: "lines", c, to: viewer, ...(i === 0 ? { first: true } : {}), lines: lines.slice(i, i + CHUNK), ...(last && end ? { end } : {}) });
  }
}

/** Sends the new lines of every watched campaign, together. */
function flush(): void {
  for (const [c, w] of state.watched) {
    if (w.pending.length) send({ t: "lines", c, lines: w.pending.splice(0) });
    if (w.ended) {
      send({ t: "lines", c, lines: [], end: true });
      w.stop();
      state.watched.delete(c);
    }
  }
}
