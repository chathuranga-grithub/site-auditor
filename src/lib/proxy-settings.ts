// Server-only: the saved proxy API link (with its access token). Stored ENCRYPTED in the database
// (src/lib/secret-settings.ts), never sent back to the browser in full: pages only get a hint.
// Used by campaign visits and browser searches. Older versions kept it in .site-auditor.local.json on this computer; that file
// is moved into the database the first time the link is read, then deleted.

import { promises as fs } from "node:fs";
import path from "node:path";
import { deleteSecretSetting, readSecretSetting, writeSecretSetting } from "./secret-settings";
import { isBlockedHost } from "./url";

const NAME = "proxy_api_url";
const LEGACY_FILE = path.join(process.cwd(), ".site-auditor.local.json");

export interface ProxyApiStatus {
  saved: boolean;
  /** "saved": saved in Settings (database); "env": PROXY_API_URL in .env.local. */
  source: "saved" | "env" | null;
  /** Safe to show: host and the last 4 characters, e.g. "proxy.shoplike.vn…a1b2". */
  hint: string | null;
  /** A link is saved but can't be decrypted (AUTH_SECRET changed): save it again. */
  unreadable?: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

let migrated: Promise<void> | null = null;
/** Moves a link saved by an older version (local file) into the database, once. */
function migrateLegacyFile(): Promise<void> {
  migrated ??= (async () => {
    let url: string | null = null;
    try {
      const j = JSON.parse(await fs.readFile(LEGACY_FILE, "utf8")) as { proxyApiUrl?: unknown };
      url = typeof j.proxyApiUrl === "string" && j.proxyApiUrl.trim() ? j.proxyApiUrl.trim() : null;
    } catch {
      return; // no old file
    }
    if (url && (await readSecretSetting(NAME)).state === "missing") await writeSecretSetting(NAME, url, "moved from this computer");
    await fs.rm(LEGACY_FILE, { force: true });
  })().catch((err) => {
    migrated = null;
    throw err;
  });
  return migrated;
}

export async function readSavedProxyApi(): Promise<string | null> {
  await migrateLegacyFile();
  const r = await readSecretSetting(NAME);
  return r.state === "ok" ? r.value : null;
}

export async function saveProxyApi(url: string, updatedBy: string | null): Promise<void> {
  await writeSecretSetting(NAME, url.trim(), updatedBy);
}

export async function removeSavedProxyApi(): Promise<void> {
  await deleteSecretSetting(NAME);
}

/** The link to use: one sent with the request, else the saved one, else PROXY_API_URL. */
export async function resolveProxyApi(fromRequest: unknown): Promise<string> {
  return (typeof fromRequest === "string" && fromRequest.trim()) || (await readSavedProxyApi()) || process.env.PROXY_API_URL || "";
}

export async function proxyApiStatus(): Promise<ProxyApiStatus> {
  await migrateLegacyFile();
  const r = await readSecretSetting(NAME);
  if (r.state === "ok") return { saved: true, source: "saved", hint: hint(r.value), updatedBy: r.updatedBy, updatedAt: r.updatedAt };
  if (process.env.PROXY_API_URL) return { saved: true, source: "env", hint: hint(process.env.PROXY_API_URL) };
  return { saved: false, source: null, hint: null, unreadable: r.state === "unreadable" };
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
