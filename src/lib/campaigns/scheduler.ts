// Server-only, local only: the daily campaign check while the app runs on a computer. The Google
// position is read in a browser through the Vietnam proxy, which Vercel can't do, so the check runs
// here: from 08:00 Vietnam time, every active campaign not yet checked today is checked once.
// Started from src/instrumentation.ts. If the computer is off, it catches up when the app starts.
// A ranking check that fails (CAPTCHA, wrong proxy IP, …) is tried again later the same day.
// Each active campaign's site visit also runs again once a day, from 08:00, when the last one started
// on an earlier day. Visits live in memory, so a restart ends them: on start, each one runs again.

import { NOT_IN_TOP_10, collectCampaign } from "./collect";
import { NotConfiguredError, listCampaigns, listDays } from "./db";
import { todayInVietnam } from "./site";
import { campaignVisitStatus, startCampaignVisit } from "./visits";

/** How often to look for campaigns that are due. */
const EVERY_MS = 15 * 60_000;
/** Vietnam hour (0–23) from which the day's check runs. */
const FROM_HOUR = 8;
/** A failed ranking check is tried again this many times the same day, at least this far apart. */
const RANKING_RETRIES = 3;
const RETRY_AFTER_MS = 30 * 60_000;

// On globalThis, so a code reload in `next dev` doesn't start a second timer or lose the counts.
const g = globalThis as typeof globalThis & {
  __campaignScheduler?: ReturnType<typeof setInterval>;
  /** Per campaign: the day, how many ranking checks failed that day, and when the last one did. */
  __rankingFailures?: Map<number, { day: string; count: number; at: number }>;
};
const failures = (g.__rankingFailures ??= new Map());

export function startDailyChecks(): void {
  if (process.env.VERCEL || g.__campaignScheduler) return;
  g.__campaignScheduler = setInterval(() => void runDue(), EVERY_MS);
  // First look shortly after start, once the server is ready.
  setTimeout(() => void runDue(), 60_000);
  setTimeout(() => void resumeVisits(), 5_000);
}

/** Active campaigns whose visit isn't in memory (the app restarted): run it again. */
async function resumeVisits(): Promise<void> {
  try {
    for (const c of (await listCampaigns()).filter((x) => x.status === "active")) {
      if (!campaignVisitStatus(c.id)) startCampaignVisit(c);
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) console.error("Resuming campaign visits:", err);
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
    const active = (await listCampaigns()).filter((x) => x.status === "active");
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
  } finally {
    busy = false;
  }
}
