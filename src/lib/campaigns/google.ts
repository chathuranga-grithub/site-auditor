// Server-only: read-only access to Google Search Console and Google Analytics 4 with a service
// account. GOOGLE_SERVICE_ACCOUNT_JSON holds the account's JSON key (as is, or base64). The
// account's email must be added as a user in Search Console (each site) and as a Viewer in GA4.

import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/analytics.readonly"];

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const key = JSON.parse(json) as Partial<ServiceAccount>;
    return key.client_email && key.private_key ? { client_email: key.client_email, private_key: key.private_key } : null;
  } catch {
    return null;
  }
}

export function serviceAccountEmail(): string | null {
  return serviceAccount()?.client_email ?? null;
}

let client: JWT | null = null;
async function accessToken(): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Google isn't connected yet: add GOOGLE_SERVICE_ACCOUNT_JSON.");
  client ??= new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google didn't give an access token.");
  return token;
}

async function googlePost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403) throw new Error(`No access (${msg}). Add ${serviceAccountEmail()} as a user of this property.`);
    throw new Error(msg);
  }
  return json;
}

export interface SearchConsoleDay {
  impressions: number;
  clicks: number;
  /** % */
  ctr: number | null;
  position: number | null;
  mobileClicks: number;
  desktopClicks: number;
  mobileImpressions: number;
  desktopImpressions: number;
}

/** One day of Search Console numbers for a keyword (and page, if given), split by device. */
export async function searchConsoleDay(property: string, day: string, keyword: string, pageUrl: string | null): Promise<SearchConsoleDay> {
  const filters: { dimension: string; operator: string; expression: string }[] = [{ dimension: "query", operator: "equals", expression: keyword.trim().toLowerCase() }];
  if (pageUrl) filters.push({ dimension: "page", operator: "equals", expression: pageUrl });
  const data = await googlePost<{ rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }>(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    { startDate: day, endDate: day, dimensions: ["device"], dimensionFilterGroups: [{ filters }], type: "web", dataState: "all" },
  );
  const rows = data.rows ?? [];
  const by = (device: string) => rows.filter((r) => r.keys[0] === device);
  const sum = (list: typeof rows, f: (r: (typeof rows)[number]) => number) => list.reduce((n, r) => n + f(r), 0);
  const impressions = sum(rows, (r) => r.impressions);
  const clicks = sum(rows, (r) => r.clicks);
  return {
    impressions,
    clicks,
    ctr: impressions ? Math.round((clicks / impressions) * 10000) / 100 : null,
    // Average position, weighted by impressions on each device.
    position: impressions ? Math.round((sum(rows, (r) => r.position * r.impressions) / impressions) * 10) / 10 : null,
    mobileClicks: sum(by("MOBILE"), (r) => r.clicks) + sum(by("TABLET"), (r) => r.clicks),
    desktopClicks: sum(by("DESKTOP"), (r) => r.clicks),
    mobileImpressions: sum(by("MOBILE"), (r) => r.impressions) + sum(by("TABLET"), (r) => r.impressions),
    desktopImpressions: sum(by("DESKTOP"), (r) => r.impressions),
  };
}

/** GA4 average engagement time (seconds per active user) on one page for one day; null = no visitors. */
export async function engagementSeconds(propertyId: string, day: string, pagePath: string): Promise<number | null> {
  const data = await googlePost<{ rows?: { metricValues: { value: string }[] }[] }>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      dateRanges: [{ startDate: day, endDate: day }],
      metrics: [{ name: "userEngagementDuration" }, { name: "activeUsers" }],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: pagePath } } },
    },
  );
  const row = data.rows?.[0];
  if (!row) return null;
  const duration = Number(row.metricValues[0]?.value ?? 0);
  const users = Number(row.metricValues[1]?.value ?? 0);
  return users ? Math.round((duration / users) * 10) / 10 : null;
}
