// Server-only, local only: the Chrome profile the app's browsers use. In Settings you pick one of
// this computer's Chrome profiles by name; Chrome won't let the app control a profile inside its own
// folder, so the app copies it into its own (%LOCALAPPDATA%\SiteAuditor\chrome-profiles\<name>) and
// uses the copy. Nothing picked: CHROME_PROFILE_DIR in .env.local, else every browser starts with a
// fresh temporary profile. Chrome locks a profile folder while it's open, so each browser gets its own
// copy of it: ranking checks "ranking-1", "ranking-2"…, visits "visit-1", "visit-2"… (the lowest one
// free), a fresh copy of the saved one each time. The saved one itself is only changed by Save
// and Open, so those never wait for running visits.
// Caches aren't copied. Extensions are never turned off: every browser on a profile loads the extensions
// in its Extensions folder from their files, switched on (profileExtensionDirs), since Chrome drops a
// copied profile's own record of them.
// Chrome locks part of a profile (sign-ins, cookies, and the seal on extension settings) to its own folder.
// A copy still loads the extensions the first time Chrome opens it, but Chrome resets them when it closes
// it, and sign-ins are lost: so a visit or ranking copy is used once, then copied again. A profile set up
// in the app's own folder has no such lock: "Open" (Settings) opens the saved one in a normal Chrome window
// to add extensions and sign in. The name is stored on this computer (src/lib/local-settings.ts), not in
// the shared database: each computer picks one of its own Chrome profiles.

import { spawn } from "node:child_process";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { readLocalSetting, writeLocalSetting } from "./local-settings";
import { readSecretSetting } from "./secret-settings";

const NAME = "chrome_profile_name";

/** Chrome's own profiles folder on this computer. */
const chromeUserData = () => (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data") : null);

/** Where the app keeps its copies. */
const copiesRoot = () => path.join(process.env.LOCALAPPDATA ?? process.cwd(), "SiteAuditor", "chrome-profiles");

/** The app's copy of a Chrome profile, by its name. */
const copyDir = (name: string) => path.join(copiesRoot(), name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "profile");


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

/** Not worth copying: caches Chrome rebuilds by itself, lock files of a running Chrome, and the tabs it had open (they would open again). */
const SKIP = /^(Sessions|Current Session|Current Tabs|Last Session|Last Tabs|Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|Service Worker|blob_storage|Crashpad|component_crx_cache|optimization_guide_.*|Singleton.*|lockfile|LOCK)$/i;

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

/**
 * The profile picked on this computer (local settings), or null. Picks used to be stored in the shared
 * database: one made there whose copy is on this computer is kept, as this computer's, the first time.
 * "" = none picked here (Stop using), so an old shared pick isn't taken again.
 */
async function pickedHere(): Promise<{ name: string; updatedBy: string | null } | null> {
  const local = await readLocalSetting(NAME);
  if (local) return local.value ? { name: local.value, updatedBy: local.updatedBy } : null;
  const shared = await readSecretSetting(NAME).catch(() => null);
  if (shared?.state !== "ok" || !existsSync(path.join(copyDir(shared.value), "Default"))) return null;
  await writeLocalSetting(NAME, shared.value, shared.updatedBy);
  return { name: shared.value, updatedBy: shared.updatedBy };
}

export async function chromeProfileStatus(): Promise<ChromeProfileStatus> {
  const profiles = await listChromeProfiles();
  const picked = await pickedHere();
  if (picked) {
    // Picked on this computer, but its copy may be gone (deleted by hand): no profile is used then
    // (fresh temporary profiles) until it's saved again.
    const dir = copyDir(picked.name);
    const stat = await fs.stat(path.join(dir, "Default")).catch(() => null);
    const copiedAt = stat ? stat.mtime.toISOString() : null;
    return { profiles, selected: picked.name, dir: stat ? dir : null, source: "saved", copiedAt, open: stat ? await chromeHasOpen(dir) : false, updatedBy: picked.updatedBy };
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
 * picked: "Save" on the saved one in Settings). Picked again with a copy already here (Save), that copy is kept, with
 * what was added to it with Open. Visit and ranking copies are filled from it again the next time
 * they're used. Returns an error message, or null when done.
 */
export async function selectChromeProfile(name: string, updatedBy: string | null, update = false): Promise<string | null> {
  const profile = (await listChromeProfiles()).find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const root = chromeUserData();
  if (!profile || !root) return `There's no Chrome profile named "${name}" on this computer.`;
  const dir = copyDir(profile.name);
  if (!update && existsSync(path.join(dir, "Default", "Preferences"))) {
    await writeLocalSetting(NAME, profile.name, updatedBy);
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
  await writeLocalSetting(NAME, profile.name, updatedBy);
  return null;
}

export async function stopUsingChromeProfile(): Promise<void> {
  await writeLocalSetting(NAME, "", null);
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

/** Lets the app load the profile's extensions into its browser (Extensions.loadUnpacked over the browser's pipe). */
export const EXTENSION_ARGS = ["--enable-unsafe-extension-debugging"];

/**
 * The extensions installed in a profile, as folders to load into a browser on one of its copies
 * (dir): the newest version of each, each keeping its id (its manifest has its key) and switched on.
 * Chrome deletes the extension folders it has no record of when it starts or closes, and a copy has
 * none, so they're never loaded from the copy itself: they're kept in the saved profile's own
 * folder (app-extensions, which Chrome doesn't manage), refreshed from its DefaultExtensions.
 */
export async function profileExtensionDirs(dir: string): Promise<string[]> {
  const root = path.dirname(dir);
  return (extensionsSync[root] ??= syncExtensions(root).finally(() => delete extensionsSync[root]));
}

// One refresh at a time per saved profile (several browsers can start together).
const extensionsSync: Record<string, Promise<string[]>> = {};

async function syncExtensions(root: string): Promise<string[]> {
  const store = path.join(root, "app-extensions");
  const installed = await extensionDirsIn(path.join(root, "Default", "Extensions"));
  // Removed from the saved profile: removed here too (unless Chrome emptied the saved one; then keep them).
  if (installed.length) {
    const ids = new Set(installed.map((d) => path.basename(path.dirname(d))));
    for (const id of await fs.readdir(store).catch(() => [])) if (!ids.has(id)) await fs.rm(path.join(store, id), { recursive: true, force: true }).catch(() => {});
  }
  for (const src of installed) {
    const dest = path.join(store, path.basename(path.dirname(src)), path.basename(src));
    if (existsSync(path.join(dest, "manifest.json"))) continue;
    // Another version of it (an update): replaced by this one.
    await fs.rm(path.dirname(dest), { recursive: true, force: true }).catch(() => {});
    await fs.cp(src, dest, { recursive: true }).catch(() => {});
  }
  return extensionDirsIn(store);
}

async function extensionDirsIn(root: string): Promise<string[]> {
  const ids = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];
  for (const id of ids) {
    if (!id.isDirectory() || !/^[a-p]{32}$/.test(id.name)) continue;
    const versions = (await fs.readdir(path.join(root, id.name)).catch(() => []))
      .filter((v) => existsSync(path.join(root, id.name, v, "manifest.json")))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (versions.length) dirs.push(path.join(root, id.name, versions[versions.length - 1]));
  }
  return dirs;
}

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
 * Ranking checks: ranking-1, ranking-2…; visits: visit-1, visit-2… (lowest free). Each is a fresh copy
 * of the saved profile every time: Chrome resets the extensions of a copied profile when it closes it
 * (see the top), so a copy is only ever used once. While the saved one is open in Chrome (Open), the
 * last copy is used as it is.
 */
export async function leaseChromeProfile(kind: "ranking" | "visit"): Promise<ProfileLease | null> {
  const root = await chromeProfileDir();
  if (!root) return null;
  for (let n = 1; ; n++) {
    const dir = path.join(root, `${kind}-${n}`);
    if (inUse.has(dir)) continue;
    inUse.add(dir); // before any wait, so two browsers starting at once never get the same one
    if (existsSync(path.join(root, "Default")) && !(await chromeHasOpen(root))) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        inUse.delete(dir);
        continue; // still held by a Chrome that didn't quit: use the next folder
      }
      await copyProfile(path.join(root, "Default"), root, dir).catch(() => {});
    } else await fs.mkdir(dir, { recursive: true }).catch(() => {});
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
  evaluate(fn: () => Promise<string>): Promise<string>;
}

/**
 * Makes sure the browser is Google Chrome and opened the profile folder it was given (its "Default"),
 * from chrome://version (nothing goes over the network). Throws when it isn't. Returns a line for the
 * console: the browser, the profile's name and the extensions Chrome really loaded and has on
 * (chrome://extensions: Chrome may have reset some the profile's files still list).
 */
export async function checkChromeProfile(tab: CheckTab, dir: string): Promise<string> {
  // In the browser's one tab: it's left open for what comes next.
  await tab.goto("chrome://version");
  const text = await tab.evaluate(async () => document.body.innerText);
  await tab.goto("chrome://extensions");
  const loaded = await tab.evaluate(readLoadedExtensions);
  const browser = text.match(/^(Google Chrome)\s+([\d.]+)/m);
  if (!browser) throw new Error(`The browser isn't Google Chrome, so the saved Chrome profile can't be used (${text.split("\n")[0] || "unknown browser"}).`);
  // The page's labels follow the browser's language (vi-VN for visits): find the profile's folder by its
  // value instead, a line that is only a path ending in a profile folder ("…\Default").
  const paths = text
    .split("\n")
    .map((line) => line.split("\t").pop()!.trim())
    .filter((v) => /^([a-z]:[\\/]|\/)\S/i.test(v) && /[\\/](Default|Profile \d+)$/i.test(v));
  // Both as full real paths (Windows can write one folder two ways, e.g. "CHATHU~1").
  const real = (p: string) => {
    try {
      return realpathSync.native(p).toLowerCase();
    } catch {
      return path.resolve(p).toLowerCase();
    }
  };
  const expected = real(path.join(dir, "Default"));
  if (!paths.some((p) => real(p) === expected)) {
    throw new Error(`Chrome opened a different profile (${paths[0] ?? "unknown"}) instead of ${path.join(dir, "Default")}.`);
  }
  return `Browser: Google Chrome ${browser[2]} · profile "${await profileName(dir)}" (${path.basename(dir)}) · extensions: ${loaded || "none"}`;
}

/**
 * Runs inside chrome://extensions: the names of the extensions listed there and switched on, joined
 * with ", " (waits up to 3 seconds for the list). Self-contained: it's sent to the page as text.
 */
async function readLoadedExtensions(): Promise<string> {
  type Root = { shadowRoot: ShadowRoot | null };
  const read = () => {
    const list = (document.querySelector("extensions-manager") as Root | null)?.shadowRoot?.querySelector("extensions-item-list") as Root | null;
    const items = list?.shadowRoot ? Array.from(list.shadowRoot.querySelectorAll("extensions-item")) : null;
    return items?.map((i) => (i as unknown as Root).shadowRoot).filter((r): r is ShadowRoot => !!r) ?? null;
  };
  for (let t = 0; t < 15 && !read()?.length; t++) await new Promise((r) => setTimeout(r, 200));
  return (read() ?? [])
    .filter((r) => (r.querySelector("#enableToggle") as HTMLInputElement | null)?.checked)
    .map((r) => r.querySelector("#name")?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

/** A profile folder's name, from its Local State. */
async function profileName(dir: string): Promise<string> {
  try {
    const state = JSON.parse(await fs.readFile(path.join(dir, "Local State"), "utf8")) as { profile?: { info_cache?: { Default?: { name?: string } } } };
    return state.profile?.info_cache?.Default?.name ?? "Default";
  } catch {
    return "Default";
  }
}

