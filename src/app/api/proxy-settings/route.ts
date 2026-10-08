// The saved proxy API links: one or more (stored encrypted in the database).
// GET → { saved, source, hints, unreadable?, updatedBy?, updatedAt? }
// POST { proxyApiUrls: "pasted list", mode: "add" | "replace" } → save
// DELETE ?index=N → remove link N (0-based); DELETE → remove all   (admins only)
// The full links are never returned, only hints (host + last 4 characters).

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { MAX_PROXY_APIS, isValidProxyApi, parseProxyApiList, proxyApiStatus, readSavedProxyApis, removeSavedProxyApi, saveProxyApis } from "@/lib/proxy-settings";

export const runtime = "nodejs";

/** Changing the link is an admin setting (Settings page). */
async function admin() {
  const s = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return s?.role === "admin" ? s : null;
}
const forbidden = () => Response.json({ error: "Only an admin can change the proxy links (Settings)." }, { status: 403 });
const badRequest = (error: string) => Response.json({ error }, { status: 400 });
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
  let body: { proxyApiUrls?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }
  const pasted = parseProxyApiList(typeof body.proxyApiUrls === "string" ? body.proxyApiUrls : "");
  if (!pasted.length) return badRequest("Paste at least one proxy API link.");
  const bad = pasted.findIndex((u) => !isValidProxyApi(u));
  if (bad >= 0) return badRequest(`Link ${bad + 1} isn't a valid proxy API link (each should start with https://).`);
  try {
    // Add: after the saved links (a link already saved isn't added twice). Replace: the pasted list only.
    const urls = body.mode === "add" ? [...new Set([...(await readSavedProxyApis()), ...pasted])] : pasted;
    if (urls.length > MAX_PROXY_APIS) return badRequest(`At most ${MAX_PROXY_APIS} proxy API links can be saved (this would be ${urls.length}).`);
    await saveProxyApis(urls, who.username);
    return Response.json(await proxyApiStatus());
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(request: Request) {
  const who = await admin();
  if (!who) return forbidden();
  const raw = new URL(request.url).searchParams.get("index");
  try {
    if (raw === null) await removeSavedProxyApi();
    else {
      const urls = await readSavedProxyApis();
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 0 || index >= urls.length) return badRequest("There's no saved link with that number.");
      await saveProxyApis(urls.filter((_, i) => i !== index), who.username);
    }
    return Response.json(await proxyApiStatus());
  } catch (err) {
    return failed(err);
  }
}
