// Server-only: ask the proxy provider's API for a proxy. Built for responses like
// ShopLike's: { status: "success", data: { proxy: "ip:port", location, nextChange, auth: { account } } }.
// The API link (with its access token) comes from the form or PROXY_API_URL in .env.local.

import type { ProxyInfo } from "./visit-types";
import { isBlockedHost } from "./url";

export interface ProxyConfig extends ProxyInfo {
  server: string;
  username?: string;
  password?: string;
}

/** The provider only gives a new IP every few minutes; `waitSec` says how long until it will. */
export class ProxyWaitError extends Error {
  constructor(readonly waitSec: number) {
    super(`A new proxy IP is available in ${waitSec} seconds.`);
  }
}

// The last proxy handed out by each API link, reused while it's still valid (proxyTimeout) when the
// provider says "wait N seconds" for a new one. In memory only; this runs on one local computer.
// `visited`: a campaign visit has used that IP (it's never given to another visit).
// On globalThis: one copy for the whole server (`next dev` loads this file more than once, e.g. for
// ranking checks and for visits, and again on a code reload), so what one marks the other sees.
const shared = globalThis as typeof globalThis & {
  __proxyApi?: { lastProxy: Map<string, { config: ProxyConfig; expiresAt: number; visited: boolean }>; googleBlocked: Set<string>; visitsPerIp: Map<string, number> };
};
const state = (shared.__proxyApi ??= { lastProxy: new Map(), googleBlocked: new Set(), visitsPerIp: new Map() });
const lastProxy = state.lastProxy;

// Proxy addresses Google kept blocking (CAPTCHAs not solved): never reused as the link's current IP.
const googleBlocked = state.googleBlocked;

/** Google showed that IP a CAPTCHA (e.g. in a ranking check): never hand it to a visit. */
export function burnProxy(apiUrl: string, address: string): void {
  googleBlocked.add(address);
  const last = lastProxy.get(apiUrl);
  if (last && last.config.address === address) last.visited = true;
}

/** How many campaign visits may use one proxy IP (a new IP when the provider gives one, else the current one again). */
export const MAX_VISITS_PER_IP = 3;

// Campaign visits given each proxy address so far. In memory only, like lastProxy.
const visitsPerIp = state.visitsPerIp;

/** Counts a visit on that proxy address. */
function countVisitOn<T extends ProxyConfig>(config: T): T {
  visitsPerIp.set(config.address, (visitsPerIp.get(config.address) ?? 0) + 1);
  return config;
}

/**
 * A proxy IP for a campaign visit: the link's latest one if it's still valid and unused (e.g. a
 * ranking check just got it, which made the provider's "new IP in N seconds" start), else a new one
 * from the API. While the provider makes us wait for a new one, the link's current IP (ShopLike's
 * getCurrentProxy, same token) is used again (current: true), up to MAX_VISITS_PER_IP visits on it
 * and unless Google kept blocking it; otherwise ProxyWaitError (wait for the new one), as before.
 */
export async function getUnvisitedProxy(apiUrl: string): Promise<ProxyConfig & { fromEarlier: boolean; current: boolean; visitNo: number }> {
  const last = lastProxy.get(apiUrl);
  if (last && !last.visited && !googleBlocked.has(last.config.address) && Date.now() < last.expiresAt) {
    last.visited = true;
    const config = countVisitOn(last.config);
    return { ...config, fromEarlier: true, current: false, visitNo: visitsPerIp.get(config.address)! };
  }
  try {
    const config = countVisitOn(await getProxy(apiUrl));
    lastProxy.get(apiUrl)!.visited = true;
    return { ...config, fromEarlier: false, current: false, visitNo: visitsPerIp.get(config.address)! };
  } catch (err) {
    if (!(err instanceof ProxyWaitError)) throw err;
    const current = await getCurrentProxy(apiUrl).catch(() => null);
    if (!current || googleBlocked.has(current.address) || (visitsPerIp.get(current.address) ?? 0) >= MAX_VISITS_PER_IP) throw err;
    const latest = lastProxy.get(apiUrl);
    if (latest?.config.address === current.address) latest.visited = true;
    countVisitOn(current);
    return { ...current, fromEarlier: false, current: true, visitNo: visitsPerIp.get(current.address)! };
  }
}

/**
 * ShopLike's getCurrentProxy link for a proxy API link, with the same token: the link's getNewProxy
 * swapped for getCurrentProxy, or built from its access_token on ShopLike. Null for other providers.
 */
function currentProxyUrl(apiUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(apiUrl.trim());
  } catch {
    return null;
  }
  if (/getNewProxy/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/getNewProxy/i, "getCurrentProxy");
    return url.toString();
  }
  const token = url.searchParams.get("access_token");
  if (!/(^|\.)shoplike\.vn$/i.test(url.hostname) || !token) return null;
  return `https://${url.hostname}/Api/getCurrentProxy?access_token=${encodeURIComponent(token)}`;
}

/**
 * The link's current proxy (the one it gave last), asked from the provider (currentProxyUrl); else
 * the last one this app got, while it's still valid. Null when there's none.
 */
export async function getCurrentProxy(apiUrl: string): Promise<ProxyConfig | null> {
  const currentUrl = currentProxyUrl(apiUrl);
  if (currentUrl) {
    try {
      return await requestProxy(apiUrl, currentUrl);
    } catch {
      /* fall back to the last one below */
    }
  }
  const last = lastProxy.get(apiUrl);
  return last && Date.now() < last.expiresAt ? last.config : null;
}

/** A fresh proxy if the provider gives one; otherwise the last one if still valid. */
export async function getProxyOrReuse(apiUrl: string): Promise<ProxyConfig & { reused: boolean }> {
  try {
    const config = await getProxy(apiUrl);
    return { ...config, reused: false };
  } catch (err) {
    const last = lastProxy.get(apiUrl);
    if (err instanceof ProxyWaitError && last && Date.now() < last.expiresAt) return { ...last.config, reused: true };
    throw err;
  }
}

export function getProxy(apiUrl: string): Promise<ProxyConfig> {
  return requestProxy(apiUrl, apiUrl);
}

/** Asks `requestUrl` (the link, or its getCurrentProxy) for a proxy; remembered as the link's last one. */
async function requestProxy(apiUrl: string, requestUrl: string): Promise<ProxyConfig> {
  let url: URL;
  try {
    url = new URL(requestUrl.trim());
  } catch {
    throw new Error("The proxy API link isn't a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol) || isBlockedHost(url.hostname)) throw new Error("The proxy API link isn't allowed.");

  let body: Record<string, unknown>;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
    body = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Couldn't reach the proxy API (${err instanceof Error ? err.message : "no response"}).`);
  }

  const data = (body.data ?? {}) as Record<string, unknown>;
  const address = typeof data.proxy === "string" ? data.proxy.trim() : "";
  // e.g. {"status":"error","mess":"Con lai 177 giay de get proxy moi","nextChange":177}. Right at the end
  // of the wait it can say 0 seconds left: still a wait, so try again a few seconds later.
  if (body.status !== "success" && typeof body.nextChange === "number" && body.nextChange >= 0) {
    throw new ProxyWaitError(Math.max(5, Math.ceil(body.nextChange)));
  }
  if (body.status !== "success" || !/^[\w.-]+:\d{2,5}$/.test(address)) {
    // Providers put their reason in different fields ("mess", "message", "error").
    const reason = [body.mess, body.message, body.error, data.mess].find((v) => typeof v === "string" && v.trim());
    if (typeof reason === "string" && /het han|khong ton tai/i.test(reason)) {
      throw new Error(`The proxy API key doesn't exist or has expired ("${reason}"). Renew it with the provider, then save the new link in Settings.`);
    }
    throw new Error(`The proxy API didn't return a proxy${reason ? `: ${reason}` : "."}`);
  }

  // Login, if the provider uses one: auth.account = "user:pass", or auth.username / auth.password.
  const auth = (data.auth ?? {}) as Record<string, unknown>;
  let username: string | undefined;
  let password: string | undefined;
  if (typeof auth.account === "string" && auth.account.includes(":")) {
    [username, password] = auth.account.split(":", 2);
  } else if (typeof auth.username === "string" && auth.username) {
    username = auth.username;
    password = typeof auth.password === "string" ? auth.password : "";
  }

  const config: ProxyConfig = {
    address,
    server: `http://${address}`,
    username,
    password,
    usesLogin: !!username,
    location: typeof data.location === "string" ? data.location : null,
    nextChangeSec: typeof data.nextChange === "number" ? data.nextChange : null,
  };
  // proxyTimeout = seconds the proxy stays usable (1800 in ShopLike's responses); keep a small margin.
  const timeout = typeof data.proxyTimeout === "number" ? data.proxyTimeout : typeof body.proxyTimeout === "number" ? body.proxyTimeout : 600;
  // The same IP again (e.g. asked with getCurrentProxy): it keeps "a visit has used it".
  const before = lastProxy.get(apiUrl);
  const visited = before?.config.address === config.address && before.visited;
  lastProxy.set(apiUrl, { config, expiresAt: Date.now() + Math.max(0, timeout - 60) * 1000, visited });
  return config;
}
