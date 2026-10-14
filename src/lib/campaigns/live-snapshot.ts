// Server-only, local only: what this computer's campaigns are doing, for pages open on other computers
// (or at home), in the "I'm on" it writes every minute (scheduler.ts → reportComputer): no extra writes,
// and overwritten each time (never kept). Only with Realtime updates on for this computer (Settings →
// This computer; each computer has its own, off unless turned on): off, nothing is added.
// Per campaign: each lane's latest console lines (so every visit running side by side shows, a waiting
// one too) and the visits that finished in the last 30 minutes, their reports trimmed to what the pages
// show (a few KB), so the console and realtime panel can be shown.

import { readLocalSetting, writeLocalSetting } from "../local-settings";
import type { VisitPage, VisitReport } from "../visit-types";
import type { LiveCampaign, LiveSnapshot } from "./types";
import { campaignVisitNow, type LoggedVisitEvent } from "./visits";

const SETTING = "realtime_updates";
/** The latest console lines kept of each lane, and of the whole visit (besides the finished visits). */
const LANE_LINES = 10;
/** Finished visits kept: those of the last 30 minutes (the realtime panel's), at most this many. */
const VISITS_MS = 30 * 60_000;
const MAX_VISITS = 20;

// On globalThis: a code reload in `next dev` keeps it.
const g = globalThis as typeof globalThis & { __realtimeUpdates?: boolean };

/** Whether this computer shares what its campaigns are doing (Realtime updates). */
export async function realtimeUpdates(): Promise<boolean> {
  g.__realtimeUpdates ??= (await readLocalSetting(SETTING).catch(() => null))?.value === "on";
  return g.__realtimeUpdates;
}

/** Turns Realtime updates on or off for this computer (from its next minute check-in). */
export async function setRealtimeUpdates(on: boolean, by: string | null): Promise<void> {
  await writeLocalSetting(SETTING, on ? "on" : "off", by);
  g.__realtimeUpdates = on;
}

/** A page, as pages elsewhere show it (its checks left out). */
const trimPage = (p: VisitPage): VisitPage => ({
  kind: p.kind,
  url: p.url,
  finalUrl: p.finalUrl,
  status: p.status,
  title: p.title,
  loadMs: p.loadMs,
  ttfbMs: p.ttfbMs,
  ok: p.ok,
  readSec: p.readSec,
  consoleErrors: [],
  failedRequests: [],
});

/** A finished visit's report, as pages elsewhere show it. */
const trimReport = (r: VisitReport): VisitReport => ({
  ...r,
  proxy: null,
  exitEnd: null,
  scroll: null,
  discovery: null,
  issues: r.issues.slice(0, 5),
  start: r.start ? trimPage(r.start) : null,
  pages: r.pages.map(trimPage),
});

/** What these campaigns' visits are doing now (those with a visit since the app started). */
export function liveSnapshot(campaignIds: number[]): LiveSnapshot {
  const now = Date.now();
  const campaigns: Record<string, LiveCampaign> = {};
  for (const id of campaignIds) {
    const v = campaignVisitNow(id);
    if (!v) continue;
    const done = v.events.filter((e) => e.type === "done" && now - e.at <= VISITS_MS).slice(-MAX_VISITS);
    // Every lane's latest lines (not only the campaign's latest, which the busiest lanes fill), so a page
    // elsewhere shows each lane running side by side and what it's doing, a waiting one too; and the
    // latest lines about the whole visit (no lane).
    const recent: LoggedVisitEvent[] = [];
    const perLane = new Map<number, number>();
    for (let i = v.events.length - 1; i >= 0; i--) {
      const e = v.events[i];
      if (e.type === "done") continue;
      const lane = e.lane ?? 0;
      const n = perLane.get(lane) ?? 0;
      if (n >= LANE_LINES) continue;
      perLane.set(lane, n + 1);
      recent.push(e);
    }
    const lines = [...done, ...recent]
      .sort((a, b) => a.at - b.at)
      .map((e) => (e.type === "done" ? { ...e, report: trimReport(e.report) } : e)) as (LoggedVisitEvent & Record<string, unknown>)[];
    campaigns[id] = { running: v.running, startedAt: v.startedAt, run: v.run, runs: v.runs, lanes: v.lanes, lines };
  }
  return { at: new Date(now).toISOString(), campaigns };
}
