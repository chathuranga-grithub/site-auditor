// Server-only: where a proxied browser's requests really come from, and this computer's own IP to
// compare with. Used by the site visit (visit-runner.ts) and the Google ranking check
// (serp-browser.ts) before they open anything.

import { networkType } from "./network-type";
import type { ExitInfo } from "./visit-types";

/** IP lookup services, tried in order. Both return { ip, country (2-letter code) }. */
const IP_SERVICES = ["https://ipinfo.io/json", "https://api.country.is/"];

function toExitInfo(j: Record<string, string> | undefined, lookupMs: number): ExitInfo | null {
  if (!j?.ip) return null;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return {
    ip: j.ip,
    countryCode: j.country ?? null,
    country: j.country ? (names.of(j.country) ?? j.country) : null,
    city: j.city ?? null,
    org: j.org ?? null,
    network: networkType(j.org ?? null),
    lookupMs,
  };
}

/**
 * The IP and location a proxied browser's requests come from. `open` loads a URL in that browser
 * (through the proxy) and returns the JSON it shows. Null if no service answered.
 */
export async function lookupExit(open: (url: string) => Promise<unknown>): Promise<ExitInfo | null> {
  for (const service of IP_SERVICES) {
    try {
      const t0 = Date.now();
      const info = toExitInfo((await open(service)) as Record<string, string> | undefined, Date.now() - t0);
      if (info) return info;
    } catch {
      /* try the next service */
    }
  }
  return null;
}

/**
 * This computer's own public IP, asked directly (not through the proxy). Only the IP service sees
 * it, never the site or Google. Null if no service answered.
 */
export async function ownPublicIp(): Promise<string | null> {
  for (const service of IP_SERVICES) {
    try {
      const res = await fetch(service, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
      const ip = ((await res.json()) as { ip?: string }).ip;
      if (ip) return ip;
    } catch {
      /* try the next service */
    }
  }
  return null;
}
