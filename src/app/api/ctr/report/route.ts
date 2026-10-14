// GET /api/ctr/report?period=week&site=all&pc=all → the Auto CTR report as an A4 PDF (a download): the
// report page (/ctr/report, same filters) opened in headless Chrome as the signed-in user and printed,
// with page numbers. Needs Chrome on the computer (the desktop app, `npm run dev`); on Vercel there's
// none: 501, and the page uses the browser's own "Save as PDF" instead.

import { cookies } from "next/headers";
import { chromium, type Browser } from "playwright-core";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { errorResponse } from "@/lib/campaigns/api";
import { PERIOD_LABELS, parseFilters, reportUrl } from "@/lib/campaigns/report-filters";
import { todayInVietnam } from "@/lib/campaigns/site";

export const runtime = "nodejs";
export const maxDuration = 120;

/** How long the report may take to load its numbers (the database can take a moment to wake up). */
const READY_MS = 90_000;

async function launch(): Promise<Browser> {
  let last: unknown;
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

export async function GET(request: Request) {
  if (process.env.VERCEL) return Response.json({ error: "PDFs are made by the desktop app; use the browser's Save as PDF here." }, { status: 501 });
  const url = new URL(request.url);
  const filters = parseFilters(url.searchParams);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return Response.json({ error: "Please sign in." }, { status: 401 });
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
    await context.addCookies([{ name: SESSION_COOKIE, value: session, domain: url.hostname, path: "/" }]);
    const page = await context.newPage();
    await page.goto(new URL(reportUrl(filters), url.origin).toString(), { waitUntil: "domcontentloaded", timeout: READY_MS });
    await page.waitForSelector("[data-report-ready]", { timeout: READY_MS });
    await page.evaluate(() => document.fonts.ready);
    const footer = `<div style="width:100%;font-size:8px;color:#94a3b8;padding:0 12mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif">
      <span>SEO Toolkit · Auto CTR report · ${PERIOD_LABELS[filters.period]}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: footer,
      margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    const name = `auto-ctr-report-${filters.period}-${todayInVietnam()}.pdf`;
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  } finally {
    await browser?.close().catch(() => {});
  }
}
