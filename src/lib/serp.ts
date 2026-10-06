// Server-only: Google search results from a SERP API (scraping Google directly is
// blocked and against its terms). Serper.dev is tried first (2,500 free searches);
// if it isn't configured or fails (e.g. credits used up), SerpApi (250 free/month) is used.
// Keys: SERPER_API_KEY, SERPAPI_API_KEY. Each call fetches one page of 10 results = 1 search.

import { googleCountryParam } from "./countries";
import type { SerpResponse, SerpResult } from "./rankings-types";

const TIMEOUT_MS = 15_000;

type Provider = SerpResponse["provider"];

export function configuredProviders(): Provider[] {
  const list: Provider[] = [];
  if (process.env.SERPER_API_KEY) list.push("serper");
  if (process.env.SERPAPI_API_KEY) list.push("serpapi");
  return list;
}

/** Top `count` organic results, trying each configured provider in order. */
export async function searchGoogle(keyword: string, country: string, count: number): Promise<SerpResponse> {
  const providers = configuredProviders();
  if (providers.length === 0) throw new SerpError("Search isn't set up yet: add SERPER_API_KEY or SERPAPI_API_KEY.", 503);

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const raw = provider === "serper" ? await serper(keyword, country) : await serpapi(keyword, country);
      return {
        keyword,
        country,
        provider,
        results: clean(raw).slice(0, count),
        searchedAt: new Date().toISOString(),
      };
    } catch (err) {
      failures.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new SerpError(`Search failed (${failures.join("; ")})`, 502);
}

export class SerpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RawResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
}

async function serper(keyword: string, country: string): Promise<RawResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ q: keyword, gl: googleCountryParam(country), hl: "en", num: 10 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { organic?: RawResult[]; message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data.organic ?? [];
}

async function serpapi(keyword: string, country: string): Promise<RawResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({
    engine: "google",
    q: keyword,
    gl: googleCountryParam(country),
    hl: "en",
    num: "10",
    api_key: process.env.SERPAPI_API_KEY!,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = (await res.json().catch(() => ({}))) as { organic_results?: RawResult[]; error?: string };
  // SerpApi reports "no results" as an error string; treat that as an empty list.
  if (data.error && !/hasn't returned any results/i.test(data.error)) throw new Error(data.error);
  if (!res.ok && !data.organic_results) throw new Error(`HTTP ${res.status}`);
  return data.organic_results ?? [];
}

/** Keep valid http(s) results, number them 1..n in Google's order. */
function clean(raw: RawResult[]): SerpResult[] {
  const out: SerpResult[] = [];
  for (const r of raw) {
    if (!r.link || !/^https?:\/\//i.test(r.link)) continue;
    let domain = "";
    try {
      domain = new URL(r.link).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    out.push({ position: out.length + 1, title: r.title ?? domain, url: r.link, domain, snippet: r.snippet ?? "" });
  }
  return out;
}
