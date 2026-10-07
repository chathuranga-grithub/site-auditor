// Server-only, local only: each campaign's visit to its site through the proxy (the visit run,
// src/lib/visit-runner.ts). It runs on the server, not in a browser tab: it starts when a campaign is
// created or resumed, runs again once a day (src/lib/campaigns/scheduler.ts), and stops when it's
// paused, stopped or deleted. Every line of its console is kept in memory only (never saved), so
// any open campaign page can replay it and then follow it live. Restarting the app clears it.

import { ProxyWaitError } from "../proxy-api";
import { resolveProxyApi } from "../proxy-settings";
import type { VisitEvent } from "../visit-types";
import type { Campaign } from "./types";

/** One console line: the event and when it happened (ms). */
export type LoggedVisitEvent = VisitEvent & { at: number };

interface LiveVisit {
  startedAt: number;
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

/** Starts the campaign's visit (a running one is stopped first). */
export function startCampaignVisit(c: Pick<Campaign, "id" | "siteUrl">): void {
  if (!canRunVisits()) return;
  stopCampaignVisit(c.id);
  const v: LiveVisit = { startedAt: Date.now(), events: [], running: true, controller: new AbortController(), listeners: new Set() };
  visits.set(c.id, v);
  void run(c, v);
}

export function stopCampaignVisit(campaignId: number): void {
  visits.get(campaignId)?.controller.abort();
}

/** The campaign's visit right now, for the page's heartbeat; null if none since the app started. */
export function campaignVisitStatus(campaignId: number): { running: boolean; startedAt: number; pages: number; lastEventAt: number | null } | null {
  const v = visits.get(campaignId);
  if (!v) return null;
  const pages = v.events.filter((e) => e.type === "page").length;
  return { running: v.running, startedAt: v.startedAt, pages, lastEventAt: v.events.at(-1)?.at ?? null };
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
    for (;;) {
      try {
        send({ type: "done", report: await runVisitTest({ url: c.siteUrl, proxyApiUrl, mobile: true, freshProxy: true, signal, send }) });
        if (signal.aborted) send({ type: "step", message: "Stopped." });
        break;
      } catch (err) {
        // Campaigns always use a new IP; the provider only gives one after a wait: wait, then try again.
        if (!(err instanceof ProxyWaitError) || signal.aborted) throw err;
        send({ type: "wait", seconds: err.waitSec });
        send({ type: "step", message: `Waiting for a new proxy IP (the provider gives one in ${err.waitSec}s); the previous IP isn't reused…` });
        await sleep(err.waitSec * 1000, signal);
      }
    }
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
