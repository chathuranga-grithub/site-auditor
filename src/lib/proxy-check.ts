// Server-only, local only: one Proxy Check. Gets the next proxy from the provider's API and tests
// it with two small requests to neutral test addresses (IP lookup, a 204 "ping"). No browser and
// no visit to our sites.

import { getProxy, ProxyWaitError } from "./proxy-api";
import type { NetworkType, ProxyCheckResult } from "./proxy-check-types";

const TIMEOUT = 20_000;
/** IP lookup services, tried in order; both return { ip, country (2-letter code) }. */
const LOOKUPS = ["https://ipinfo.io/json", "https://api.country.is/"];
/** Returns 204 with no body: measures the proxy's round trip. */
const PING_URL = "https://www.gstatic.com/generate_204";

export async function checkProxyOnce(apiUrl: string): Promise<ProxyCheckResult> {
  const at = new Date().toISOString();
  let proxy;
  try {
    proxy = await getProxy(apiUrl);
  } catch (err) {
    if (err instanceof ProxyWaitError) return { at, kind: "wait", waitSec: err.waitSec };
    return { at, kind: "error", error: err instanceof Error ? err.message : String(err) };
  }

  const result: ProxyCheckResult = { at, kind: "ip", address: proxy.address, nextChangeSec: proxy.nextChangeSec, connected: false };
  // Loaded here, not at the top: the route must load on Vercel too (where it only says "local only").
  const { request } = await import("playwright-core");
  const ctx = await request.newContext({
    proxy: { server: proxy.server, username: proxy.username, password: proxy.password },
    timeout: TIMEOUT,
    extraHTTPHeaders: { accept: "application/json" },
  });
  try {
    for (const url of LOOKUPS) {
      try {
        const t0 = Date.now();
        const res = await ctx.get(url);
        const j = (await res.json()) as Record<string, string>;
        if (!j?.ip) continue;
        result.lookupMs = Date.now() - t0;
        result.ip = j.ip;
        result.countryCode = j.country ?? null;
        result.country = j.country ? (new Intl.DisplayNames(["en"], { type: "region" }).of(j.country) ?? j.country) : null;
        result.city = j.city ?? null;
        result.org = j.org ?? null;
        break;
      } catch {
        /* try the next lookup */
      }
    }
    try {
      const t0 = Date.now();
      const res = await ctx.get(PING_URL);
      if (res.status() < 400) result.pingMs = Date.now() - t0;
    } catch {
      result.pingMs = null;
    }
    result.connected = !!result.ip && result.pingMs != null;
    result.network = networkType(result.org ?? null);
    if (!result.ip) result.error = "The proxy didn't carry the IP lookup (refused, timed out or blocked).";
    else if (result.pingMs == null) result.error = "The proxy didn't carry the speed test request.";
  } finally {
    await ctx.dispose().catch(() => {});
  }
  return result;
}

/** Guess from the ISP name: hosting / cloud networks are datacenter, home and mobile ISPs residential. */
export function networkType(org: string | null): NetworkType {
  if (!org) return "unknown";
  if (/\bidc\b|hosting|host|cloud|data ?cent|server|colo|amazon|aws|google|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|contabo|alibaba|tencent|leaseweb|m247|datacamp|cdn/i.test(org)) return "datacenter";
  if (/viettel|vnpt|fpt|mobifone|vinaphone|vietnamobile|cmc|sctv|netnam|hanoi telecom|saigon postel|spt|gtel|telecom|mobile|broadband|cable/i.test(org)) return "residential";
  return "unknown";
}
