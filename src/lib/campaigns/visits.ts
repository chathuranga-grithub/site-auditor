// Server-only, local only: each campaign's visit to its site through the proxy (the visit run,
// src/lib/visit-runner.ts). It runs on the server, not in a browser tab: it starts when a campaign is
// created or resumed, runs again once a day (src/lib/campaigns/scheduler.ts), and stops when it's
// paused, stopped or deleted. Each time it's the day's target visits from the campaign's visit plan
// (day 1 visits, grown by the daily increase), each with a new proxy IP; each first searches Google for
// the keyword in the same browser, as Keyword Rankings does (never clicking a result), then opens the site
// and stays on it for the dwell time: a random number of seconds between the campaign's min and max.
// The campaign's mobile traffic % decides how many of the day's visits are on a phone, the rest on a
// desktop, in a random order; each visit is on a random model (src/lib/device-profiles.ts): an Android
// phone or an iPhone, a Windows PC or a Mac. Pages are opened one at a time, each read for its own random time.
// The campaign's concurrency is how many run at the same time: that many lanes, each taking a random
// free proxy API link from Settings (src/lib/proxy-pool.ts), so no two visits share a link or an IP.
// With a Chrome profile folder set (Settings), each visit's browser gets its own one (src/lib/browser-profile.ts).
// Every line of its console is kept in memory only (never saved), tagged with its lane, so any open
// campaign page can replay it and then follow it live. Restarting the app clears it.

import { leaseChromeProfile } from "../browser-profile";
import { ProxyWaitError } from "../proxy-api";
import { ProxyIpInUseError, claimProxyIp, leaseProxyApi, restProxyApi } from "../proxy-pool";
import { GoogleBlockedError } from "../serp-browser";
import type { VisitDevice, VisitEvent } from "../visit-types";
import { isConnectionError, untilDbReachable } from "../db-retry";
import { deviceLabel, pickDevice } from "../device-profiles";
import { thisComputer } from "../this-computer";
import { addVisitDone, visitsDoneOn } from "./db";
import { todayInVietnam } from "./site";
import { daysBetween } from "./metrics";
import { mobileVisits, plannedVisits, type Campaign } from "./types";

/** One console line: the event, when it happened (ms), and its lane (1..concurrency); no lane = the whole visit. */
export type LoggedVisitEvent = VisitEvent & { at: number; lane?: number };

/** A link that gave an IP another visit is using rests this long before it's tried again. */
const SAME_IP_REST_SEC = 60;
/** How long a visit that failed waits before it's tried again (new browser, new IP). */
const RETRY_AFTER_SEC = 30;

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
  | "id"
  | "siteUrl"
  | "keyword"
  | "country"
  | "concurrency"
  | "startDate"
  | "endDate"
  | "durationDays"
  | "day1Visits"
  | "dailyIncreasePct"
  | "minDwellSec"
  | "maxDwellSec"
  | "mobilePct"
>;

/** The items in a random order. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Each visit's dwell time: a random whole number of seconds from the campaign's min to its max. */
const dwellTime = (c: VisitCampaign) => c.minDwellSec + Math.floor(Math.random() * (c.maxDwellSec - c.minDwellSec + 1));

/**
 * Counts a finished visit for today. The database not reachable: the visit still counts, in the
 * background, as soon as it is again (the lane carries on with its next visit meanwhile).
 */
async function countVisit(campaignId: number, phone: boolean, send: (e: VisitEvent) => void): Promise<void> {
  const day = todayInVietnam();
  const count = () => addVisitDone(campaignId, day, phone);
  try {
    await count();
  } catch (err) {
    console.error(`Campaign ${campaignId}: couldn't count the visit:`, err);
    if (!isConnectionError(err)) return;
    send({ type: "step", message: "Can't reach the database to count this visit; it's counted as soon as it's back." });
    void untilDbReachable(count).catch((e: unknown) => console.error(`Campaign ${campaignId}: couldn't count the visit:`, e));
  }
}

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

/** Campaigns with a visit running on this computer now. */
export function runningVisitIds(): number[] {
  return [...visits].filter(([, v]) => v.running).map(([id]) => id);
}

/** The campaign runs on this computer: its visits and ranking checks happen here (not on another one). */
export async function runsHere(c: Pick<Campaign, "computerId">): Promise<boolean> {
  const me = await thisComputer().catch(() => null);
  return !!me && c.computerId === me.id;
}

/** Why something can't be done from this computer, in plain words. */
export function notHere(c: Pick<Campaign, "computerName">): string {
  return c.computerName
    ? `This campaign runs on ${c.computerName}: do this there, or click "Run on this computer".`
    : `No computer runs this campaign yet: click "Run on this computer".`;
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
    // Also in the server log (.next/dev/logs), to see afterwards why a visit's browser closed.
    if (e.type === "step") console.log(`[visit ${c.id}${lane ? `/${lane}` : ""}] ${e.message}`);
  };
  try {
    // Loaded only here: the browser library isn't available on Vercel.
    const { runVisitTest } = await import("../visit-runner");
    // Visits already done today (before a restart, or a pause and resume) count toward the target.
    // The database not reachable: wait for it (guessing 0 would run today's visits again).
    let saidWaiting = false;
    const done = await untilDbReachable(() => visitsDoneOn(c.id, todayInVietnam()), {
      signal,
      onWait: () => {
        if (!saidWaiting) log({ type: "step", message: "Can't reach the database to read today's visits; trying again every 30s…" });
        saidWaiting = true;
      },
    }).catch((err: unknown) => {
      if (signal.aborted) throw err;
      console.error(`Campaign ${c.id}: couldn't read today's visits:`, err);
      return { total: 0, mobile: 0 };
    });
    // Today's phone visits from the mobile traffic %, less the ones done; the rest on a desktop. Shuffled,
    // so phone and desktop visits are mixed through the day. Each run keeps its device when it's tried again.
    const left = Math.max(0, v.runs - done.total);
    const phonesLeft = Math.min(left, Math.max(0, mobileVisits(v.runs, c.mobilePct) - done.mobile));
    const devices: VisitDevice[] = shuffle([...Array<VisitDevice>(phonesLeft).fill("phone"), ...Array<VisitDevice>(left - phonesLeft).fill("desktop")]);
    const deviceOf = (runNo: number) => devices[runNo - done.total - 1] ?? "desktop";
    if (done.total >= v.runs) {
      v.run = v.runs;
      log({ type: "step", message: `All ${v.runs} of today's visits are done.` });
      return;
    }
    if (done.total > 0) log({ type: "step", message: `${done.total} of today's ${v.runs} visits are already done; running the other ${left}.` });
    log({ type: "step", message: `Today: ${phonesLeft} visit${phonesLeft === 1 ? "" : "s"} on a phone and ${left - phonesLeft} on a desktop (${c.mobilePct}% mobile traffic).` });
    v.run = done.total;
    v.lanes = Math.max(1, Math.min(c.concurrency, left));
    if (v.lanes > 1) log({ type: "step", message: `Running ${v.lanes} visits at the same time, each through its own proxy link and IP.` });

    /** One visit run, through a free proxy link; takes another link while one makes it wait or repeats an IP. */
    const runOnce = async (runNo: number, send: (e: VisitEvent) => void) => {
      const device = deviceOf(runNo);
      // A run never gives up until the campaign is stopped: Google's CAPTCHA not solved in time, or
      // anything else going wrong, starts it again in a new browser with a new IP.
      let tries = 1;
      let retryAfter = false;
      for (;;) {
        let waited = false;
        const lease = await leaseProxyApi(signal, (seconds) => {
          waited = true;
          if (seconds === null) {
            send({ type: "wait", seconds: null, reason: "a free proxy link (the others are in use by other visits)" });
            return send({ type: "step", message: "Every proxy link is in use by another visit; waiting for one to be free…" });
          }
          send({ type: "wait", seconds, reason: "a new proxy IP from the provider" });
          send({ type: "step", message: `Waiting for a new proxy IP (the provider gives one in ${seconds}s); the previous IP isn't reused…` });
        });
        if (waited) send({ type: "waited" });
        // Its own Chrome profile folder, when one is set: never the same as another browser open now.
        const profile = await leaseChromeProfile("visit");
        try {
          // A new random model each time (a try again is a new browser too): Android or iPhone, Windows or Mac.
          const model = pickDevice(device);
          if (v.runs > 1) send({ type: "run", n: runNo, of: v.runs, link: { number: lease.number, of: lease.of }, device, deviceName: deviceLabel(model) });
          else send({ type: "step", message: `A visit on a ${deviceLabel(model)}.` });
          if (lease.of > 1) send({ type: "step", message: `Using proxy link #${lease.number} of ${lease.of}.` });
          const report = await runVisitTest({
            url: c.siteUrl,
            proxyApiUrl: lease.apiUrl,
            // The whole visit on a phone or on a desktop; no second check of every page on a phone.
            device,
            deviceProfile: model,
            mobile: false,
            freshProxy: true,
            // Searches Google and clicks the site's result (a CAPTCHA is waited for until it's solved);
            // not on the first page, or the search failing: the site is opened directly.
            searchFirst: { keyword: c.keyword, country: c.country },
            claimIp: claimProxyIp,
            profileDir: profile?.dir,
            dwellSec: dwellTime(c),
            readPages: true,
            signal,
            send,
          });
          // Counted when finished (not stopped by hand, and not stopped by the run itself: wrong or
          // unconfirmed proxy IP, proxy died), for the visits done per day; before "done", so a page
          // that reloads its numbers on "done" already sees it.
          if (!signal.aborted && !report.stopReason) {
            await countVisit(c.id, device === "phone", send);
            send({ type: "stage", stage: "done" });
          }
          send({ type: "done", report });
          if (signal.aborted) send({ type: "step", message: "Stopped." });
          else if (report.stopReason) {
            // Stopped by the run itself (wrong or unconfirmed proxy IP, proxy died): not a visit; again.
            send({ type: "step", message: `This visit didn't count; trying again in ${RETRY_AFTER_SEC}s in a new browser (a new proxy IP if the provider gives one, else its current one; try ${++tries})…` });
            retryAfter = true;
          } else if (v.runs > 1) send({ type: "step", message: `Run ${runNo} of ${v.runs} finished.` });
          if (!retryAfter) return;
        } catch (err) {
          if (signal.aborted) throw err;
          // The browser is already closed; its IP counts as used, so the next try gets a new one.
          if (err instanceof GoogleBlockedError) {
            send({ type: "step", message: `${err.message}: closed this browser; trying again with a new proxy IP and a new browser (try ${++tries})…` });
            continue;
          }
          // No new IP yet and the current one is out (Google kept blocking it): rest the link, take another.
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
          // Anything else (Chrome didn't start, the proxy failed…): the run doesn't give up, it waits a bit
          // and starts again in a new browser with a new IP. Shown as a step: the lane carries on.
          send({ type: "step", message: `This visit failed (${err instanceof Error ? err.message : String(err)}); trying again in ${RETRY_AFTER_SEC}s in a new browser (a new proxy IP if the provider gives one, else its current one; try ${++tries})…` });
          retryAfter = true;
        } finally {
          profile?.release();
          lease.release();
        }
        if (retryAfter) {
          retryAfter = false;
          send({ type: "wait", seconds: RETRY_AFTER_SEC, reason: "the next try (new browser)" });
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, RETRY_AFTER_SEC * 1000);
            signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
          });
          if (signal.aborted) throw new Error("Stopped.");
          send({ type: "waited" });
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
