// Server-only, local only: the daily campaign check while the app runs on a computer. The Google
// position is read in a browser through the Vietnam proxy, which Vercel can't do, so the check runs
// here: from 08:00 Vietnam time, every active campaign not yet checked today is checked once.
// Started from src/instrumentation.ts. If the computer is off, it catches up when the app starts.

import { collectCampaign } from "./collect";
import { NotConfiguredError, listCampaigns, listDays } from "./db";
import { todayInVietnam } from "./site";

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
}

let busy = false;

async function runDue(): Promise<void> {
  if (busy) return;
  const vnHour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
  if (vnHour < FROM_HOUR) return;
  busy = true;
  try {
    const today = todayInVietnam();
    for (const c of (await listCampaigns()).filter((x) => x.status === "active")) {
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
