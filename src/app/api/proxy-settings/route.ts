// The saved proxy API link (stored encrypted in the database).
// GET → { saved, source, hint, unreadable?, updatedBy?, updatedAt? }
// POST { proxyApiUrl } → save   DELETE → remove   (admins only)
// The full link is never returned, only a hint (host + last 4 characters).

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { isValidProxyApi, proxyApiStatus, removeSavedProxyApi, saveProxyApi } from "@/lib/proxy-settings";

export const runtime = "nodejs";

/** Changing the link is an admin setting (Settings page). */
async function admin() {
  const s = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return s?.role === "admin" ? s : null;
}
const forbidden = () => Response.json({ error: "Only an admin can change the proxy link (Settings)." }, { status: 403 });
const failed = (err: unknown) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });

export async function GET() {
  try {
    return Response.json(await proxyApiStatus());
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  const who = await admin();
  if (!who) return forbidden();
  let body: { proxyApiUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const url = typeof body.proxyApiUrl === "string" ? body.proxyApiUrl.trim() : "";
  if (!isValidProxyApi(url)) return Response.json({ error: "That isn't a valid proxy API link (it should start with https://)." }, { status: 400 });
  try {
    await saveProxyApi(url, who.username);
    return Response.json(await proxyApiStatus());
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE() {
  if (!(await admin())) return forbidden();
  try {
    await removeSavedProxyApi();
    return Response.json(await proxyApiStatus());
  } catch (err) {
    return failed(err);
  }
}
