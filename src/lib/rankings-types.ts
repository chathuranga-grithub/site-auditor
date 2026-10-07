// Shared types for the Keyword Rankings tool (API routes + UI).

export const RESULT_COUNTS = [5, 10] as const;
export type ResultCount = (typeof RESULT_COUNTS)[number];

/** One organic Google result. */
export interface SerpResult {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

/** Response of POST /api/serp. */
export interface SerpResponse {
  keyword: string;
  country: string;
  /** Google "hl" code the search was made in, e.g. "vi". */
  language: string;
  languageName: string;
  /** Location sent to Google, e.g. "Vietnam". */
  location: string;
  /** "browser": read in a real browser through the Vietnam proxy (the only way, for now). */
  provider: "browser";
  results: SerpResult[];
  /** 1 normally; 2 when page 1 was short and page 2 was fetched to fill the list. */
  searchesUsed: number;
  /** How many results were asked for (5 or 10). */
  requested: number;
  searchedAt: string;
}

/** On-page SEO data for one ranking page, from POST /api/analyze. */
export interface PageSeo {
  url: string;
  finalUrl: string;
  /** 0 = no response. */
  status: number;
  redirected: boolean;
  /** Bot challenge (e.g. Cloudflare) instead of the page; other fields are empty. */
  blocked: boolean;
  https: boolean;
  /** Server-side time to fetch the page, redirects included. */
  durationMs: number;
  /** HTML size in bytes. */
  bytes: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  h1Count: number;
  h2Count: number;
  wordCount: number;
  canonical: string | null;
  /** Canonical points at the page itself. */
  canonicalSelf: boolean;
  noindex: boolean;
  lang: string | null;
  viewport: boolean;
  /** JSON-LD @type values, e.g. ["Product", "BreadcrumbList"]. */
  schemaTypes: string[];
  ogTitle: boolean;
  ogImage: boolean;
  images: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  error?: string;
}

export type ApiError = { error: string };

/** Per-result analysis progress in the UI. */
export type AnalysisState = PageSeo | "pending" | { failed: string };
