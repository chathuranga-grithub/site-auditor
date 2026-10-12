// Server-only, local only: only one copy of the app on a computer runs campaigns. The desktop app and
// `npm run dev` (or two of either) read the same local settings, so they're the same computer: both
// running its campaigns would do each visit twice. The first copy to start holds the lock (a file next
// to the local settings, with its process id); any other copy shows the pages but runs nothing, and
// takes over once the first one has quit (checked every minute, from the scheduler). The copy that
// runs them also checks every minute that the lock is still its own, so two never keep running.

import fs from "node:fs";
import path from "node:path";

interface Holder {
  pid: number;
  /** What it is: the desktop app (its version), or npm run dev. */
  app: string;
  since: string;
  /** Last said it's still running (every minute). */
  at: string;
}

/** Not said it's still running for this long (it was asleep, or its id went to another program): taken over. */
const STALE_MS = 30 * 60_000;

const file = () => path.join(process.env.LOCALAPPDATA ?? process.cwd(), "SiteAuditor", "runner.lock");

// On globalThis: every route and the scheduler share it (and a code reload in `next dev` keeps it).
const g = globalThis as typeof globalThis & { __runnerLock?: { held: boolean; tried: boolean; releasing?: boolean } };
const state = (g.__runnerLock ??= { held: false, tried: false });

function read(): Holder | null {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Holder;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it runs, as someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function me(): Holder {
  const now = new Date().toISOString();
  return { pid: process.pid, app: process.env.APP_VERSION ? `desktop app ${process.env.APP_VERSION}` : "npm run dev", since: now, at: now };
}

/**
 * Whether this copy runs the campaigns. Takes the lock if no other running copy holds it. `refresh`:
 * the minute check, which also says this copy is still running, and takes over from one that quit.
 */
export function runsCampaignsHere(refresh = false): boolean {
  if (process.env.VERCEL) return false;
  if (state.tried && !refresh) return state.held;
  state.tried = true;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const h = read();
    if (h?.pid === process.pid) {
      fs.writeFileSync(file(), JSON.stringify({ ...h, at: new Date().toISOString() }));
      return (state.held = true);
    }
    if (state.held && h) {
      // Another copy took over (this one was asleep for long): it runs them now.
      console.warn(`Another copy of the app (${h.app}, process ${h.pid}) runs the campaigns on this computer now; this one stops.`);
      return (state.held = false);
    }
    if (h && alive(h.pid) && Date.now() - Date.parse(h.at) < STALE_MS) return (state.held = false);
    // Free (none, or the copy that held it quit): taken. Two copies doing this at once: the last write
    // wins, and the other sees it at once below.
    fs.writeFileSync(file(), JSON.stringify(me()));
    state.held = read()?.pid === process.pid;
    if (state.held && !state.releasing) {
      state.releasing = true;
      process.once("exit", release);
    }
    return state.held;
  } catch (err) {
    // The lock can't be read or written (no LOCALAPPDATA…): as before, this copy runs them.
    console.warn("Runner lock:", err);
    return (state.held = true);
  }
}

/** The other copy of the app on this computer that runs the campaigns; null if it's this one (or none). */
export function campaignRunner(): { app: string; pid: number; since: string } | null {
  if (runsCampaignsHere()) return null;
  const h = read();
  return h ? { app: h.app, pid: h.pid, since: h.since } : null;
}

/** On quitting: the lock is let go, so another copy can take over straight away. */
function release(): void {
  try {
    if (read()?.pid === process.pid) fs.unlinkSync(file());
  } catch {
    /* gone already */
  }
}
