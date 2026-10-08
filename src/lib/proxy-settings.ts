// Server-only: the saved proxy API links (each with its access token). Stored ENCRYPTED in the
// database (src/lib/secret-settings.ts) as one setting, one link per line (a single link saved by an
// older version reads as a list of one), never sent back to the browser in full: pages only get hints.
// Used by campaign visits and browser searches. Older versions kept it in .site-auditor.local.json on this computer; that file
// is moved into the database the first time the link is read, then deleted.

import { promises as fs } from "node:fs";
import path from "node:path";
import { deleteSecretSetting, readSecretSetting, writeSecretSetting } from "./secret-settings";
import { isBlockedHost } from "./url";

const NAME = "proxy_api_url";
const LEGACY_FILE = path.join(process.cwd(), ".site-auditor.local.json");

/** Most links one list can hold. */
export const MAX_PROXY_APIS = 50;

export interface ProxyApiStatus {
  saved: boolean;
  /** "saved": saved in Settings (database); "env": PROXY_API_URL in .env.local. */
  source: "saved" | "env" | null;
  /** Safe to show, one per link in order: host and the last 4 characters, e.g. "proxy.shoplike.vn…a1b2". */
  hints: string[];
  /** Links are saved but can't be decrypted (AUTH_SECRET changed): save them again. */
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

/** Pasted text, or a stored value, as a list of links: one per line (spaces and commas also split them), no duplicates. */
export function parseProxyApiList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean))];
}

export async function readSavedProxyApis(): Promise<string[]> {
  await migrateLegacyFile();
  const r = await readSecretSetting(NAME);
  return r.state === "ok" ? parseProxyApiList(r.value) : [];
}

export async function saveProxyApis(urls: string[], updatedBy: string | null): Promise<void> {
  if (!urls.length) return deleteSecretSetting(NAME);
  await writeSecretSetting(NAME, urls.join("\n"), updatedBy);
}

export async function removeSavedProxyApi(): Promise<void> {
  await deleteSecretSetting(NAME);
}

/** Every link to use, in order: the saved ones, else PROXY_API_URL (which can also hold a list). */
export async function resolveProxyApis(): Promise<string[]> {
  const saved = await readSavedProxyApis();
  return saved.length ? saved : parseProxyApiList(process.env.PROXY_API_URL ?? "");
}

/** The link to use: one sent with the request, else the first saved one, else the first in PROXY_API_URL. */
export async function resolveProxyApi(fromRequest: unknown): Promise<string> {
  return (typeof fromRequest === "string" && fromRequest.trim()) || (await resolveProxyApis())[0] || "";
}

export async function proxyApiStatus(): Promise<ProxyApiStatus> {
  await migrateLegacyFile();
  const r = await readSecretSetting(NAME);
  if (r.state === "ok") return { saved: true, source: "saved", hints: parseProxyApiList(r.value).map(hint), updatedBy: r.updatedBy, updatedAt: r.updatedAt };
  const env = parseProxyApiList(process.env.PROXY_API_URL ?? "");
  if (env.length) return { saved: true, source: "env", hints: env.map(hint) };
  return { saved: false, source: null, hints: [], unreadable: r.state === "unreadable" };
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
