// Server-only: Google search results, read in a real browser through the Vietnam proxy
// (src/lib/serp-browser.ts). That needs the app to run on a computer, and works for Vietnam only.
// Google can show fewer than 10 normal results on page 1 (videos, maps, shopping take
// their place); then page 2 is read too, so the list still reaches the requested count.
// To match what a person in Vietnam sees, each search sends the country (gl) and the search
// language (hl), and comes from a Vietnam IP.

import { findCountry, googleCountryParam, searchLanguage, type LanguageChoice } from "./countries";
import type { SerpResponse, SerpResult } from "./rankings-types";
import { BROWSER_SEARCH_COUNTRY, canSearchInBrowser, openBrowserSearch, type BrowserResult } from "./serp-browser";

type Provider = SerpResponse["provider"];

/** The ways Google can be searched here: the browser, when the app runs on a computer. */
export function configuredProviders(): Provider[] {
  return canSearchInBrowser() ? ["browser"] : [];
}

/** Top `count` organic results for a keyword in Vietnam. */
export async function searchGoogle(
  keyword: string,
  country: string,
  count: number,
  languageChoice: LanguageChoice = "local",
): Promise<SerpResponse> {
  if (!canSearchInBrowser()) throw new SerpError("Google search only works when the app runs on a computer (it uses a browser through the Vietnam proxy).", 503);
  if (country.toUpperCase() !== BROWSER_SEARCH_COUNTRY) throw new SerpError("Only Vietnam can be searched: the proxy is in Vietnam.", 400);

  const language = searchLanguage(country, languageChoice);
  const params = { q: keyword, gl: googleCountryParam(country), hl: language.hl };

  const session = await openBrowserSearch().catch((err: unknown) => {
    throw new SerpError(`Search failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  });
  try {
    const raw = await session.page(params, 1);
    let results = clean(raw);
    let searchesUsed = 1;
    if (results.length < count && raw.length > 0) {
      // Page 1 was short: top up from page 2. Page 2 failing isn't fatal.
      const more = await session.page(params, 2).catch(() => [] as BrowserResult[]);
      searchesUsed = 2;
      results = clean([...raw, ...more]);
    }
    return {
      keyword,
      country,
      language: language.hl,
      languageName: language.name,
      location: findCountry(country)?.name ?? country,
      provider: "browser",
      results: results.slice(0, count),
      searchesUsed,
      requested: count,
      searchedAt: new Date().toISOString(),
    };
  } catch (err) {
    throw new SerpError(`Search failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  } finally {
    await session.close();
  }
}

export class SerpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Keep valid http(s) results, number them 1..n in Google's order. */
function clean(raw: BrowserResult[]): SerpResult[] {
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
    out.push({ position: out.length + 1, title: r.title || domain, url: r.link, domain, snippet: r.snippet ?? "" });
  }
  return out;
}
