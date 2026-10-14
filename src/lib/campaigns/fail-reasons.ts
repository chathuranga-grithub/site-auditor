// Why a campaign's visit try didn't count, in a few kinds, counted per day (ctr_days.fail_reasons, saved
// with the visit counts: no extra writes) for the dashboard and the campaign page. A try's kind is read
// from what the visit said when it stopped (its error or stop reason, src/lib/visit-runner.ts).

export type FailReason = "captcha" | "proxy" | "google" | "not-found" | "site" | "browser" | "other";

/** The kinds, in the order they're shown, with what each means. */
export const FAIL_REASONS: { key: FailReason; label: string; detail: string }[] = [
  { key: "captcha", label: "CAPTCHA not solved", detail: "Google asked for a CAPTCHA and it wasn't solved in time (or Google wouldn't give this IP one)" },
  { key: "proxy", label: "Proxy problem", detail: "The proxy failed, was too slow, or its IP couldn't be confirmed in Vietnam" },
  { key: "google", label: "No Google results", detail: "Google showed its consent page or no results, or the search didn't go through" },
  { key: "not-found", label: "Site not on Google", detail: "The site wasn't in Google's first pages for the keyword, so it wasn't opened" },
  { key: "site", label: "Site didn't open", detail: "The site's page didn't load after the click" },
  { key: "browser", label: "Browser problem", detail: "Chrome didn't start or its window was closed" },
  { key: "other", label: "Other", detail: "Anything else (see the campaign's console when it happens)" },
];

/** A try's kind, from what the visit said when it stopped. */
export function failReasonOf(message: string): FailReason {
  // Most specific first: "the window was closed while waiting for the CAPTCHA" is the browser; a CAPTCHA
  // message names the proxy too; a search or page that failed because of the proxy is the proxy.
  if (/window was closed/i.test(message)) return "browser";
  if (/CAPTCHA/i.test(message)) return "captcha";
  if (/proxy|own IP|ERR_PROXY|ERR_TUNNEL/i.test(message)) return "proxy";
  if (/consent page|didn't show results|results weren't shown|Google search didn't work/i.test(message)) return "google";
  if (/wasn't found in Google's results/i.test(message)) return "not-found";
  if (/site didn't open/i.test(message)) return "site";
  if (/chrome|browser/i.test(message)) return "browser";
  return "other";
}

/**
 * Why `failed` tries failed, most first: each kind with its count, then those with no reason saved
 * (made before app 1.0.17) as "Not recorded".
 */
export function failReasonList(reasons: Partial<Record<string, number>>, failed: number): { key: FailReason | "unknown"; label: string; detail: string; n: number }[] {
  const counts = addReasons({}, reasons);
  const out: { key: FailReason | "unknown"; label: string; detail: string; n: number }[] = FAIL_REASONS.map((r) => ({ ...r, n: counts[r.key] ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const unknown = failed - out.reduce((s, r) => s + r.n, 0);
  if (unknown > 0) out.push({ key: "unknown", label: "Not recorded", detail: "Failed before app 1.0.17, which saves why", n: unknown });
  return out;
}

/** Counts per kind added together (a day's, a campaign's over a period…). */
export function addReasons(into: Partial<Record<FailReason, number>>, more: Partial<Record<string, number>> | null | undefined): Partial<Record<FailReason, number>> {
  for (const [k, n] of Object.entries(more ?? {})) {
    const key = (FAIL_REASONS.some((r) => r.key === k) ? k : "other") as FailReason;
    into[key] = (into[key] ?? 0) + Number(n ?? 0);
  }
  return into;
}
