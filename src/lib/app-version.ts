// Server-only: the app's version. The desktop app passes its version to the server it starts
// (desktop/main.js); with npm run dev, the version the code is at (desktop/package.json, which the
// installer is built with), marked development.

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface AppVersion {
  version: string | null;
  /** The installed desktop app (else npm run dev, or the website). */
  installed: boolean;
}

let code: Promise<string | null> | null = null;

export async function appVersion(): Promise<AppVersion> {
  const installed = process.env.APP_VERSION;
  if (installed) return { version: installed, installed: true };
  code ??= readFile(path.join(process.cwd(), "desktop", "package.json"), "utf8").then(
    (s) => (JSON.parse(s) as { version?: string }).version ?? null,
    () => null,
  );
  return { version: await code, installed: false };
}
