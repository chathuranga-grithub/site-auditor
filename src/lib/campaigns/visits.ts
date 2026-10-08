// Server-only, local only: each campaign's visit to its site through the proxy (the visit run,
// src/lib/visit-runner.ts). It runs on the server, not in a browser tab: it starts when a campaign is
// created or resumed, runs again once a day (src/lib/campaigns/scheduler.ts), and stops when it's
// paused, stopped or deleted. Each time it's the day's target visits from the campaign's visit plan
// (day 1 visits, grown by the daily increase), each with a new proxy IP; each first searches Google for
// the keyword in the same browser, as Keyword Rankings does (never clicking a result), then opens the site.
// The campaign's concurrency is how many run at the same time: that many lanes, each taking a random
// free proxy API link from Settings (src/lib/proxy-pool.ts), so no two visits share a link or an IP.
// Every line of its console is kept in memory only (never saved), tagged with its lane, so any open
// campaign page can replay it and then follow it live. Restarting the app clears it.

import { ProxyWaitError } from "../proxy-api";
import { ProxyIpInUseError, claimProxyIp, leaseProxyApi, restProxyApi } from "../proxy-pool";
import type { VisitEvent } from "../visit-types";
import { addVisitDone, visitsDoneOn } from "./db";
import { todayInVietnam } from "./site";
import { daysBetween } from "./metrics";
import { plannedVisits, type Campaign } from "./types";

/** One console line: the event, when it happened (ms), and its lane (1..concurrency); no lane = the whole visit. */
export type LoggedVisitEvent = VisitEvent & { at: number; lane?: number };

/** A link that gave an IP another visit is using rests this long before it's tried again. */
const SAME_IP_REST_SEC = 60;

interface LiveVisit {
  startedAt: number;
  /** The day's target visits, the runs started so far, and the lanes running them side by side. */
  runs: number;
  run: number;
  lanes: number;
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

type VisitCampaign = Pick<
  Campaign,
  "id" | "siteUrl" | "keyword" | "country" | "concurrency" | "startDate" | "endDate" | "durationDays" | "day1Visits" | "dailyIncreasePct"
>;

/** The campaign's target visits for today (Vietnam date), from its visit plan. */
export function targetVisitsToday(c: VisitCampaign): number {
  const day = Math.min(Math.max(1, daysBetween(c.startDate, todayInVietnam()) + 1), c.durationDays);
  return plannedVisits(c.day1Visits, c.dailyIncreasePct, day);
}

/** Starts the campaign's visit: today's target visits, `concurrency` at a time (a running visit is stopped first). */
export function startCampaignVisit(c: VisitCampaign): void {
  if (!canRunVisits()) return;
  stopCampaignVisit(c.id);
  // After its last day (the end date): no more visits; the daily check marks it finished.
  if (todayInVietnam() > c.endDate) return;
  const runs = targetVisitsToday(c);
  const v: LiveVisit = { startedAt: Date.now(), runs, run: 0, lanes: 0, events: [], running: true, controller: new AbortController(), listeners: new Set() };
  visits.set(c.id, v);
  void run(c, v);
}

export function stopCampaignVisit(campaignId: number): void {
  visits.get(campaignId)?.controller.abort();
}

/** The campaign's visit right now, for the page's heartbeat; null if none since the app started. */
export function campaignVisitStatus(
  campaignId: number,
): { running: boolean; startedAt: number; run: number; runs: number; lanes: number; pages: number; lastEventAt: number | null } | null {
  const v = visits.get(campaignId);
  if (!v) return null;
  // Pages of the runs going on now (or the last ones), in every lane.
  let pages = 0;
  for (let lane = 1; lane <= Math.max(1, v.lanes); lane++) {
    const mine = v.events.filter((e) => (e.lane ?? 1) === lane);
    pages += mine.slice(mine.findLastIndex((e) => e.type === "run") + 1).filter((e) => e.type === "page").length;
  }
  return { running: v.running, startedAt: v.startedAt, run: v.run, runs: v.runs, lanes: v.lanes, pages, lastEventAt: v.events.at(-1)?.at ?? null };
}

/** Deleted campaign: stop its visit and forget its log. */
export function forgetCampaignVisit(campaignId: number): void {
  stopCampaignVisit(campaignId);
  visits.delete(campaignId);
}

async function run(c: VisitCampaign, v: LiveVisit) {
  const { signal } = v.controller;
  const log = (e: VisitEvent, lane?: number) => {
    const line = { ...e, at: Date.now(), ...(lane ? { lane } : {}) } as LoggedVisitEvent;
    v.events.push(line);
    for (const f of v.listeners) f(line);
  };
  try {
    // Loaded only here: the browser library isn't available on Vercel.
    const { runVisitTest } = await import("../visit-runner");
    // Visits already done today (before a restart, or a pause and resume) count toward the target.
    const done = await visitsDoneOn(c.id, todayInVietnam()).catch((err: unknown) => {
      console.error(`Campaign ${c.id}: couldn't read today's visits:`, err);
      return 0;
    });
    if (done >= v.runs) {
      v.run = v.runs;
      log({ type: "step", message: `All ${v.runs} of today's visits are done.` });
      return;
    }
    if (done > 0) log({ type: "step", message: `${done} of today's ${v.runs} visits are already done; running the other ${v.runs - done}.` });
    v.run = done;
    v.lanes = Math.max(1, Math.min(c.concurrency, v.runs - done));
    if (v.lanes > 1) log({ type: "step", message: `Running ${v.lanes} visits at the same time, each through its own proxy link and IP.` });

    /** One visit run, through a free proxy link; takes another link while one makes it wait or repeats an IP. */
    const runOnce = async (runNo: number, send: (e: VisitEvent) => void) => {
      for (;;) {
        const lease = await leaseProxyApi(signal, (seconds) => {
          if (seconds === null) return send({ type: "step", message: "Every proxy link is in use by another visit; waiting for one to be free…" });
          send({ type: "wait", seconds });
          send({ type: "step", message: `Waiting for a new proxy IP (the provider gives one in ${seconds}s); the previous IP isn't reused…` });
        });
        try {
          if (v.runs > 1) send({ type: "run", n: runNo, of: v.runs, link: { number: lease.number, of: lease.of } });
          if (lease.of > 1) send({ type: "step", message: `Using proxy link #${lease.number} of ${lease.of}.` });
          const report = await runVisitTest({
            url: c.siteUrl,
            proxyApiUrl: lease.apiUrl,
            mobile: true,
            freshProxy: true,
            searchFirst: { keyword: c.keyword, country: c.country },
            claimIp: claimProxyIp,
            signal,
            send,
          });
          // Counted when finished (not stopped by hand, and not stopped by the run itself: wrong or
          // unconfirmed proxy IP, proxy died), for the visits done per day; before "done", so a page
          // that reloads its numbers on "done" already sees it.
          if (!signal.aborted && !report.stopReason) await addVisitDone(c.id, todayInVietnam()).catch((err: unknown) => console.error(`Campaign ${c.id}: couldn't count the visit:`, err));
          send({ type: "done", report });
          if (signal.aborted) send({ type: "step", message: "Stopped." });
          else if (v.runs > 1) send({ type: "step", message: `Run ${runNo} of ${v.runs} finished.` });
          return;
        } catch (err) {
          if (signal.aborted) throw err;
          // Campaigns always use a new IP; this link only gives one after a wait: rest it, take another.
          if (err instanceof ProxyWaitError) {
            restProxyApi(lease.apiUrl, err.waitSec);
            send({ type: "step", message: `Proxy link #${lease.number} gives a new IP only in ${err.waitSec}s; trying another link.` });
            continue;
          }
          // Two links on one IP: never two visits from the same IP at the same time.
          if (err instanceof ProxyIpInUseError) {
            restProxyApi(lease.apiUrl, SAME_IP_REST_SEC);
            send({ type: "step", message: `${err.message} Trying another proxy link.` });
            continue;
          }
          throw err;
        } finally {
          lease.release();
        }
      }
    };

    /** One lane: takes the next run until today's are all started; each starts when the lane's last one has finished. */
    const lane = async (n: number) => {
      const send = (e: VisitEvent) => log(e, n);
      try {
        while (!signal.aborted && v.run < v.runs) {
          // A visit still going after midnight on the last day stops: the campaign is over.
          if (todayInVietnam() > c.endDate) {
            send({ type: "step", message: "The campaign's last day is over, so no more visits." });
            return;
          }
          await runOnce(++v.run, send);
        }
      } catch (err) {
        // This lane stops; the others carry on.
        if (signal.aborted) send({ type: "step", message: "Stopped." });
        else send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    };

    await Promise.all(Array.from({ length: v.lanes }, (_, i) => lane(i + 1)));
    if (!signal.aborted && v.runs > 1) log({ type: "step", message: `All ${v.runs} runs finished.` });
  } catch (err) {
    if (signal.aborted) log({ type: "step", message: "Stopped." });
    else log({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    v.running = false;
    for (const f of v.listeners) f(null);
    v.listeners.clear();
  }
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
