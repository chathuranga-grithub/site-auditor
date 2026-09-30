// URL helpers shared by the API routes and the browser crawler.
// - normalize URLs so the same page always compares equal (strip hash, trailing slash, etc.)
// - decide whether a link is internal (same host as the audited site)
// - skip WordPress system URLs and static files that aren't worth crawling
// - block private/loopback hosts so /api/fetch can't be used for SSRF

/**
 * Turns a URL into a comparison key, so different spellings of the same page match.
 * Relative URLs are resolved against `base`. Returns null for invalid or non-http(s) URLs.
 *
 * The key always uses https:// so http and https compare equal. Query params are sorted.
 *
 *   normalizeUrl("http://WWW.Example.com/about/")             -> "https://example.com/about"
 *   normalizeUrl("https://example.com/about#team")            -> "https://example.com/about"
 *   normalizeUrl("https://example.com/")                      -> "https://example.com/"
 *   normalizeUrl("https://example.com")                       -> "https://example.com/"
 *   normalizeUrl("https://example.com/p/?utm_source=x&b=2&a=1") -> "https://example.com/p?a=1&b=2"
 *   normalizeUrl("https://example.com/post/?replytocom=42")   -> "https://example.com/post"
 *   normalizeUrl("../contact/", "https://example.com/blog/x/") -> "https://example.com/blog/contact"
 *   normalizeUrl("mailto:hi@example.com")                     -> null
 */
export function normalizeUrl(url: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  // URL already lowercases the hostname and drops default ports.
  const host = stripWww(u.hostname);
  const port = u.port ? `:${u.port}` : "";

  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";

  const params = [...u.searchParams]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(params).toString();

  return `https://${host}${port}${path}${query ? `?${query}` : ""}`;
}

/** Parses user input like "example.com" or "https://example.com/blog". Adds https:// if no scheme. */
export function parseSiteUrl(input: string): URL | null {
  const raw = input.trim();
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** True if `url` is on the audited site. "www." is ignored on both sides. */
export function isInternal(url: string, siteHost: string): boolean {
  try {
    return stripWww(new URL(url).hostname) === stripWww(siteHost.toLowerCase());
  } catch {
    return false;
  }
}

const SKIP_PATHS = [
  /\/wp-admin(\/|$)/,
  /\/wp-login\.php$/,
  /\/wp-json(\/|$)/,
  /\/xmlrpc\.php$/,
  /\/feed(\/|$)/,
  /\/comment-page-/,
];

const SKIP_EXTENSIONS = /\.(jpe?g|png|webp|svg|gif|pdf|zip|css|js|mp4)$/;

/** True for WordPress system URLs and static files the crawler shouldn't fetch. Invalid URLs are skipped too. */
export function shouldSkipCrawl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return true;
  }
  return SKIP_PATHS.some((re) => re.test(path)) || SKIP_EXTENSIONS.test(path);
}

/**
 * SSRF guard: true for loopback, private, and link-local hosts.
 * Pass `new URL(x).hostname`. The URL parser rewrites tricks like "http://2130706433/"
 * to "127.0.0.1", and this check relies on that.
 *
 * This only checks the hostname as written. A public name whose DNS points at a private IP
 * gets through, so the fetch route should also check the resolved address.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.includes(":")) return isBlockedIpv6(h);

  const v4 = parseIpv4(h);
  return v4 ? isBlockedIpv4(v4) : false;
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || k === "replytocom";
}

function parseIpv4(h: string): number[] | null {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function isBlockedIpv4([a, b]: number[]): boolean {
  return (
    a === 127 || // loopback
    a === 10 ||
    a === 0 || // 0.0.0.0 reaches localhost on many systems
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) // link-local, includes cloud metadata 169.254.169.254
  );
}

function isBlockedIpv6(h: string): boolean {
  if (h === "::1" || h === "::") return true;
  if (/^f[cd]/.test(h)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local

  // IPv4-mapped, e.g. ::ffff:127.0.0.1 (the URL parser writes it as ::ffff:7f00:1)
  const mapped = h.match(/^::ffff:(.+)$/);
  if (mapped) {
    const dotted = parseIpv4(mapped[1]);
    if (dotted) return isBlockedIpv4(dotted);
    const hex = mapped[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
  }
  return false;
}
