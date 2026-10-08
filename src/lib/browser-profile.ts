// Server-only, local only: the Chrome profile the app's browsers use. In Settings you pick one of
// this computer's Chrome profiles by name; Chrome won't let the app control a profile inside its own
// folder, so the app copies it into its own (%LOCALAPPDATA%\SiteAuditor\chrome-profiles\<name>) and
// uses the copy. Nothing picked: CHROME_PROFILE_DIR in .env.local, else every browser starts with a
// fresh temporary profile. Chrome locks a profile folder while it's open, so each browser gets its own:
// the ranking check uses the copy itself (else "ranking-2", "ranking-3"… while another check has it),
// each visit "visit-1", "visit-2"… (the lowest one free), each filled from the copy the first time.
// Caches aren't copied. Extensions stay off. The name is stored with the other settings
// (src/lib/secret-settings.ts); it isn't secret.

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { deleteSecretSetting, readSecretSetting, writeSecretSetting } from "./secret-settings";

const NAME = "chrome_profile_name";

/** Chrome's own profiles folder on this computer. */
const chromeUserData = () => (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data") : null);

/** Where the app keeps its copies. */
const copiesRoot = () => path.join(process.env.LOCALAPPDATA ?? process.cwd(), "SiteAuditor", "chrome-profiles");

/** The app's copy of a Chrome profile, by its name. */
const copyDir = (name: string) => path.join(copiesRoot(), name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "profile");

/** Not worth copying: caches Chrome rebuilds by itself, and lock files of a running Chrome. */
const SKIP = /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|Service Worker|blob_storage|Crashpad|component_crx_cache|optimization_guide_.*|Singleton.*|lockfile|LOCK)$/i;

export interface ChromeProfile {
  /** The name shown in Chrome, e.g. "site-auditor-test". */
  name: string;
  /** Its folder inside Chrome's own, e.g. "Profile 3". */
  folder: string;
  /** Signed in to Google: the account's name and email, as Chrome's profile menu shows them. */
  account: { name: string | null; email: string } | null;
}

export interface ChromeProfileStatus {
  /** This computer's Chrome profiles, to pick from. */
  profiles: ChromeProfile[];
  /** The one picked in Settings, or null. */
  selected: string | null;
  /** The folder the app's browsers use (the copy, or CHROME_PROFILE_DIR), or null for fresh temporary profiles. */
  dir: string | null;
  source: "saved" | "env" | null;
  /** When the copy was made (the copy's folder date). */
  copiedAt: string | null;
  updatedBy?: string | null;
}

/** This computer's Chrome profiles (from Chrome's "Local State"). */
export async function listChromeProfiles(): Promise<ChromeProfile[]> {
  const root = chromeUserData();
  if (!root) return [];
  try {
    const state = JSON.parse(await fs.readFile(path.join(root, "Local State"), "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string; is_using_default_name?: boolean; user_name?: string; gaia_name?: string }> };
    };
    return Object.entries(state.profile?.info_cache ?? {})
      .map(([folder, info]) => ({
        // A signed-in profile never renamed is stored as "Your Chrome": Chrome's menu shows the account's name instead, so do we.
        name: (info.is_using_default_name && info.user_name && (info.gaia_name || info.user_name)) || info.name || folder,
        folder,
        account: info.user_name ? { name: info.gaia_name || null, email: info.user_name } : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // Chrome not installed, or never run
  }
}

export async function chromeProfileStatus(): Promise<ChromeProfileStatus> {
  const profiles = await listChromeProfiles();
  const r = await readSecretSetting(NAME);
  if (r.state === "ok") {
    // The name is shared (database), the copy isn't: on a computer or Windows user without the copy,
    // no profile is used (fresh temporary profiles), as if none were picked.
    const dir = copyDir(r.value);
    const stat = await fs.stat(path.join(dir, "Default")).catch(() => null);
    return { profiles, selected: r.value, dir: stat ? dir : null, source: "saved", copiedAt: stat ? stat.mtime.toISOString() : null, updatedBy: r.updatedBy };
  }
  const env = process.env.CHROME_PROFILE_DIR?.trim();
  return { profiles, selected: null, dir: env || null, source: env ? "env" : null, copiedAt: null };
}

/** The folder the app's browsers use, or null (fresh temporary profiles). A settings read that fails counts as none. */
export async function chromeProfileDir(): Promise<string | null> {
  return (await chromeProfileStatus().catch(() => null))?.dir ?? null;
}

/**
 * Picks a Chrome profile by name and copies it into the app's folder (again, when it's already
 * picked: "Update" in Settings). Older visit and ranking copies are removed, so they're filled from the new
 * one. Returns an error message, or null when done.
 */
export async function selectChromeProfile(name: string, updatedBy: string | null): Promise<string | null> {
  const profile = (await listChromeProfiles()).find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const root = chromeUserData();
  if (!profile || !root) return `There's no Chrome profile named "${name}" on this computer.`;
  const dir = copyDir(profile.name);
  if ([...inUse].some((d) => d === dir || d.startsWith(dir + path.sep))) return "A visit or ranking check is using the profile right now. Update it when they've finished.";
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await copyProfile(path.join(root, profile.folder), root, dir, profile.folder);
  } catch (err) {
    return `Couldn't save the profile (${err instanceof Error ? err.message : String(err)}). Quit Chrome completely and try again.`;
  }
  await writeSecretSetting(NAME, profile.name, updatedBy);
  return null;
}

export async function stopUsingChromeProfile(): Promise<void> {
  await deleteSecretSetting(NAME);
}

/**
 * Copies one profile folder in as "Default", with Chrome's "Local State" beside it (it holds the key
 * the cookies and passwords are encrypted with). Local State also says which profile Chrome opens and
 * what it's called: it's rewritten to list only this one, as "Default" (else Chrome may open another,
 * empty profile, or show the main profile's name). Files a running Chrome holds are skipped.
 */
async function copyProfile(profileFolder: string, userData: string, dest: string, folder = "Default"): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  await copyTree(profileFolder, path.join(dest, "Default"));
  try {
    const state = JSON.parse(await fs.readFile(path.join(userData, "Local State"), "utf8")) as { profile?: Record<string, unknown> & { info_cache?: Record<string, unknown> } };
    const info = state.profile?.info_cache?.[folder];
    state.profile = { ...state.profile, info_cache: info ? { Default: info } : {}, last_used: "Default", last_active_profiles: ["Default"], profiles_order: ["Default"] };
    await fs.writeFile(path.join(dest, "Local State"), JSON.stringify(state));
  } catch {
    /* no Local State: Chrome starts one (saved logins and cookies then don't carry over) */
  }
}

/** Chrome's start-up switch for a saved profile: always its "Default" folder, whatever Local State says. */
export const PROFILE_ARGS = ["--profile-directory=Default"];

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else if (entry.isFile()) await fs.copyFile(src, dst).catch(() => {}); // held open by a running Chrome: skipped
  }
}

// Folders open right now, so no two browsers get the same one. On globalThis: survives a dev reload.
const g = globalThis as typeof globalThis & { __profilesInUse?: Set<string> };
const inUse = (g.__profilesInUse ??= new Set<string>());

export interface ProfileLease {
  dir: string;
  release(): void;
}

/**
 * A profile folder for one browser, or null when none is set (fresh temporary profile).
 * Ranking checks: the folder itself, else ranking-2, ranking-3…; visits: visit-1, visit-2… (lowest free).
 * A new visit or ranking folder starts as a copy of the folder's profile.
 */
export async function leaseChromeProfile(kind: "ranking" | "visit"): Promise<ProfileLease | null> {
  const root = await chromeProfileDir();
  if (!root) return null;
  for (let n = 1; ; n++) {
    const dir = kind === "ranking" ? (n === 1 ? root : path.join(root, `ranking-${n}`)) : path.join(root, `visit-${n}`);
    if (inUse.has(dir)) continue;
    inUse.add(dir);
    try {
      if (dir !== root && !existsSync(path.join(dir, "Default")) && existsSync(path.join(root, "Default"))) {
        await copyProfile(path.join(root, "Default"), root, dir);
      } else await fs.mkdir(dir, { recursive: true });
    } catch {
      /* Chrome starts a fresh profile in it */
    }
    let released = false;
    return {
      dir,
      release() {
        if (released) return;
        released = true;
        inUse.delete(dir);
      },
    };
  }
}

/** A plainer message when Chrome won't start because the profile folder is already open elsewhere. */
export function profileLockedMessage(err: unknown, dir: string): string | null {
  const m = err instanceof Error ? err.message : String(err);
  // On Windows, Chrome hands off to the window that has the profile open and exits with code 21.
  return /already running|ProcessSingleton|user data directory is already in use|SingletonLock|profile.*in use|exitCode=21\b/i.test(m)
    ? `Chrome is already open with the profile folder ${dir}. Close that Chrome window and try again.`
    : null;
}
