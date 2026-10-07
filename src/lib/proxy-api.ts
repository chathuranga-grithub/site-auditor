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

// The last proxy handed out, reused while it's still valid (proxyTimeout) when the provider
// says "wait N seconds" for a new one. In memory only; this runs on one local computer.
let lastProxy: { config: ProxyConfig; apiUrl: string; expiresAt: number } | null = null;

/** A fresh proxy if the provider gives one; otherwise the last one if still valid. */
export async function getProxyOrReuse(apiUrl: string): Promise<ProxyConfig & { reused: boolean }> {
  try {
    const config = await getProxy(apiUrl);
    return { ...config, reused: false };
  } catch (err) {
    if (err instanceof ProxyWaitError && lastProxy && lastProxy.apiUrl === apiUrl && Date.now() < lastProxy.expiresAt) {
      return { ...lastProxy.config, reused: true };
    }
    throw err;
  }
}

/**
 * A proxy for server-side API calls (Search Console, GA4): the one in use now while it's valid, so
 * these calls don't use up a new IP that a visit is waiting for; otherwise a new one.
 */
export async function proxyForApis(apiUrl: string): Promise<ProxyConfig> {
  if (lastProxy && lastProxy.apiUrl === apiUrl && Date.now() < lastProxy.expiresAt) return lastProxy.config;
  return getProxyOrReuse(apiUrl);
}

export async function getProxy(apiUrl: string): Promise<ProxyConfig> {
  let url: URL;
  try {
    url = new URL(apiUrl.trim());
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
  lastProxy = { config, apiUrl, expiresAt: Date.now() + Math.max(0, timeout - 60) * 1000 };
  return config;
}
