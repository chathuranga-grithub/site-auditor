// Server-only, local only: the devices a campaign visit is made on. Each visit picks one at random:
// a phone (Android or iPhone) or a computer (Windows or Mac), then a model, each with its own screen
// size, pixel density, touch, and browser identity (user agent, client hints, navigator.platform).
// The browser is always the real Google Chrome on this computer: Android, Windows and Mac are Chrome
// there too, so they match closely, with the user agent built from the real Chrome version. An iPhone
// gets Safari's identity and an iPhone screen, but the engine underneath is still Chrome's.

import { devices, type BrowserContext, type BrowserContextOptions, type Page } from "playwright-core";
import type { VisitDevice } from "./visit-types";

export type DeviceKind = "android" | "iphone" | "windows" | "mac";

export interface DeviceProfile {
  /** Shown in the console, e.g. "Samsung Galaxy S24 (Android 14)". */
  name: string;
  kind: DeviceKind;
  /** Screen, pixel density and touch, for the browser (the identity is set on each page). */
  screen: Pick<BrowserContextOptions, "viewport" | "screen" | "deviceScaleFactor" | "isMobile" | "hasTouch">;
  /** Android / iOS / Windows / macOS version: in the user agent and client hints. */
  osVersion: string;
  /** Android phones: the model code in the client hints (e.g. SM-S921B). */
  model?: string;
  /**
   * The graphics chip the device's browser reports (WebGL), as it reports it. None for a Windows PC:
   * this computer's own is shown, and it is one.
   */
  gpu?: { vendor: string; renderer: string };
}

// Graphics chips, as each device's browser reports them (WebGL's unmasked vendor and renderer).
const XCLIPSE_940 = { vendor: "Samsung Electronics Co., Ltd.", renderer: "Samsung Xclipse 940" };
const ADRENO_740 = { vendor: "Qualcomm", renderer: "Adreno (TM) 740" };
const XCLIPSE_530 = { vendor: "Samsung Electronics Co., Ltd.", renderer: "Samsung Xclipse 530" };
const ADRENO_610 = { vendor: "Qualcomm", renderer: "Adreno (TM) 610" };
const MALI_G710 = { vendor: "ARM", renderer: "Mali-G710" };
const MALI_G715 = { vendor: "ARM", renderer: "Mali-G715" };
const APPLE_GPU = { vendor: "Apple Inc.", renderer: "Apple GPU" };
const appleM = (chip: string) => ({ vendor: "Google Inc. (Apple)", renderer: `ANGLE (Apple, ANGLE Metal Renderer: Apple ${chip}, Unspecified Version)` });

/** Share of phone visits on Android (the rest on an iPhone), and of computer visits on Windows (the rest on a Mac), in Vietnam. */
const ANDROID_SHARE = 0.7;
const WINDOWS_SHARE = 0.85;

/** Screen, density and touch from Playwright's list (its user agents carry a fixed Chrome version, so aren't used). */
function phoneScreen(name: string): DeviceProfile["screen"] {
  const d = devices[name];
  if (!d) throw new Error(`Unknown device: ${name}`);
  const screen = (d as { screen?: { width: number; height: number } }).screen;
  return { viewport: d.viewport, ...(screen ? { screen } : {}), deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true };
}

const ANDROID: DeviceProfile[] = [
  { name: "Samsung Galaxy S24", kind: "android", screen: phoneScreen("Galaxy S24"), osVersion: "14", model: "SM-S921B", gpu: XCLIPSE_940 },
  { name: "Samsung Galaxy S23", kind: "android", screen: phoneScreen("Galaxy S24"), osVersion: "14", model: "SM-S911B", gpu: ADRENO_740 },
  { name: "Samsung Galaxy A55", kind: "android", screen: phoneScreen("Galaxy A55"), osVersion: "14", model: "SM-A556E", gpu: XCLIPSE_530 },
  {
    name: "Xiaomi Redmi Note 13",
    kind: "android",
    screen: { viewport: { width: 393, height: 783 }, screen: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
    osVersion: "14",
    model: "23129RAA4G",
    gpu: ADRENO_610,
  },
  { name: "Google Pixel 7", kind: "android", screen: phoneScreen("Pixel 7"), osVersion: "14", model: "Pixel 7", gpu: MALI_G710 },
  { name: "Google Pixel 8", kind: "android", screen: phoneScreen("Pixel 8"), osVersion: "15", model: "Pixel 8", gpu: MALI_G715 },
];

const IPHONE: DeviceProfile[] = [
  { name: "iPhone 13", kind: "iphone", screen: phoneScreen("iPhone 13"), osVersion: "18_6", gpu: APPLE_GPU },
  { name: "iPhone 14", kind: "iphone", screen: phoneScreen("iPhone 14"), osVersion: "18_6", gpu: APPLE_GPU },
  { name: "iPhone 15", kind: "iphone", screen: phoneScreen("iPhone 15"), osVersion: "18_6", gpu: APPLE_GPU },
  { name: "iPhone 15 Pro", kind: "iphone", screen: phoneScreen("iPhone 15 Pro"), osVersion: "18_6", gpu: APPLE_GPU },
  { name: "iPhone 16", kind: "iphone", screen: phoneScreen("iPhone 16"), osVersion: "18_6", gpu: APPLE_GPU },
];

/** A computer's screen; the page area is smaller (the browser's own bars and the taskbar / menu bar). */
const desktop = (width: number, height: number, scale: number, bars: number): DeviceProfile["screen"] => ({
  viewport: { width, height: height - bars },
  screen: { width, height },
  deviceScaleFactor: scale,
  isMobile: false,
  hasTouch: false,
});

const WINDOWS: DeviceProfile[] = [
  { name: "Windows PC 1366×768", kind: "windows", screen: desktop(1366, 768, 1, 135), osVersion: "10.0.0" },
  { name: "Windows PC 1536×864", kind: "windows", screen: desktop(1536, 864, 1.25, 135), osVersion: "15.0.0" },
  { name: "Windows PC 1920×1080", kind: "windows", screen: desktop(1920, 1080, 1, 135), osVersion: "15.0.0" },
  { name: "Windows PC 1600×900", kind: "windows", screen: desktop(1600, 900, 1, 135), osVersion: "15.0.0" },
  { name: "Windows laptop 1280×720", kind: "windows", screen: desktop(1280, 720, 1, 135), osVersion: "10.0.0" },
];

const MAC: DeviceProfile[] = [
  { name: "MacBook Air 1440×900", kind: "mac", screen: desktop(1440, 900, 2, 110), osVersion: "15.5.0", gpu: appleM("M2") },
  { name: "MacBook Pro 1512×982", kind: "mac", screen: desktop(1512, 982, 2, 110), osVersion: "15.5.0", gpu: appleM("M3 Pro") },
  { name: "MacBook Air 1470×956", kind: "mac", screen: desktop(1470, 956, 2, 110), osVersion: "14.7.0", gpu: appleM("M3") },
];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random device for a visit on a phone or a computer. */
export function pickDevice(device: VisitDevice): DeviceProfile {
  if (device === "phone") return pick(Math.random() < ANDROID_SHARE ? ANDROID : IPHONE);
  return pick(Math.random() < WINDOWS_SHARE ? WINDOWS : MAC);
}

/** "Samsung Galaxy S24 (Android 14)", "iPhone 15 (iOS 18.6)", "Windows PC 1920×1080". */
export function deviceLabel(d: DeviceProfile): string {
  if (d.kind === "android") return `${d.name} (Android ${d.osVersion})`;
  if (d.kind === "iphone") return `${d.name} (iOS ${d.osVersion.replace("_", ".")})`;
  return d.name;
}

/** Chrome adds the q= weights itself. */
const ACCEPT_LANGUAGE = "vi-VN,vi,en-US,en";

/** The identity Chrome gives a page on this device: user agent, navigator.platform, client hints. */
function identity(d: DeviceProfile, chrome: string) {
  const major = chrome.split(".")[0];
  const brands = (v: string) => [
    { brand: "Google Chrome", version: v },
    { brand: "Chromium", version: v },
    { brand: "Not)A;Brand", version: major === v ? "24" : "24.0.0.0" },
  ];
  const hints = (platform: string, platformVersion: string, architecture: string, model: string, mobile: boolean) => ({
    brands: brands(major),
    fullVersionList: brands(chrome),
    fullVersion: chrome,
    platform,
    platformVersion,
    architecture,
    model,
    mobile,
    bitness: architecture ? "64" : "",
    wow64: false,
  });
  switch (d.kind) {
    case "android":
      // Chrome on Android hides the model and version in the user agent ("Android 10; K"); the client hints carry them.
      return {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`,
        platform: "Linux armv81",
        userAgentMetadata: hints("Android", `${d.osVersion}.0.0`, "", d.model ?? "", true),
      };
    case "iphone":
      // Safari sends no client hints.
      return {
        userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS ${d.osVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${d.osVersion.split("_")[0]}.${d.osVersion.split("_")[1] ?? "0"} Mobile/15E148 Safari/604.1`,
        platform: "iPhone",
      };
    case "mac":
      return {
        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
        platform: "MacIntel",
        userAgentMetadata: hints("macOS", d.osVersion, "arm", "", false),
      };
    default:
      return {
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
        platform: "Win32",
        userAgentMetadata: hints("Windows", d.osVersion, "x86", "", false),
      };
  }
}

// Per page, once: newPage and the "page" event both ask, and both wait for the same one.
const applied = new WeakMap<Page, Promise<void>>();
// Per context acting as a device: the user agent its pages get, for downloads made outside a page (the
// sitemap). Known once its first page has it.
const userAgents = new WeakMap<BrowserContext, { ua: Promise<string>; set(ua: string): void }>();

/** The user agent the context's pages use as this device; null when it isn't acting as one. */
export function deviceUserAgent(context: BrowserContext): Promise<string> | null {
  return userAgents.get(context)?.ua ?? null;
}

/** Gives the page the device's identity, before it opens anything. */
function applyDevice(page: Page, d: DeviceProfile): Promise<void> {
  let done = applied.get(page);
  if (!done) {
    done = (async () => {
      const cdp = await page.context().newCDPSession(page);
      const { product } = (await cdp.send("Browser.getVersion")) as { product: string };
      const chrome = product.split("/")[1] ?? "140.0.0.0";
      const id = identity(d, chrome);
      await cdp.send("Emulation.setUserAgentOverride", { ...id, acceptLanguage: ACCEPT_LANGUAGE });
      userAgents.get(page.context())?.set(id.userAgent);
      // A phone's screen takes several fingers (5), not the 1 of touch emulation.
      if (d.screen.hasTouch) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    })();
    applied.set(page, done);
  }
  return done;
}

/**
 * Runs in every page before its own scripts: WebGL reports this graphics chip (its unmasked vendor and
 * renderer, which sites read to tell devices apart). The replaced function still looks built in.
 * Self-contained: it's sent to the page as text.
 */
function reportGpu({ vendor, renderer }: { vendor: string; renderer: string }): void {
  const VENDOR = 0x9245; // UNMASKED_VENDOR_WEBGL
  const RENDERER = 0x9246; // UNMASKED_RENDERER_WEBGL
  for (const proto of [WebGLRenderingContext.prototype, typeof WebGL2RenderingContext === "undefined" ? null : WebGL2RenderingContext.prototype]) {
    if (!proto) continue;
    const original = proto.getParameter;
    const getParameter = function (this: WebGLRenderingContext, p: GLenum) {
      if (p === VENDOR) return vendor;
      if (p === RENDERER) return renderer;
      return original.call(this, p);
    };
    Object.defineProperty(getParameter, "name", { value: "getParameter" });
    Object.defineProperty(getParameter, "toString", { value: () => "function getParameter() { [native code] }" });
    Object.defineProperty(proto, "getParameter", { value: getParameter, writable: true, configurable: true, enumerable: true });
  }
}

/**
 * Every page the context opens gets the device's identity: pages the app opens (newPage) before they
 * load anything; pages a site opens itself (a link in a new tab) as soon as they appear.
 */
export function actAsDevice(context: BrowserContext, d: DeviceProfile): void {
  let set!: (ua: string) => void;
  userAgents.set(context, { ua: new Promise<string>((resolve) => (set = resolve)), set: (ua) => set(ua) });
  // Safari has no navigator.userAgentData at all (Chrome's would be there, empty).
  const noHints = d.kind === "iphone" ? context.addInitScript(() => void delete (Navigator.prototype as { userAgentData?: unknown }).userAgentData).catch(() => {}) : null;
  // The device's own graphics chip (a phone reporting this computer's would give it away).
  const gpu = d.gpu ? context.addInitScript(reportGpu, d.gpu).catch(() => {}) : null;
  const ready = Promise.all([noHints, gpu]);
  const newPage = context.newPage.bind(context);
  context.newPage = async () => {
    await ready;
    const page = await newPage();
    await applyDevice(page, d);
    return page;
  };
  context.on("page", (page) => void applyDevice(page, d).catch(() => {}));
}
