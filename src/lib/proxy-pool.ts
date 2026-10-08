// Server-only, local only: shares the proxy API links saved in Settings between everything that
// runs at the same time (campaign visits, ranking checks). A link is held by one job at a time,
// because asking its API for a new IP changes the IP under whoever is using it. Free links are
// handed out at random. A link whose provider says "new IP in N seconds" rests until then. The
// proxy IPs in use are tracked too, so two visits running at the same time never share one IP.
// In memory, on globalThis so a code reload in `next dev` keeps it.

import { resolveProxyApis } from "./proxy-settings";

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
  /** Link → time (ms) its provider gives a new IP again. */
  restUntil: Map<string, number>;
  /** Proxy IPs in use by visits running now. */
  ips: Set<string>;
  /** Called when a link is released, so waiting jobs look again. */
  waiters: Set<() => void>;
}

const g = globalThis as typeof globalThis & { __proxyPool?: Pool };
const pool = (g.__proxyPool ??= { busy: new Set(), restUntil: new Map(), ips: new Set(), waiters: new Set() });

/** Longest single wait before the links are read again (Settings may have changed). */
const RECHECK_MS = 30_000;

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

/** The link's provider gives a new IP only after `seconds`: don't hand it out before then. */
export function restProxyApi(apiUrl: string, seconds: number): void {
  pool.restUntil.set(apiUrl, Date.now() + seconds * 1000);
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
