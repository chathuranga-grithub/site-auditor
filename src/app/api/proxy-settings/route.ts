// Local only: the saved proxy API link.
// GET → { local, saved, source, hint }   POST { proxyApiUrl } → save   DELETE → remove
// The full link is never returned, only a hint (host + last 4 characters).

import { isValidProxyApi, proxyApiStatus, removeSavedProxyApi, saveProxyApi } from "@/lib/proxy-settings";

export const runtime = "nodejs";

const localOnly = () => Response.json({ error: "Saving the proxy link only works when the app runs on a computer." }, { status: 501 });

export async function GET() {
  if (process.env.VERCEL) return Response.json({ local: false, saved: false, source: null, hint: null });
  return Response.json({ local: true, ...(await proxyApiStatus()) });
}

export async function POST(request: Request) {
  if (process.env.VERCEL) return localOnly();
  let body: { proxyApiUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const url = typeof body.proxyApiUrl === "string" ? body.proxyApiUrl.trim() : "";
  if (!isValidProxyApi(url)) return Response.json({ error: "That isn't a valid proxy API link (it should start with https://)." }, { status: 400 });
  await saveProxyApi(url);
  return Response.json({ local: true, ...(await proxyApiStatus()) });
}

export async function DELETE() {
  if (process.env.VERCEL) return localOnly();
  await removeSavedProxyApi();
  return Response.json({ local: true, ...(await proxyApiStatus()) });
}
