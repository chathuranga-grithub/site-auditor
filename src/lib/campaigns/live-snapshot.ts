// Server-only, local only: what this computer's campaigns are doing, for pages open on other computers
// (or at home), in the "I'm on" it writes every minute (scheduler.ts → reportComputer): no extra writes,
// and overwritten each time (never kept). Only with Realtime updates on for this computer (Settings →
// This computer; each computer has its own, off unless turned on): off, nothing is added.
// Per campaign: its latest console lines and the visits that finished in the last 30 minutes, their
// reports trimmed to what the pages show (a few KB), so the console and realtime panel can be shown.

import { readLocalSetting, writeLocalSetting } from "../local-settings";
import type { VisitPage, VisitReport } from "../visit-types";
import type { LiveCampaign, LiveSnapshot } from "./types";
import { campaignVisitNow, type LoggedVisitEvent } from "./visits";

const SETTING = "realtime_updates";
/** The latest console lines kept (besides the finished visits). */
const LINES = 40;
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
    const recent = v.events.filter((e) => e.type !== "done").slice(-LINES);
    const lines = [...done, ...recent]
      .sort((a, b) => a.at - b.at)
      .map((e) => (e.type === "done" ? { ...e, report: trimReport(e.report) } : e)) as (LoggedVisitEvent & Record<string, unknown>)[];
    campaigns[id] = { running: v.running, startedAt: v.startedAt, run: v.run, runs: v.runs, lanes: v.lanes, lines };
  }
  return { at: new Date(now).toISOString(), campaigns };
}
