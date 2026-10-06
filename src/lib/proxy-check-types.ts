// Shared types for Proxy Check (local only): tests the rotating proxy service itself, over a
// time period. It never visits our sites; each check only asks neutral test addresses.

/** Test lengths offered, in minutes. */
export const CHECK_MINUTES = [15, 30, 45, 60] as const;
export type CheckMinutes = (typeof CHECK_MINUTES)[number];

/** Residential = home / mobile ISP (Viettel, VNPT, FPT…); datacenter = hosting or cloud. */
export type NetworkType = "residential" | "datacenter" | "unknown";

/** One call to the proxy API, and what the proxy it gave did. */
export interface ProxyCheckResult {
  /** ISO time of the check. */
  at: string;
  /** "ip": got a proxy and tested it; "wait": provider said wait for a new IP; "error": API or proxy failed. */
  kind: "ip" | "wait" | "error";
  waitSec?: number;
  /** Proxy "host:port" from the API. */
  address?: string;
  /** Seconds until the provider rotates the IP, if it says. */
  nextChangeSec?: number | null;
  /** The IP websites actually see, through the proxy. */
  ip?: string | null;
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  /** ISP / network, e.g. "AS7552 Viettel Group". */
  org?: string | null;
  network?: NetworkType;
  /** The proxy carried both test requests. */
  connected?: boolean;
  /** Time for a tiny request through the proxy (204 test address). */
  pingMs?: number | null;
  /** Time for the IP lookup through the proxy. */
  lookupMs?: number | null;
  error?: string;
}
