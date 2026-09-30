// Server-only fetch wrapper used by the API routes.
// - realistic browser User-Agent (some WordPress security plugins block unknown bots)
// - one timeout covering the whole request, redirects included
// - SSRF guard: checks the hostname AND its resolved IPs on every redirect hop

import { lookup } from "node:dns/promises";
import { isBlockedHost } from "./url";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 5;

/** Thrown when a URL (or a redirect target) points at a private/loopback address. */
export class BlockedUrlError extends Error {
  constructor(url: string) {
    super(`Blocked address: ${url}`);
    this.name = "BlockedUrlError";
  }
}

export interface SafeFetchResult {
  response: Response;
  finalUrl: string;
  redirected: boolean;
}

export async function safeFetch(
  url: string,
  {
    timeoutMs = 15_000,
    accept = "*/*",
    method = "GET",
  }: { timeoutMs?: number; accept?: string; method?: "GET" | "HEAD" } = {},
): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);

    const response = await fetch(current, {
      method,
      redirect: "manual",
      signal,
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }

    return { response, finalUrl: current, redirected: hop > 0 };
  }

  throw new Error(`Too many redirects: ${url}`);
}

/** Short, readable message for fetch failures (timeouts, DNS errors, etc.). */
export function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "request timed out";
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return cause ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}

async function assertPublicUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError(url);
  if (isBlockedHost(u.hostname)) throw new BlockedUrlError(url);

  // A public-looking name can still resolve to a private IP.
  const addresses = await lookup(u.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (addresses.some((a) => isBlockedHost(a.address))) throw new BlockedUrlError(url);
}
