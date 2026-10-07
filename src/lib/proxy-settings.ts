// Server-only, local only: the saved proxy API link (with its access token). Kept in a file on this
// computer (.site-auditor.local.json, git-ignored), never sent back to the browser in full.
// Used by Visit Test and Auto CTR.

import { promises as fs } from "node:fs";
import path from "node:path";
import { isBlockedHost } from "./url";

const FILE = path.join(process.cwd(), ".site-auditor.local.json");

export interface ProxyApiStatus {
  saved: boolean;
  /** "saved": the link saved from the page; "env": PROXY_API_URL in .env.local. */
  source: "saved" | "env" | null;
  /** Safe to show: host and the last 4 characters, e.g. "proxy.shoplike.vn…a1b2". */
  hint: string | null;
}

export async function readSavedProxyApi(): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(FILE, "utf8")) as { proxyApiUrl?: unknown };
    return typeof j.proxyApiUrl === "string" && j.proxyApiUrl.trim() ? j.proxyApiUrl.trim() : null;
  } catch {
    return null;
  }
}

export async function saveProxyApi(url: string): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify({ proxyApiUrl: url.trim(), savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export async function removeSavedProxyApi(): Promise<void> {
  await fs.rm(FILE, { force: true });
}

/** The link to use: one sent with the request, else the saved one, else PROXY_API_URL. */
export async function resolveProxyApi(fromRequest: unknown): Promise<string> {
  return (typeof fromRequest === "string" && fromRequest.trim()) || (await readSavedProxyApi()) || process.env.PROXY_API_URL || "";
}

export async function proxyApiStatus(): Promise<ProxyApiStatus> {
  const saved = await readSavedProxyApi();
  if (saved) return { saved: true, source: "saved", hint: hint(saved) };
  if (process.env.PROXY_API_URL) return { saved: true, source: "env", hint: hint(process.env.PROXY_API_URL) };
  return { saved: false, source: null, hint: null };
}

/** A usable proxy API link: http(s) and not a private/local address. */
export function isValidProxyApi(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return /^https?:$/.test(u.protocol) && !isBlockedHost(u.hostname);
  } catch {
    return false;
  }
}

function hint(url: string): string {
  const tail = url.trim().slice(-4);
  try {
    return `${new URL(url).host}…${tail}`;
  } catch {
    return `…${tail}`;
  }
}
