// Server-only: requests from this app's server code that must come from the proxy IP, never from
// this computer's or a server's own IP (Search Console and GA4). There's no fallback: without a
// working proxy the request fails.

import { ProxyAgent, fetch as undiciFetch, type RequestInit } from "undici";
import { proxyForApis } from "./proxy-api";
import { resolveProxyApi } from "./proxy-settings";

/** One agent per proxy (address and login), reused while that proxy is the current one. */
let agent: { key: string; dispatcher: ProxyAgent } | null = null;

async function proxyAgent(): Promise<ProxyAgent> {
  const apiUrl = await resolveProxyApi(undefined);
  if (!apiUrl) throw new Error("No proxy API link is saved (Settings), and these calls only go through the proxy.");
  const proxy = await proxyForApis(apiUrl);
  const key = `${proxy.server}|${proxy.username ?? ""}`;
  if (agent?.key !== key) {
    void agent?.dispatcher.close().catch(() => {});
    const token = proxy.username ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}` : undefined;
    agent = { key, dispatcher: new ProxyAgent({ uri: proxy.server, token }) };
  }
  return agent.dispatcher;
}

/** fetch() through the proxy. */
export async function proxiedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return (await undiciFetch(url, { ...init, dispatcher: await proxyAgent() })) as unknown as Response;
}
