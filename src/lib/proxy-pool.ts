// Server-only, local only: shares the proxy API links saved in Settings between everything that
// runs at the same time. Campaign visits take a link at once (pickProxyApi): get the proxy IP (new, or
// the current one while the provider makes us wait), then search, never waiting for a link. Ranking
// checks hold a link one job at a time (leaseProxyApi), each claimed in the database first
// (src/lib/proxy-leases.ts), so no two computers' checks use one at the same time. Free links are handed out at random. A link whose provider says "new IP
// in N seconds" rests until then, for every computer. The proxy IPs in use here are tracked too, so two
// visits running at the same time never share one IP. With no database, links are shared here only.
// In memory, on globalThis so a code reload in `next dev` keeps it.

import { claimLink, linkKey, releaseLink, restLink } from "./proxy-leases";
import { resolveProxyApis } from "./proxy-settings";
import { thisComputer } from "./this-computer";

/** Two links gave the same IP: this one is already used by another visit running now. */
export class ProxyIpInUseError extends Error {
  constructor(readonly ip: string) {
    super(`The proxy IP ${ip} is already used by another visit running now.`);
  }
}

export interface ProxyLease {
  apiUrl: string;
  /** The link's number in Settings (1-based), safe to show. */
  number: number;
  /** Total links saved. */
  of: number;
  release(): void;
}

interface Pool {
  busy: Set<string>;
  /** Campaign visits using each link now (pickProxyApi: links aren't reserved for them). */
  using?: Map<string, number>;
  /** Link → time (ms) its provider gives a new IP again. */
  restUntil: Map<string, number>;
  /** Proxy IPs in use by visits running now. */
  ips: Set<string>;
  /** Called when a link is released, so waiting jobs look again. */
  waiters: Set<() => void>;
}

const g = globalThis as typeof globalThis & { __proxyPool?: Pool };
const pool: Pool = (g.__proxyPool ??= { busy: new Set(), restUntil: new Map(), ips: new Set(), waiters: new Set() });

/** Longest single wait before the links are read again (Settings may have changed, another computer let one go). */
const RECHECK_MS = 15_000;

/**
 * A free proxy API link, picked at random; waits until one is free. `onWait` is told why it waits:
 * every link busy (seconds null), or the free ones resting until their provider gives a new IP.
 */
export async function leaseProxyApi(signal: AbortSignal, onWait?: (seconds: number | null) => void): Promise<ProxyLease> {
  let told: "busy" | "rest" | null = null;
  for (;;) {
    if (signal.aborted) throw new Error("Stopped.");
    const links = await resolveProxyApis();
    if (!links.length) throw new Error("No proxy API link is saved. Add it in Settings.");

    // Claimed in the database: free on every computer.
    const byKey = new Map(links.map((l) => [linkKey(l), l]));
    const me = await thisComputer().catch(() => null);
    const claim = await claimLink([...byKey.keys()], me?.id ?? null);
    if (claim && "key" in claim) {
      const apiUrl = byKey.get(claim.key)!;
      pool.busy.add(apiUrl);
      let released = false;
      return {
        apiUrl,
        number: links.indexOf(apiUrl) + 1,
        of: links.length,
        release() {
          if (released) return;
          released = true;
          pool.busy.delete(apiUrl);
          void releaseLink(claim.key, claim.holder)
            .catch((err: unknown) => console.warn("Couldn't let a proxy link go (it's free again within minutes):", err))
            .finally(() => {
              for (const wake of [...pool.waiters]) wake();
            });
        },
      };
    }
    if (claim) {
      // None free on any computer: all held, or the free ones resting.
      const why = claim.restSec == null ? "busy" : "rest";
      if (why !== told) onWait?.(claim.restSec == null ? null : claim.restSec);
      told = why;
      await nextChance(Math.min(claim.restSec == null ? RECHECK_MS : claim.restSec * 1000, RECHECK_MS), signal);
      continue;
    }

    // No database: shared on this computer only.
    const now = Date.now();
    const notBusy = links.filter((l) => !pool.busy.has(l));
    const free = notBusy.filter((l) => (pool.restUntil.get(l) ?? 0) <= now);
    if (free.length) {
      const apiUrl = free[Math.floor(Math.random() * free.length)];
      pool.busy.add(apiUrl);
      let released = false;
      return {
        apiUrl,
        number: links.indexOf(apiUrl) + 1,
        of: links.length,
        release() {
          if (released) return;
          released = true;
          pool.busy.delete(apiUrl);
          for (const wake of [...pool.waiters]) wake();
        },
      };
    }
    const restMs = notBusy.length ? Math.min(...notBusy.map((l) => pool.restUntil.get(l)!)) - now : null;
    // Said once per reason, not on every look.
    const why = restMs === null ? "busy" : "rest";
    if (why !== told) onWait?.(restMs === null ? null : Math.ceil(restMs / 1000));
    told = why;
    await nextChance(Math.min(restMs ?? RECHECK_MS, RECHECK_MS), signal);
  }
}

/**
 * A proxy link for a campaign visit, at once: never reserved, so a visit never waits for another to
 * finish with one. The visit gets its IP from it straight away (a new one, or while the provider makes
 * us wait, the current one: getUnvisitedProxy), several visits using the same link or IP at once.
 * The link used by the fewest visits now (ties at random). Only when every link rests (no new IP, and
 * its current one blocked by Google) does it wait, until the first one can give an IP (onWait: seconds).
 */
export async function pickProxyApi(signal: AbortSignal, onWait?: (seconds: number) => void): Promise<ProxyLease> {
  const using = (pool.using ??= new Map());
  let told = false;
  for (;;) {
    if (signal.aborted) throw new Error("Stopped.");
    const links = await resolveProxyApis();
    if (!links.length) throw new Error("No proxy API link is saved. Add it in Settings.");
    const now = Date.now();
    const usable = links.filter((l) => (pool.restUntil.get(l) ?? 0) <= now);
    if (usable.length) {
      const fewest = Math.min(...usable.map((l) => using.get(l) ?? 0));
      const least = usable.filter((l) => (using.get(l) ?? 0) === fewest);
      const apiUrl = least[Math.floor(Math.random() * least.length)];
      using.set(apiUrl, (using.get(apiUrl) ?? 0) + 1);
      let released = false;
      return {
        apiUrl,
        number: links.indexOf(apiUrl) + 1,
        of: links.length,
        release() {
          if (released) return;
          released = true;
          using.set(apiUrl, Math.max(0, (using.get(apiUrl) ?? 1) - 1));
        },
      };
    }
    // Every link rests: until the first one can give an IP.
    const restMs = Math.min(...links.map((l) => pool.restUntil.get(l)!)) - now;
    if (!told) onWait?.(Math.ceil(restMs / 1000));
    told = true;
    await nextChance(Math.min(restMs, RECHECK_MS), signal);
  }
}

/** The link's provider gives a new IP only after `seconds`: don't hand it out before then. */
export function restProxyApi(apiUrl: string, seconds: number): void {
  pool.restUntil.set(apiUrl, Date.now() + seconds * 1000);
  void restLink(linkKey(apiUrl), seconds).catch((err: unknown) => console.warn("Couldn't share a proxy link's rest:", err));
}

/** Claims a proxy IP for a visit; null if another visit running now already has it. Returns the release. */
export function claimProxyIp(ip: string): (() => void) | null {
  if (pool.ips.has(ip)) return null;
  pool.ips.add(ip);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pool.ips.delete(ip);
  };
}

/** Resolves after `ms`, or sooner when a link is released; rejects when stopped. */
function nextChance(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(t);
      pool.waiters.delete(done);
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const stop = () => {
      clearTimeout(t);
      pool.waiters.delete(done);
      reject(new Error("Stopped."));
    };
    const t = setTimeout(done, Math.max(1000, ms));
    pool.waiters.add(done);
    signal.addEventListener("abort", stop, { once: true });
  });
}
