// The Auto CTR report's filters (the dashboard's): the period, the site and the computer, in its address
// (/ctr/report?period=week&site=all&pc=all), and the PDF's (/api/ctr/report, same query).

import type { Period } from "./overview";

export const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  "last-week": "Last week",
  month: "This month",
  "30": "Last 30 days",
  all: "All time",
};

export interface ReportFilters {
  period: Period;
  /** A site (as grouped on the dashboard) or "all". */
  site: string;
  /** A computer's id or "all". */
  pc: string;
}

/** The report's address for these filters: the page, or (`pdf`) the PDF download. */
export function reportUrl(f: ReportFilters, pdf = false): string {
  const q = new URLSearchParams({ period: f.period, site: f.site, pc: f.pc });
  return `${pdf ? "/api/ctr/report" : "/ctr/report"}?${q}`;
}

/** Filters from an address's query; anything unknown is the default (this week, every site and computer). */
export function parseFilters(q: Record<string, string | string[] | undefined> | URLSearchParams): ReportFilters {
  const get = (k: string) => {
    const v = q instanceof URLSearchParams ? q.get(k) : q[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const period = get("period") as Period;
  return { period: Object.hasOwn(PERIOD_LABELS, period) ? period : "week", site: get("site") || "all", pc: get("pc") || "all" };
}
