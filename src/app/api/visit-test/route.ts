// POST /api/visit-test  body: { url, proxyApiUrl? }
// Local only: visits every page of the site in a real browser through a proxy (src/lib/visit-runner.ts) and
// streams progress as newline-delimited JSON (VisitEvent per line). One test at a time.

import { ProxyWaitError } from "@/lib/proxy-api";
import { isBlockedHost, parseSiteUrl } from "@/lib/url";
import { runVisitTest } from "@/lib/visit-runner";
import type { VisitEvent } from "@/lib/visit-types";

export const runtime = "nodejs";
// A full-site run can take a while; this route only runs locally, where there is no limit.
export const maxDuration = 300;

let running = false;

export async function POST(request: Request) {
  if (process.env.VERCEL) {
    return Response.json({ error: "Visit Test runs only on a local computer (it needs a real browser)." }, { status: 501 });
  }
  if (running) return Response.json({ error: "A visit test is already running. Wait for it to finish." }, { status: 409 });

  let body: { url?: unknown; proxyApiUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const site = typeof body.url === "string" ? parseSiteUrl(body.url) : null;
  if (!site || !site.hostname.includes(".")) return Response.json({ error: "Enter the website URL to test." }, { status: 400 });
  if (isBlockedHost(site.hostname)) return Response.json({ error: "That address isn't allowed." }, { status: 403 });

  const proxyApiUrl = (typeof body.proxyApiUrl === "string" && body.proxyApiUrl.trim()) || process.env.PROXY_API_URL || "";
  if (!proxyApiUrl) {
    return Response.json({ error: "Paste the proxy API link, or save it as PROXY_API_URL in .env.local." }, { status: 400 });
  }

  running = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: VisitEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          /* client went away */
        }
      };
      try {
        const report = await runVisitTest({ url: site.toString(), proxyApiUrl, signal: request.signal, send });
        // Screenshots were already streamed with each page; leaving them out avoids sending megabytes twice.
        const strip = <T extends { screenshot?: string }>(p: T): T => ({ ...p, screenshot: undefined });
        send({ type: "done", report: { ...report, start: report.start && strip(report.start), pages: report.pages.map(strip) } });
      } catch (err) {
        if (err instanceof ProxyWaitError) send({ type: "wait", seconds: err.waitSec });
        else send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        running = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Lets the page know whether a proxy API link is saved in .env.local (never returns the link). */
export async function GET() {
  return Response.json({ local: !process.env.VERCEL, savedProxyApi: !!process.env.PROXY_API_URL });
}
