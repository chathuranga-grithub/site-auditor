// Server-only, local only: the daily campaign check while the app runs on a computer. The Google
// position is read in a browser through the Vietnam proxy, which Vercel can't do, so the check runs
// here: from 08:00 Vietnam time, every active campaign not yet checked today is checked once.
// Started from src/instrumentation.ts. If the computer is off, it catches up when the app starts.
// A ranking check that fails (CAPTCHA, wrong proxy IP, …) is tried again later the same day.
// Each active campaign's site visit also runs again once a day, from 08:00, when the last one started
// on an earlier day. Visits live in memory, so a restart ends them: on start, each one runs again.
// The database not reachable never ends this: it's tried again until it is (src/lib/db-retry.ts).
// Several computers share the database: each campaign runs on one of them (src/lib/this-computer.ts),
// and each computer only runs its own. Every minute it also picks up what was changed from another
// computer: a campaign paused, resumed, stopped, deleted or moved; one no computer runs yet, it takes;
// one started for this computer from another one, it runs (and checks its ranking, as the computer that
// starts a campaign does). And it says it's on, so other computers can start campaigns on it; with
// Realtime updates on (Settings), also what its campaigns are doing, for pages elsewhere (live-snapshot.ts).

import { appVersion } from "../app-version";
import { isConnectionError, untilDbReachable } from "../db-retry";
import { runsCampaignsHere } from "../runner-lock";
import { thisComputer } from "../this-computer";
import { NOT_IN_TOP_10, collectCampaign, stopCampaignCheck } from "./collect";
import { NotConfiguredError, claimCampaign, listCampaigns, listDays, reportComputer } from "./db";
import { liveSnapshot, realtimeUpdates } from "./live-snapshot";
import { todayInVietnam } from "./site";
import type { Campaign } from "./types";
import { campaignVisitStatus, forgetCampaignVisit, runningVisitIds, setVisitConcurrency, startCampaignVisit, stopCampaignVisit } from "./visits";

/** How often to look for campaigns that are due. */
const EVERY_MS = 15 * 60_000;
/** How often to pick up changes made from another computer. */
const SYNC_MS = 60_000;
/** Vietnam hour (0–23) from which the day's check runs. */
const FROM_HOUR = 8;
/** A failed ranking check is tried again this many times the same day, at least this far apart. */
const RANKING_RETRIES = 3;
const RETRY_AFTER_MS = 30 * 60_000;

// On globalThis, so a code reload in `next dev` doesn't start a second timer or lose the counts.
const g = globalThis as typeof globalThis & {
  __campaignScheduler?: ReturnType<typeof setInterval>;
  /** Per campaign: it should run here (active, on this computer), at the last sync. */
  __runnableHere?: Map<number, boolean>;
  /** Per campaign: the day, how many ranking checks failed that day, and when the last one did. */
  __rankingFailures?: Map<number, { day: string; count: number; at: number }>;
};
const failures = (g.__rankingFailures ??= new Map());
const runnableHere = (g.__runnableHere ??= new Map<number, boolean>());
/** Per campaign: what its visits use (site, keyword, plan, behavior), and its concurrency, at the last sync. */
const visitSettings = ((g as typeof g & { __visitSettings?: Map<number, string> }).__visitSettings ??= new Map<number, string>());
const visitConcurrency = ((g as typeof g & { __visitConcurrency?: Map<number, number> }).__visitConcurrency ??= new Map<number, number>());

/**
 * What a campaign's visits use: when it changes (an edit), the visit running here starts again with it.
 * Not its concurrency: that changes while the visit runs (setVisitConcurrency), nothing cut short.
 */
const settingsOf = (c: Campaign) => JSON.stringify([c.mode, c.siteUrl, c.keyword, c.pageUrl, c.day1Visits, c.dailyIncreasePct, c.minDwellSec, c.maxDwellSec, c.mobilePct]);

/**
 * The campaign was edited on this computer: if it runs here, its visit starts again with the new
 * settings now (today's visits done so far still count), not at the next minute check; its new
 * concurrency, the visit running takes as it is.
 */
export function campaignEdited(before: Campaign, after: Campaign, here: boolean): void {
  visitSettings.set(after.id, settingsOf(after));
  visitConcurrency.set(after.id, after.concurrency);
  if (!here || after.status !== "active") return;
  runnableHere.set(after.id, true);
  // Given days again after it finished, or its visits' settings changed.
  if (before.status !== "active" || settingsOf(before) !== settingsOf(after)) startCampaignVisit(after);
  else if (before.concurrency !== after.concurrency) setVisitConcurrency(after.id, after.concurrency);
}

/** Whether this copy of the app ran this computer's campaigns at the last minute check. */
let runnerHeld = false;

/** This copy doesn't run the campaigns any more (another copy took over): everything it ran ends. */
function stopEverythingHere(): void {
  for (const id of runningVisitIds()) {
    stopCampaignVisit(id);
    stopCampaignCheck(id);
  }
  runnableHere.clear();
}

export function startDailyChecks(): void {
  if (process.env.VERCEL || g.__campaignScheduler) return;
  g.__campaignScheduler = setInterval(() => void runDue(), EVERY_MS);
  // First look shortly after start, once the server is ready.
  setTimeout(() => void runDue(), 60_000);
  // Soon after start: this computer's active campaigns run again (visits live in memory); then every minute.
  setTimeout(() => void syncHere(true).finally(() => setInterval(() => void syncHere(), SYNC_MS)), 5_000);
}

let syncing = false;

/**
 * Runs what should run on this computer, and stops what shouldn't (any more). `first`: just after the
 * app started; the database not reachable yet (the computer just woke up, no internet…), it keeps
 * trying, so visits never stay stopped after a restart.
 * Only in the copy of the app that runs this computer's campaigns (src/lib/runner-lock.ts): another
 * copy runs nothing, and takes over here (as if just started) once that one has quit.
 */
async function syncHere(first = false): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const held = runnerHeld;
    runnerHeld = runsCampaignsHere(true);
    if (!runnerHeld) {
      // Another copy runs them (or took over from this one): nothing runs here.
      if (held) stopEverythingHere();
      return;
    }
    if (!held && !first) first = true;
    const me = await thisComputer();
    if (!me) return;
    const campaigns = first
      ? await untilDbReachable(listCampaigns, { onWait: () => console.warn("Resuming campaign visits: can't reach the database; trying again in 30s…") })
      : await listCampaigns();
    // Saying it's on can wait for the next minute: it never holds up the campaigns.
    // With Realtime updates on: what its campaigns are doing too, in the same write (pages elsewhere show it).
    const live = (await realtimeUpdates()) ? liveSnapshot(campaigns.filter((c) => c.computerId === me.id).map((c) => c.id)) : null;
    await reportComputer(me, (await appVersion()).version, live).catch((err: unknown) => console.warn("Couldn't say this computer is on:", err));
    const today = todayInVietnam();
    for (let c of campaigns) {
      // No computer runs it yet (made before computers were told apart, or on Vercel): this one takes it.
      if (!c.computerId && (c.status === "active" || c.status === "paused")) c = (await claimCampaign(c.id, me)) ?? c;
      const runnable = c.status === "active" && c.computerId === me.id;
      const was = runnableHere.get(c.id);
      runnableHere.set(c.id, runnable);
      const settings = settingsOf(c);
      const edited = visitSettings.has(c.id) && visitSettings.get(c.id) !== settings;
      visitSettings.set(c.id, settings);
      const concurrencyBefore = visitConcurrency.get(c.id);
      visitConcurrency.set(c.id, c.concurrency);
      const v = campaignVisitStatus(c.id);
      if (!runnable) {
        // Paused, stopped or moved to another computer (maybe from another computer): end what runs here.
        if (was) {
          stopCampaignVisit(c.id);
          stopCampaignCheck(c.id);
        }
        continue;
      }
      // No visit since the app started, or resumed (or moved here) from another computer, or edited
      // from another computer (it starts again with the new settings; today's visits done still count).
      if (!v || (was === false && !v.running) || edited) startCampaignVisit(c);
      // Its concurrency changed from another computer: the visit running here takes it as it is.
      else if (concurrencyBefore !== undefined && concurrencyBefore !== c.concurrency) setVisitConcurrency(c.id, c.concurrency);
      // New since the last minute, with no visit here before: started for this computer from another
      // one. Its first ranking check, right away (one started here had it when it was made).
      if (!first && was === undefined && !v && c.startDate === today) {
        void collectCampaign(c, today).catch((err: unknown) => console.error(`Campaign ${c.id}: first check failed:`, err));
      }
    }
    // Deleted (maybe from another computer): its visit ends.
    const ids = new Set(campaigns.map((c) => c.id));
    for (const id of runningVisitIds()) {
      if (!ids.has(id)) {
        forgetCampaignVisit(id);
        stopCampaignCheck(id);
      }
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) console.error("Campaigns on this computer:", err);
  } finally {
    syncing = false;
  }
}

let busy = false;

async function runDue(): Promise<void> {
  if (busy) return;
  const vnHour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
  if (vnHour < FROM_HOUR) return;
  busy = true;
  try {
    const today = todayInVietnam();
    // Only the campaigns this computer runs.
    // Only the copy of the app that runs this computer's campaigns.
    if (!runsCampaignsHere()) return;
    const me = await thisComputer();
    const active = (await listCampaigns()).filter((x) => x.status === "active" && !!me && x.computerId === me.id);
    // Today's visit: started first, as it runs on its own while the checks below take their time.
    for (const c of active) {
      const v = campaignVisitStatus(c.id);
      if (v && !v.running && todayInVietnam(new Date(v.startedAt)) < today) startCampaignVisit(c);
    }
    for (const c of active) {
      // Already checked today: a position, or "not in the top 10" (a result too).
      const day = (await listDays(c.id)).find((d) => d.day === today);
      const note = day?.notes.serp;
      if (day && (day.position != null || note === "" || note === NOT_IN_TOP_10)) continue;
      // Failed earlier today (any other note): try again, a few times, some time apart. A failure
      // from before a restart counts as one, so the first try after it runs straight away.
      const failed = failures.get(c.id);
      const f = failed?.day === today ? failed : note !== undefined ? { day: today, count: 1, at: 0 } : null;
      if (f && (f.count > RANKING_RETRIES || Date.now() - f.at < RETRY_AFTER_MS)) continue;
      const result = await collectCampaign(c, today).catch((err: unknown) => {
        console.error(`Daily check, campaign ${c.id}:`, err);
        return null;
      });
      if (!result || result.problems.some((p) => p.startsWith("Google position:"))) {
        failures.set(c.id, { day: today, count: (f?.count ?? 0) + 1, at: Date.now() });
      } else failures.delete(c.id);
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) console.error("Daily campaign checks:", err);
    // Couldn't reach the database: try again in a minute, not at the next 15-minute look.
    if (isConnectionError(err)) setTimeout(() => void runDue(), 60_000);
  } finally {
    busy = false;
  }
}
