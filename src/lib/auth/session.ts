// Login session: a signed cookie { uid, username, role, exp }. Signed with HMAC-SHA256 using
// AUTH_SECRET, so it can't be forged or edited; httpOnly, so page scripts can't read it.
// Web Crypto only, so it works in the proxy as well as in route handlers.

import { isToolId, type ToolId } from "./permissions";

export const SESSION_COOKIE = "seo_auditor_session";
export const SESSION_DAYS = 7;

export type Role = "admin" | "user";

export interface Session {
  uid: number;
  username: string;
  role: Role;
  /** Tools this account may use; null = all (admins). */
  tools: ToolId[] | null;
  /** Expiry, seconds since 1970. */
  exp: number;
}

const enc = new TextEncoder();

function secret(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 32 ? s : null;
}

export function sessionConfigured(): boolean {
  return secret() !== null;
}

async function hmac(data: string): Promise<string> {
  const s = secret();
  if (!s) throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  const key = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export async function createSessionToken(user: { uid: number; username: string; role: Role; tools: ToolId[] | null }): Promise<{ token: string; expires: Date }> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
  const body = b64url(enc.encode(JSON.stringify({ ...user, exp })));
  return { token: `${body}.${await hmac(body)}`, expires: new Date(exp * 1000) };
}

/** The session in a cookie value, or null if missing, forged, edited or expired. */
export async function readSessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token || !secret()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof s.uid !== "number" || typeof s.username !== "string" || (s.role !== "admin" && s.role !== "user")) return null;
    if (s.tools !== null && !(Array.isArray(s.tools) && s.tools.every(isToolId))) return null;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Only same-site paths after login, so the login page can't be used to send people elsewhere. */
export function safeNextPath(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}
