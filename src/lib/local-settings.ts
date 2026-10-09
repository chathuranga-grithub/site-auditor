// Server-only, local only: settings that belong to this computer (and Windows user), not to the shared
// database: e.g. the Chrome profile its browsers use, since each computer has its own Chrome profiles.
// Kept in %LOCALAPPDATA%\SiteAuditor\settings.json, next to the app's Chrome profile copies.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface LocalSetting {
  value: string;
  updatedBy: string | null;
  updatedAt: string;
}

const file = () => path.join(process.env.LOCALAPPDATA ?? process.cwd(), "SiteAuditor", "settings.json");

async function readAll(): Promise<Record<string, LocalSetting>> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as Record<string, LocalSetting>;
  } catch {
    return {}; // not saved yet, or unreadable: nothing set on this computer
  }
}

// One change at a time, so two saves never overwrite each other's keys.
let writing: Promise<unknown> = Promise.resolve();
function change(f: (all: Record<string, LocalSetting>) => void): Promise<void> {
  const next = writing.then(async () => {
    const all = await readAll();
    f(all);
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), JSON.stringify(all, null, 2));
  });
  writing = next.catch(() => {});
  return next;
}

export async function readLocalSetting(name: string): Promise<LocalSetting | null> {
  return (await readAll())[name] ?? null;
}

export function writeLocalSetting(name: string, value: string, updatedBy: string | null): Promise<void> {
  return change((all) => {
    all[name] = { value, updatedBy, updatedAt: new Date().toISOString() };
  });
}

export function deleteLocalSetting(name: string): Promise<void> {
  return change((all) => {
    delete all[name];
  });
}
