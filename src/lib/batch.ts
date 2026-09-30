// Bulk scanning: parse a pasted list of sites and describe the scan queue.
// Sites are scanned one after another (each scan already runs 5 requests in parallel),
// which keeps load on the serverless functions and the target servers predictable.

import type { ScanProgress, ScanResult } from "./types";
import { parseSiteUrl } from "./url";

export const MAX_SITES = 50;

export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped" | "skipped";

export interface SiteJob {
  id: string;
  /** What the user typed for this site. */
  input: string;
  host: string;
  status: JobStatus;
  progress?: ScanProgress;
  result?: ScanResult;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ParsedSiteList {
  sites: { input: string; host: string }[];
  invalid: string[];
  duplicates: number;
  /** Entries dropped because the list was longer than MAX_SITES. */
  overLimit: number;
}

/**
 * Splits pasted text on new lines, commas, semicolons or spaces, and keeps one entry
 * per host ("www." ignored), so "example.com" and "https://www.example.com/" count once.
 */
export function parseSiteList(text: string): ParsedSiteList {
  const entries = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const sites: ParsedSiteList["sites"] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  let overLimit = 0;

  for (const input of entries) {
    const url = parseSiteUrl(input);
    if (!url || !url.hostname.includes(".")) {
      invalid.push(input);
      continue;
    }
    const key = url.hostname.replace(/^www\./, "");
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (sites.length >= MAX_SITES) {
      overLimit++;
      continue;
    }
    sites.push({ input, host: url.host });
  }

  return { sites, invalid, duplicates, overLimit };
}

export function isFinished(job: SiteJob): boolean {
  return job.status !== "queued" && job.status !== "running";
}
