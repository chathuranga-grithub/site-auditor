// POST /api/auth/login  body: { username, password } → sets the session cookie.
// After 5 wrong passwords for the same username (from the same address) it waits 10 minutes.

import { cookies } from "next/headers";
import { checkLogin } from "@/lib/auth/users";
import { SESSION_COOKIE, createSessionToken, sessionConfigured } from "@/lib/auth/session";

export const runtime = "nodejs";

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;
const fails = new Map<string, { count: number; until: number }>();

export async function POST(request: Request) {
  if (!sessionConfigured()) return Response.json({ error: "Login isn't set up: AUTH_SECRET is missing." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return Response.json({ error: "Enter your username and password." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}|${username.toLowerCase()}`;
  const f = fails.get(key);
  if (f && f.count >= MAX_FAILS && Date.now() < f.until) {
    const min = Math.ceil((f.until - Date.now()) / 60_000);
    return Response.json({ error: `Too many wrong attempts. Try again in ${min} minute${min === 1 ? "" : "s"}.` }, { status: 429 });
  }

  let user;
  try {
    user = await checkLogin(username, password);
  } catch (err) {
    return Response.json({ error: `Can't check the login right now (${err instanceof Error ? err.message : "database error"}).` }, { status: 503 });
  }
  if (!user) {
    const count = (f && Date.now() < f.until ? f.count : 0) + 1;
    fails.set(key, { count, until: Date.now() + LOCK_MS });
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }

  fails.delete(key);
  const { token, expires } = await createSessionToken({ uid: user.id, username: user.username, role: user.role, tools: user.tools });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
  return Response.json({ ok: true, user: { username: user.username, role: user.role, tools: user.tools } });
}
