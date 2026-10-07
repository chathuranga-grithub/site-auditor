// Server-only, local only: the daily campaign check while the app runs on a computer. The Google
// position is read in a browser through the Vietnam proxy, which Vercel can't do, so the check runs
// here: from 08:00 Vietnam time, every active campaign not yet checked today is checked once.
// Started from src/instrumentation.ts. If the computer is off, it catches up when the app starts.
// Each active campaign's site visit also runs again once a day, from 08:00, when the last one started
// on an earlier day. Visits live in memory, so a restart ends them: on start, each one runs again.

import { collectCampaign } from "./collect";
import { NotConfiguredError, listCampaigns, listDays } from "./db";
import { todayInVietnam } from "./site";
import { campaignVisitStatus, startCampaignVisit } from "./visits";

/** How often to look for campaigns that are due. */
const EVERY_MS = 15 * 60_000;
/** Vietnam hour (0–23) from which the day's check runs. */
const FROM_HOUR = 8;

// On globalThis, so a code reload in `next dev` doesn't start a second timer.
const g = globalThis as typeof globalThis & { __campaignScheduler?: ReturnType<typeof setInterval> };

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
      // Already checked today (a position, or a note saying why there's none)?
      const days = await listDays(c.id);
      if (days.some((d) => d.day === today && (d.position != null || d.notes.serp !== undefined))) continue;
      await collectCampaign(c, today).catch((err: unknown) => console.error(`Daily check, campaign ${c.id}:`, err));
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) console.error("Daily campaign checks:", err);
  } finally {
    busy = false;
  }
}
