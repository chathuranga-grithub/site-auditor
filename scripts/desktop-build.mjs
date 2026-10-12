// Builds the Windows desktop app (desktop/): the app's server as Next.js standalone output, then the
// installer (dist-desktop\Site Auditor Setup <version>.exe) with electron-builder.
// Run: npm run desktop:build            (installer only)
//      npm run desktop:build -- --server (the server only, e.g. to try `npm run desktop:start`)
//      npm run desktop:release           (also publishes it as a GitHub release: needs GH_TOKEN)

import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next", "standalone");
const args = process.argv.slice(2);
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

// 1. The server.
// Only the last desktop server: not all of .next, which also holds a running `npm run dev` (.next/dev).
rmSync(standalone, { recursive: true, force: true });
run("npx next build", { DESKTOP_BUILD: "1" });

// 2. What standalone output leaves to a CDN: served by the app's own server here.
cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });

// 3. Packages loaded by name at run time, which the build's tracing can't see (the stealth plugin
// requires each of its evasions, and their own dependencies, by name): copied whole, with everything
// they depend on.
// The browser libraries too: they read their own files at run time (e.g. playwright-core's browsers.json).
const RUNTIME_PACKAGES = ["puppeteer-extra", "puppeteer-extra-plugin-stealth", "playwright-extra", "playwright-core", "puppeteer-core"];
const copied = new Set();
function copyPackage(name, from = root) {
  // Where Node would find it from `from`: its own node_modules, then up to the project's.
  let dir = null;
  for (let d = from; ; d = path.dirname(d)) {
    const candidate = path.join(d, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) {
      dir = candidate;
      break;
    }
    if (d === root || path.dirname(d) === d) break;
  }
  if (!dir || copied.has(dir)) return;
  copied.add(dir);
  cpSync(dir, path.join(standalone, path.relative(root, dir)), { recursive: true, dereference: true });
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) copyPackage(dep, dir);
}
for (const name of RUNTIME_PACKAGES) copyPackage(name);
console.log(`Copied ${copied.size} run-time packages into the server.`);

// 4. Electron (368 MB), pulled in by the trace of the server's startup code (Playwright can also
// drive Electron apps): never loaded by the server, and the desktop app already is Electron.
rmSync(path.join(standalone, "node_modules", "electron"), { recursive: true, force: true });
// The trace also copies project files the server doesn't use, among them the desktop app and the
// last installer (which would end up inside the next one).
for (const extra of ["desktop", "dist-desktop", "electron-builder.yml", "scripts", "test-data"]) rmSync(path.join(standalone, extra), { recursive: true, force: true });

if (args.includes("--server")) process.exit(0);

// 5. The installer (and, for a release, the GitHub release with it and latest.yml for updates).
// desktop/'s own dependencies (the auto-updater): see desktop/package.json.
execSync("npm install --no-audit --no-fund", { cwd: path.join(root, "desktop"), stdio: "inherit" });
run(`npx electron-builder --win --publish ${args.includes("--release") ? "always" : "never"}`);
