// Server-only: read-only access to Google Search Console and Google Analytics 4 with a service
// account. GOOGLE_SERVICE_ACCOUNT_JSON holds the account's JSON key (as is, or base64). The
// account's email must be added as a user in Search Console (each site) and as a Viewer in GA4.
// Every call, sign-in included, goes through the proxy (src/lib/proxy-fetch.ts), never from this
// computer's or the server's own IP.

import { createSign } from "node:crypto";
import { proxiedFetch } from "../proxy-fetch";

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

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Service account sign-in (OAuth 2.0 JWT bearer), through the proxy. Kept until a minute before it expires. */
let cached: { token: string; expiresAt: number } | null = null;
async function accessToken(): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Google isn't connected yet: add GOOGLE_SERVICE_ACCOUNT_JSON.");
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPES.join(" "), aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  )}`;
  const assertion = `${unsigned}.${b64url(createSign("RSA-SHA256").update(unsigned).sign(sa.private_key))}`;
  const res = await proxiedFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed: ${json.error_description ?? `HTTP ${res.status}`}`);
  cached = { token: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

async function googlePost<T>(url: string, body: unknown): Promise<T> {
  const res = await proxiedFetch(url, {
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
