// POST /api/proxy-check  body: { proxyApiUrl? }
// Local only: one Proxy Check (next proxy from the provider + a location / ISP / speed test through
// it). The page calls this repeatedly over the chosen time period.

import { checkProxyOnce } from "@/lib/proxy-check";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (process.env.VERCEL) {
    return Response.json({ error: "Proxy Check runs only on a local computer." }, { status: 501 });
  }
  let body: { proxyApiUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const proxyApiUrl = (typeof body.proxyApiUrl === "string" && body.proxyApiUrl.trim()) || process.env.PROXY_API_URL || "";
  if (!proxyApiUrl) {
    return Response.json({ error: "Paste the proxy API link, or save it as PROXY_API_URL in .env.local." }, { status: 400 });
  }
  return Response.json(await checkProxyOnce(proxyApiUrl));
}

/** Lets the page know whether it runs locally and whether a proxy API link is saved (never returns the link). */
export async function GET() {
  return Response.json({ local: !process.env.VERCEL, savedProxyApi: !!process.env.PROXY_API_URL });
}
