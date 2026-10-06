// Server-only: Google search results from a SERP API (scraping Google directly is
// blocked and against its terms). Serper.dev is tried first (2,500 free searches);
// if it isn't configured or fails (e.g. credits used up), SerpApi (250 free/month) is used.
// Keys: SERPER_API_KEY, SERPAPI_API_KEY. Each call fetches one Google page = 1 search.
// Google can show fewer than 10 normal results on page 1 (videos, maps, shopping take
// their place); then page 2 is fetched too, so the list still reaches the requested count.
// To match what a person in that country sees, each search sends the country (gl), the
// country's search language (hl) and a location inside the country.

import { findCountry, googleCountryParam, searchLanguage, type LanguageChoice } from "./countries";
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
export async function searchGoogle(
  keyword: string,
  country: string,
  count: number,
  languageChoice: LanguageChoice = "local",
): Promise<SerpResponse> {
  const providers = configuredProviders();
  if (providers.length === 0) throw new SerpError("Search isn't set up yet: add SERPER_API_KEY or SERPAPI_API_KEY.", 503);

  const language = searchLanguage(country, languageChoice);
  const params: SearchParams = {
    q: keyword,
    gl: googleCountryParam(country),
    hl: language.hl,
    location: findCountry(country)?.name ?? country,
  };

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const run = (p: SearchParams, page: number) => (provider === "serper" ? serper(p, page) : serpapi(p, page));
      // If the provider doesn't recognise the location name, search by country + language only.
      const raw = await run(params, 1).catch((err: unknown) => {
        if (err instanceof Error && /location/i.test(err.message)) {
          params.location = "";
          return run(params, 1);
        }
        throw err;
      });
      let results = clean(raw);
      let searchesUsed = 1;
      if (results.length < count && raw.length > 0) {
        // Page 1 was short: top up from page 2 (a second search). Page 2 failing isn't fatal.
        const more = await run(params, 2).catch(() => [] as RawResult[]);
        searchesUsed = 2;
        results = clean([...raw, ...more]);
      }
      return {
        keyword,
        country,
        language: language.hl,
        languageName: language.name,
        location: params.location || "(country only)",
        provider,
        results: results.slice(0, count),
        searchesUsed,
        requested: count,
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

interface SearchParams {
  q: string;
  gl: string;
  hl: string;
  location: string;
}

interface RawResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
}

async function serper(p: SearchParams, page: number): Promise<RawResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ ...withoutEmpty(p), num: 10, ...(page > 1 ? { page } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { organic?: RawResult[]; message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data.organic ?? [];
}

async function serpapi(p: SearchParams, page: number): Promise<RawResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({
    engine: "google",
    ...withoutEmpty(p),
    num: "10",
    ...(page > 1 ? { start: String((page - 1) * 10) } : {}),
    api_key: process.env.SERPAPI_API_KEY!,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = (await res.json().catch(() => ({}))) as { organic_results?: RawResult[]; error?: string };
  // SerpApi reports "no results" as an error string; treat that as an empty list.
  if (data.error && !/hasn't returned any results/i.test(data.error)) throw new Error(data.error);
  if (!res.ok && !data.organic_results) throw new Error(`HTTP ${res.status}`);
  return data.organic_results ?? [];
}

function withoutEmpty(p: SearchParams): Record<string, string> {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== ""));
}

/** Keep valid http(s) results, number them 1..n in Google's order. */
function clean(raw: RawResult[]): SerpResult[] {
  const out: SerpResult[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r.link || !/^https?:\/\//i.test(r.link) || seen.has(r.link)) continue;
    seen.add(r.link);
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
