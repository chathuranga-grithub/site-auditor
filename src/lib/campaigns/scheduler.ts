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
// computer: a campaign paused, resumed, stopped, deleted or moved; one no computer runs yet, it takes.

import { isConnectionError, untilDbReachable } from "../db-retry";
import { thisComputer } from "../this-computer";
import { NOT_IN_TOP_10, collectCampaign, stopCampaignCheck } from "./collect";
import { NotConfiguredError, claimCampaign, listCampaigns, listDays } from "./db";
import { todayInVietnam } from "./site";
import { campaignVisitStatus, forgetCampaignVisit, runningVisitIds, startCampaignVisit, stopCampaignVisit } from "./visits";

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
 */
async function syncHere(first = false): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const me = await thisComputer();
    if (!me) return;
    const campaigns = first
      ? await untilDbReachable(listCampaigns, { onWait: () => console.warn("Resuming campaign visits: can't reach the database; trying again in 30s…") })
      : await listCampaigns();
    for (let c of campaigns) {
      // No computer runs it yet (made before computers were told apart, or on Vercel): this one takes it.
      if (!c.computerId && (c.status === "active" || c.status === "paused")) c = (await claimCampaign(c.id, me)) ?? c;
      const runnable = c.status === "active" && c.computerId === me.id;
      const was = runnableHere.get(c.id);
      runnableHere.set(c.id, runnable);
      const v = campaignVisitStatus(c.id);
      if (!runnable) {
        // Paused, stopped or moved to another computer (maybe from another computer): end what runs here.
        if (was) {
          stopCampaignVisit(c.id);
          stopCampaignCheck(c.id);
        }
        continue;
      }
      // No visit since the app started, or resumed (or moved here) from another computer.
      if (!v || (was === false && !v.running)) startCampaignVisit(c);
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
