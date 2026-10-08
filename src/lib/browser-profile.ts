// Server-only, local only: the Chrome profile the app's browsers use. In Settings you pick one of
// this computer's Chrome profiles by name; Chrome won't let the app control a profile inside its own
// folder, so the app copies it into its own (%LOCALAPPDATA%\SiteAuditor\chrome-profiles\<name>) and
// uses the copy. Nothing picked: CHROME_PROFILE_DIR in .env.local, else every browser starts with a
// fresh temporary profile. Chrome locks a profile folder while it's open, so each browser gets its own
// copy of it: ranking checks "ranking-1", "ranking-2"…, visits "visit-1", "visit-2"… (the lowest one
// free), each filled from the saved one (again after it changed). The saved one itself is only changed
// by Save/Update and Open, so those never wait for running visits.
// Caches aren't copied. Extensions are never turned off: the profile's run.
// Chrome locks part of a profile (sign-ins, cookies, and the seal on extension settings) to its own folder:
// in a copy it resets the extensions, and sign-ins are lost. A profile set up in the app's own folder has no
// such lock, so its visit and ranking copies keep everything: "Open" (Settings) opens the copy in a normal
// Chrome window to add extensions and sign in. The name is stored with the other settings
// (src/lib/secret-settings.ts); it isn't secret.

import { spawn } from "node:child_process";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { deleteSecretSetting, readSecretSetting, writeSecretSetting } from "./secret-settings";

const NAME = "chrome_profile_name";

/** Chrome's own profiles folder on this computer. */
const chromeUserData = () => (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data") : null);

/** Where the app keeps its copies. */
const copiesRoot = () => path.join(process.env.LOCALAPPDATA ?? process.cwd(), "SiteAuditor", "chrome-profiles");

/** The app's copy of a Chrome profile, by its name. */
const copyDir = (name: string) => path.join(copiesRoot(), name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "profile");

/** In each visit or ranking copy: the version of the saved profile it was filled from. */
const STAMP = ".saved";
const readStamp = (dir: string) => fs.readFile(path.join(dir, STAMP), "utf8").catch(() => null);
/** The saved profile's version: when Chrome last wrote its settings (Save, or its Open window closing). */
const profileVersion = (dir: string) =>
  fs.stat(path.join(dir, "Default", "Preferences")).then(
    (st) => String(st.mtimeMs),
    () => null,
  );

/** Chrome has the folder open (any Chrome, the app's or not): it holds its "lockfile" until it quits. */
async function chromeHasOpen(dir: string): Promise<boolean> {
  try {
    await fs.rm(path.join(dir, "lockfile"));
    return false; // left by a Chrome that's gone
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** Google Chrome on this computer (a Chrome profile: not Edge). */
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

/** Google Chrome's program on this computer, or null. */
export const chromeExecutable = () => CHROME_PATHS.find((p): p is string => !!p && existsSync(p)) ?? null;

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
  /** Its "Open" window (to add extensions, sign in) is open now. */
  open: boolean;
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
    const copiedAt = stat ? stat.mtime.toISOString() : null;
    return { profiles, selected: r.value, dir: stat ? dir : null, source: "saved", copiedAt, open: stat ? await chromeHasOpen(dir) : false, updatedBy: r.updatedBy };
  }
  const env = process.env.CHROME_PROFILE_DIR?.trim();
  return { profiles, selected: null, dir: env || null, source: env ? "env" : null, copiedAt: null, open: false };
}

/** The folder the app's browsers use, or null (fresh temporary profiles). A settings read that fails counts as none. */
export async function chromeProfileDir(): Promise<string | null> {
  return (await chromeProfileStatus().catch(() => null))?.dir ?? null;
}

/**
 * Picks a Chrome profile by name and copies it into the app's folder (again, when it's already
 * picked: "Update" in Settings). Picked again with a copy already here (Save), that copy is kept, with
 * what was added to it with Open. Visit and ranking copies are filled from it again the next time
 * they're used. Returns an error message, or null when done.
 */
export async function selectChromeProfile(name: string, updatedBy: string | null, update = false): Promise<string | null> {
  const profile = (await listChromeProfiles()).find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const root = chromeUserData();
  if (!profile || !root) return `There's no Chrome profile named "${name}" on this computer.`;
  const dir = copyDir(profile.name);
  if (!update && existsSync(path.join(dir, "Default", "Preferences"))) {
    await writeSecretSetting(NAME, profile.name, updatedBy);
    return null;
  }
  if (existsSync(dir) && (await chromeHasOpen(dir))) return "It's open in Chrome (Open). Close that Chrome window and try again.";
  try {
    // Only the saved profile itself: the visit and ranking copies inside its folder may be in use.
    await fs.rm(path.join(dir, "Default"), { recursive: true, force: true });
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
 * Opens the saved profile in a normal Chrome window (no automation, no proxy), to add or turn on
 * extensions and sign in. Visits and ranking checks keep using their copies meanwhile; after the window
 * is closed, the copies are filled from it again. Returns an error message, or null when it opened.
 */
export async function openChromeProfile(): Promise<string | null> {
  const dir = await chromeProfileDir();
  if (!dir) return "Save a Chrome profile first.";
  if (await chromeHasOpen(dir)) return "It's already open in Chrome.";
  const chrome = chromeExecutable();
  if (!chrome) return "Google Chrome isn't installed on this computer.";
  try {
    const child = spawn(chrome, [`--user-data-dir=${dir}`, ...PROFILE_ARGS, "--no-first-run", "--no-default-browser-check", "chrome://extensions"], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch (err) {
    return `Couldn't open Chrome (${err instanceof Error ? err.message : String(err)}).`;
  }
  return null;
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

/** Playwright and Puppeteer start Chrome with extensions off: every app browser leaves them on. */
export const KEEP_EXTENSIONS = ["--disable-extensions", "--disable-component-extensions-with-background-pages"];

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
 * Ranking checks: ranking-1, ranking-2…; visits: visit-1, visit-2… (lowest free). Each is filled from the
 * saved profile, again after it changed (not while the saved one is open in Chrome: then as it was).
 */
export async function leaseChromeProfile(kind: "ranking" | "visit"): Promise<ProfileLease | null> {
  const root = await chromeProfileDir();
  if (!root) return null;
  for (let n = 1; ; n++) {
    const dir = path.join(root, `${kind}-${n}`);
    if (inUse.has(dir)) continue;
    inUse.add(dir);
    try {
      const version = await profileVersion(root);
      const stale = !existsSync(path.join(dir, "Default")) || (version !== null && (await readStamp(dir)) !== version);
      if (stale && version !== null && !(await chromeHasOpen(root))) {
        await fs.rm(dir, { recursive: true, force: true });
        await copyProfile(path.join(root, "Default"), root, dir);
        await fs.writeFile(path.join(dir, STAMP), version);
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

/** What a check needs of a browser tab (Playwright's and Puppeteer's both fit). */
interface CheckTab {
  goto(url: string): Promise<unknown>;
  evaluate(fn: () => string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Makes sure the browser is Google Chrome and opened the profile folder it was given (its "Default"),
 * from chrome://version (nothing goes over the network). Throws when it isn't. Returns a line for the
 * console: the browser, the profile's name and its extensions that are on.
 */
export async function checkChromeProfile(tab: CheckTab, dir: string): Promise<string> {
  let text = "";
  try {
    await tab.goto("chrome://version");
    text = await tab.evaluate(() => document.body.innerText);
  } finally {
    await tab.close().catch(() => {});
  }
  const field = (label: string) => text.match(new RegExp(`^${label}\s+(.+)$`, "m"))?.[1].trim() ?? "";
  const browser = text.match(/^(Google Chrome)\s+([\d.]+)/m);
  const opened = field("Profile Path");
  if (!browser) throw new Error(`The browser isn't Google Chrome, so the saved Chrome profile can't be used (${text.split("\n")[0] || "unknown browser"}).`);
  // Both as full real paths (Windows can write one folder two ways, e.g. "CHATHU~1").
  const real = (p: string) => {
    try {
      return realpathSync.native(p).toLowerCase();
    } catch {
      return path.resolve(p).toLowerCase();
    }
  };
  if (!opened || real(opened) !== real(path.join(dir, "Default"))) {
    throw new Error(`Chrome opened a different profile (${opened || "unknown"}) instead of ${path.join(dir, "Default")}.`);
  }
  const { name, extensions } = await describeProfile(dir);
  return `Browser: Google Chrome ${browser[2]} · profile "${name}" (${path.basename(dir)}) · extensions: ${extensions.length ? extensions.join(", ") : "none"}`;
}

/** A profile folder's name (Local State) and the extensions installed in it and on (Secure Preferences). */
async function describeProfile(dir: string): Promise<{ name: string; extensions: string[] }> {
  const read = (f: string) => fs.readFile(path.join(dir, f), "utf8").then((s) => JSON.parse(s) as Record<string, unknown>, () => ({}) as Record<string, unknown>);
  const [state, prefs] = await Promise.all([read("Local State"), read(path.join("Default", "Secure Preferences"))]);
  const name = (state as { profile?: { info_cache?: { Default?: { name?: string } } } }).profile?.info_cache?.Default?.name ?? "Default";
  type Ext = { manifest?: { name?: string }; location?: number; state?: number; disable_reasons?: unknown[] };
  const settings = (prefs as { extensions?: { settings?: Record<string, Ext> } }).extensions?.settings ?? {};
  // Installed from the Chrome Web Store (1) or unpacked (4), and not turned off: not Chrome's own (5, 10).
  const extensions = Object.values(settings)
    .filter((e) => e.manifest?.name && (e.location === 1 || e.location === 4) && e.state !== 0 && !e.disable_reasons?.length)
    .map((e) => e.manifest!.name!.replace(/^__MSG_.*__$/, "(unnamed)"))
    .sort();
  return { name, extensions };
}
