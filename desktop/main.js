// Site Auditor for Windows (Electron). Runs the app's own server (Next.js standalone, built by
// `npm run desktop:build`) on this computer and shows it in a window. Campaign visits need the real
// Chrome on this computer in the logged-in user's session (a Windows service can't show its windows),
// so the app stays in the tray when its window is closed, and starts when Windows starts.
//
// First start: a setup screen asks for the database link and the secret key (the same on every
// computer); they're kept in this user's app data, encrypted by Windows (safeStorage), never in the
// installer. Updates come from the GitHub repository's releases (electron-updater).

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, safeStorage, shell, utilityProcess } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_PORT = 3210;
const ICON = path.join(__dirname, "icon.png");
/** The server's files: in the installed app, under resources\server; while developing, the last build. */
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, "server", "standalone") : path.join(__dirname, "..", ".next", "standalone");
const CONFIG_FILE = () => path.join(app.getPath("userData"), "config.json");
const LOG_DIR = () => path.join(app.getPath("userData"), "logs");
/** Started from Windows' startup list: straight to the tray, no window. */
const HIDDEN = process.argv.includes("--hidden");

let win = null;
let setupWin = null;
let tray = null;
let server = null;
let serverUrl = null;
let quitting = false;
let toldAboutTray = false;

// ---------------------------------------------------------------------------------------------
// Settings: { databaseUrl, authSecret, port, startAtLogin }, the secrets encrypted.

const SECRET_KEYS = ["databaseUrl", "authSecret"];

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
    const out = { port: saved.port || DEFAULT_PORT, startAtLogin: saved.startAtLogin !== false };
    for (const key of SECRET_KEYS) {
      const v = saved[key];
      if (!v) continue;
      out[key] = saved.encrypted ? safeStorage.decryptString(Buffer.from(v, "base64")) : v;
    }
    return out;
  } catch {
    return { port: DEFAULT_PORT, startAtLogin: true };
  }
}

function writeConfig(config) {
  const encrypted = safeStorage.isEncryptionAvailable();
  const out = { encrypted, port: config.port || DEFAULT_PORT, startAtLogin: config.startAtLogin !== false };
  for (const key of SECRET_KEYS) {
    const v = (config[key] || "").trim();
    if (v) out[key] = encrypted ? safeStorage.encryptString(v).toString("base64") : v;
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(out, null, 2));
}

const configured = (c) => !!(c.databaseUrl && c.authSecret);

/** The app's own events and errors (not the server's): logs\app.log. */
function logApp(message) {
  try {
    fs.mkdirSync(LOG_DIR(), { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR(), "app.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* nowhere to write: nothing more to do */
  }
}
process.on("uncaughtException", (err) => logApp(`error: ${err.stack || err}`));
process.on("unhandledRejection", (err) => logApp(`error: ${(err && err.stack) || err}`));

// ---------------------------------------------------------------------------------------------
// The server

/** The saved port if it's free, else the next free one (saved, so the app's address stays the same). */
async function freePort(from) {
  for (let port = from; port < from + 50; port++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer().once("error", () => resolve(false));
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error(`No free port from ${from}`);
}

/** The server's output, in logs\server.log (the last run's in server.old.log). */
function openLog() {
  fs.mkdirSync(LOG_DIR(), { recursive: true });
  const file = path.join(LOG_DIR(), "server.log");
  try {
    if (fs.statSync(file).size > 0) fs.renameSync(file, path.join(LOG_DIR(), "server.old.log"));
  } catch {
    /* no log yet */
  }
  return fs.createWriteStream(file, { flags: "a" });
}

/** Resolves once the server answers (any page), or rejects after `ms`. */
function waitForServer(url, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${url}/login`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => (Date.now() > until ? reject(new Error("The app's server didn't start.")) : setTimeout(tryOnce, 500)));
      req.setTimeout(5_000, () => req.destroy());
    };
    tryOnce();
  });
}

async function startServer() {
  const config = readConfig();
  const port = await freePort(config.port);
  if (port !== config.port) writeConfig({ ...config, port });
  const log = openLog();
  log.write(`\n=== Site Auditor ${app.getVersion()} · ${new Date().toISOString()} · port ${port} ===\n`);
  server = utilityProcess.fork(path.join(SERVER_DIR, "server.js"), [], {
    cwd: SERVER_DIR,
    stdio: "pipe",
    serviceName: "Site Auditor server",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      // Shown on the Settings page (About this app).
      APP_VERSION: app.getVersion(),
      DATABASE_URL: config.databaseUrl,
      AUTH_SECRET: config.authSecret,
    },
  });
  server.stdout?.on("data", (d) => log.write(d));
  server.stderr?.on("data", (d) => log.write(d));
  server.on("exit", (code) => {
    log.end(`\n=== server stopped (${code}) ===\n`);
    server = null;
    if (quitting) return;
    dialog
      .showMessageBox({ type: "error", title: "Site Auditor", message: "The app's server stopped.", detail: `See the log for why:\n${path.join(LOG_DIR(), "server.log")}`, buttons: ["Restart", "Open log folder", "Quit"] })
      .then(({ response }) => {
        if (response === 0) restartFromMenu();
        else if (response === 1) shell.openPath(LOG_DIR());
        else app.quit();
      });
  });
  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(serverUrl, 90_000);
}

/** Stops the server and everything it started (its Chrome windows too): the whole process tree. */
function stopServer() {
  const s = server;
  server = null;
  if (!s?.pid) return Promise.resolve();
  return new Promise((resolve) => execFile("taskkill", ["/pid", String(s.pid), "/T", "/F"], () => resolve()));
}

/** Starts the server again (e.g. after new settings); throws when it doesn't come up. */
async function restartServer() {
  await stopServer();
  await startServer();
  win?.loadURL(serverUrl);
}

/** restartServer from a menu or a dialog: a failure is shown, not thrown. */
const restartFromMenu = () => restartServer().catch((err) => dialog.showErrorBox("Site Auditor", `${err.message || err}\n\nSee the log in ${LOG_DIR()}`));

// ---------------------------------------------------------------------------------------------
// Windows

function showMain() {
  if (!serverUrl) return showSetup();
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({ width: 1400, height: 900, minWidth: 900, minHeight: 600, title: "Site Auditor", icon: ICON, autoHideMenuBar: true, show: false });
  win.loadURL(serverUrl);
  win.once("ready-to-show", () => win.show());
  // Links to other sites open in the normal browser, not in the app.
  const isApp = (url) => url.startsWith(serverUrl);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isApp(url)) shell.openExternal(url);
    return { action: isApp(url) ? "allow" : "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isApp(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  // Closing the window keeps the app (and its campaigns) running in the tray.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!toldAboutTray) {
      toldAboutTray = true;
      tray?.displayBalloon({ iconType: "info", title: "Site Auditor is still running", content: "Campaigns keep running. Open it again or quit from this icon." });
    }
  });
  win.on("closed", () => (win = null));
}

function showSetup() {
  if (setupWin) return setupWin.focus();
  setupWin = new BrowserWindow({
    width: 620,
    height: 600,
    resizable: false,
    title: "Site Auditor setup",
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  setupWin.loadFile(path.join(__dirname, "setup.html"));
  setupWin.on("closed", () => {
    setupWin = null;
    // Closed without saving on the first start: nothing to run.
    if (!configured(readConfig())) app.quit();
  });
}

ipcMain.handle("setup:load", () => {
  const c = readConfig();
  return { databaseUrl: c.databaseUrl || "", authSecret: c.authSecret || "", startAtLogin: c.startAtLogin, version: app.getVersion() };
});

/** A value as copied from .env.local: without "NAME=" in front or quotes around it. */
const cleanValue = (v, name) =>
  String(v || "")
    .trim()
    .replace(new RegExp(`^${name}\\s*=\\s*`), "")
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();

ipcMain.handle("setup:save", async (_e, values) => {
  // Every failure comes back to the screen as a message (and into logs\app.log), never silently.
  try {
    const databaseUrl = cleanValue(values.databaseUrl, "DATABASE_URL");
    const authSecret = cleanValue(values.authSecret, "AUTH_SECRET");
    if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) return { error: "The database link should start with postgresql://" };
    if (authSecret.length < 16) return { error: "The secret key is too short (copy it exactly as it is on the other computers)." };
    const startAtLogin = values.startAtLogin !== false;
    logApp("setup: saving the settings");
    writeConfig({ ...readConfig(), databaseUrl, authSecret, startAtLogin });
    setStartAtLogin(startAtLogin);
    logApp("setup: starting the server");
    await restartServer();
    logApp(`setup: the server answers on ${serverUrl}`);
    setupWin?.destroy();
    setupWin = null;
    showMain();
    return { ok: true };
  } catch (err) {
    logApp(`setup failed: ${err.stack || err}`);
    return { error: `${err.message || err} (details in ${path.join(LOG_DIR(), "app.log")})` };
  }
});

// ---------------------------------------------------------------------------------------------
// Tray, start at login, updates

function setStartAtLogin(on) {
  if (!app.isPackaged) return; // while developing, Windows would start the bare Electron
  app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(`Site Auditor ${app.getVersion()}`);
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Open Site Auditor", click: showMain },
      { type: "separator" },
      { label: "Settings…", click: showSetup },
      { label: "Open log folder", click: () => shell.openPath(LOG_DIR()) },
      { label: "Restart the server", click: restartFromMenu },
      {
        label: "Start when Windows starts",
        type: "checkbox",
        checked: readConfig().startAtLogin,
        click: (item) => {
          writeConfig({ ...readConfig(), startAtLogin: item.checked });
          setStartAtLogin(item.checked);
        },
      },
      { label: "Check for updates", enabled: app.isPackaged, click: () => checkForUpdates(true) },
      { type: "separator" },
      { label: `Quit (stops campaigns on this computer)`, click: () => app.quit() },
    ]);
  tray.setContextMenu(menu());
  tray.on("right-click", () => tray.setContextMenu(menu()));
  tray.on("double-click", showMain);
}

let updater = null;
function checkForUpdates(manual) {
  if (!app.isPackaged) return;
  if (!updater) {
    updater = require("electron-updater").autoUpdater;
    updater.autoInstallOnAppQuit = true;
    updater.on("update-downloaded", (info) => {
      dialog
        .showMessageBox({
          type: "info",
          title: "Site Auditor",
          message: `Version ${info.version} is ready.`,
          detail: "Restart now to update? (Visits running on this computer stop and start again after the update.)",
          buttons: ["Restart now", "Later (when I quit)"],
        })
        .then(({ response }) => {
          if (response !== 0) return;
          quitting = true;
          stopServer().then(() => updater.quitAndInstall());
        });
    });
  }
  updater.checkForUpdates().then(
    (r) => {
      if (manual && !r?.isUpdateAvailable) dialog.showMessageBox({ type: "info", title: "Site Auditor", message: `You have the latest version (${app.getVersion()}).` });
    },
    (err) => manual && dialog.showErrorBox("Site Auditor", `Couldn't check for updates: ${err.message || err}`),
  );
}

// ---------------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMain);
  app.on("window-all-closed", () => {
    /* stays in the tray */
  });
  app.on("before-quit", (e) => {
    if (quitting || !server) return void (quitting = true);
    e.preventDefault();
    quitting = true;
    stopServer().then(() => app.quit());
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("ae.grithub.siteauditor");
    buildTray();
    const config = readConfig();
    if (!configured(config)) return showSetup();
    setStartAtLogin(config.startAtLogin);
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox("Site Auditor", `${err.message || err}\n\nSee the log in ${LOG_DIR()}`);
    }
    if (!HIDDEN) showMain();
    checkForUpdates(false);
    setInterval(() => checkForUpdates(false), 6 * 60 * 60_000);
  });
}
