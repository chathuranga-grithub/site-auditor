// Server-only, local only: each campaign's visit to its site through the proxy (the visit run,
// src/lib/visit-runner.ts). It runs on the server, not in a browser tab: it starts when a campaign is
// created or resumed, runs again once a day (src/lib/campaigns/scheduler.ts), and stops when it's
// paused, stopped or deleted. Each time it's the day's target visits from the campaign's visit plan
// (day 1 visits, grown by the daily increase), one after another, each with a new proxy IP. Every line of its console is kept in memory only (never saved), so any open campaign page
// can replay it and then follow it live. Restarting the app clears it.

import { ProxyWaitError } from "../proxy-api";
import { resolveProxyApi } from "../proxy-settings";
import type { VisitEvent } from "../visit-types";
import { addVisitDone, visitsDoneOn } from "./db";
import { todayInVietnam } from "./site";
import { daysBetween } from "./metrics";
import { plannedVisits, type Campaign } from "./types";

/** One console line: the event and when it happened (ms). */
export type LoggedVisitEvent = VisitEvent & { at: number };

interface LiveVisit {
  startedAt: number;
  /** Runs in a row (the day's target visits) and the one running now. */
  runs: number;
  run: number;
  events: LoggedVisitEvent[];
  running: boolean;
  controller: AbortController;
  /** Open campaign pages following it; called with null when the visit ends. */
  listeners: Set<(e: LoggedVisitEvent | null) => void>;
}

// On globalThis, so a code reload in `next dev` doesn't lose visits that are running.
const g = globalThis as typeof globalThis & { __campaignVisits?: Map<number, LiveVisit> };
const visits = (g.__campaignVisits ??= new Map<number, LiveVisit>());

/** Visits need a real browser: only when the app runs on a computer, not on Vercel. */
export const canRunVisits = () => !process.env.VERCEL;

type VisitCampaign = Pick<Campaign, "id" | "siteUrl" | "startDate" | "durationDays" | "day1Visits" | "dailyIncreasePct">;

/** The campaign's target visits for today (Vietnam date), from its visit plan. */
export function targetVisitsToday(c: VisitCampaign): number {
  const day = Math.min(Math.max(1, daysBetween(c.startDate, todayInVietnam()) + 1), c.durationDays);
  return plannedVisits(c.day1Visits, c.dailyIncreasePct, day);
}

/** Starts the campaign's visit: today's target visits, one after another (a running visit is stopped first). */
export function startCampaignVisit(c: VisitCampaign): void {
  if (!canRunVisits()) return;
  stopCampaignVisit(c.id);
  const runs = targetVisitsToday(c);
  const v: LiveVisit = { startedAt: Date.now(), runs, run: 1, events: [], running: true, controller: new AbortController(), listeners: new Set() };
  visits.set(c.id, v);
  void run(c, v);
}

export function stopCampaignVisit(campaignId: number): void {
  visits.get(campaignId)?.controller.abort();
}

/** The campaign's visit right now, for the page's heartbeat; null if none since the app started. */
export function campaignVisitStatus(
  campaignId: number,
): { running: boolean; startedAt: number; run: number; runs: number; pages: number; lastEventAt: number | null } | null {
  const v = visits.get(campaignId);
  if (!v) return null;
  // Pages of the run going on now (or the last one).
  const from = v.events.findLastIndex((e) => e.type === "run");
  const pages = v.events.slice(from + 1).filter((e) => e.type === "page").length;
  return { running: v.running, startedAt: v.startedAt, run: v.run, runs: v.runs, pages, lastEventAt: v.events.at(-1)?.at ?? null };
}

/** Deleted campaign: stop its visit and forget its log. */
export function forgetCampaignVisit(campaignId: number): void {
  stopCampaignVisit(campaignId);
  visits.delete(campaignId);
}

async function run(c: Pick<Campaign, "id" | "siteUrl">, v: LiveVisit) {
  const { signal } = v.controller;
  const send = (e: VisitEvent) => {
    const line = { ...e, at: Date.now() } as LoggedVisitEvent;
    v.events.push(line);
    for (const f of v.listeners) f(line);
  };
  try {
    const proxyApiUrl = await resolveProxyApi(undefined);
    if (!proxyApiUrl) throw new Error("No proxy API link is saved. Add it in Settings.");
    // Loaded only here: the browser library isn't available on Vercel.
    const { runVisitTest } = await import("../visit-runner");
    // Visits already done today (before a restart, or a pause and resume) count toward the target.
    const done = await visitsDoneOn(c.id, todayInVietnam()).catch((err: unknown) => {
      console.error(`Campaign ${c.id}: couldn't read today's visits:`, err);
      return 0;
    });
    if (done >= v.runs) {
      v.run = v.runs;
      send({ type: "step", message: `All ${v.runs} of today's visits are done.` });
      return;
    }
    if (done > 0) send({ type: "step", message: `${done} of today's ${v.runs} visits are already done; running the other ${v.runs - done}.` });
    // Each run starts only when the one before has finished.
    for (v.run = done + 1; v.run <= v.runs && !signal.aborted; v.run++) {
      if (v.runs > 1) send({ type: "run", n: v.run, of: v.runs });
      for (;;) {
        try {
          const report = await runVisitTest({ url: c.siteUrl, proxyApiUrl, mobile: true, freshProxy: true, signal, send });
          // Counted when finished (not stopped), for the visits done per day; before "done", so a page
          // that reloads its numbers on "done" already sees it.
          if (!signal.aborted) await addVisitDone(c.id, todayInVietnam()).catch((err: unknown) => console.error(`Campaign ${c.id}: couldn't count the visit:`, err));
          send({ type: "done", report });
          if (signal.aborted) send({ type: "step", message: "Stopped." });
          if (!signal.aborted && v.runs > 1) send({ type: "step", message: v.run < v.runs ? `Run ${v.run} of ${v.runs} finished.` : `All ${v.runs} runs finished.` });
          break;
        } catch (err) {
          // Campaigns always use a new IP; the provider only gives one after a wait: wait, then try again.
          if (!(err instanceof ProxyWaitError) || signal.aborted) throw err;
          send({ type: "wait", seconds: err.waitSec });
          send({ type: "step", message: `Waiting for a new proxy IP (the provider gives one in ${err.waitSec}s); the previous IP isn't reused…` });
          await sleep(err.waitSec * 1000, signal);
        }
      }
    }
    v.run = Math.min(v.run, v.runs);
  } catch (err) {
    if (signal.aborted) send({ type: "step", message: "Stopped." });
    else send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    v.running = false;
    for (const f of v.listeners) f(null);
    v.listeners.clear();
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("Stopped."))), { once: true });
  });
}

/**
 * The campaign's console as newline-delimited JSON: every line so far, then new lines live until
 * the visit ends. Nothing if there's been no visit since the app started.
 */
export function campaignVisitStream(campaignId: number, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const write = (e: LoggedVisitEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          /* page went away */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const v = visits.get(campaignId);
      if (!v) return close();
      v.events.forEach(write);
      if (!v.running) return close();
      const follow = (e: LoggedVisitEvent | null) => (e ? write(e) : close());
      v.listeners.add(follow);
      signal.addEventListener("abort", () => (v.listeners.delete(follow), close()), { once: true });
    },
  });
}
