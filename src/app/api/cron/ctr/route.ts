// GET /api/cron/ctr — called once a day by Vercel Cron (vercel.json). Checks every active campaign:
// Search Console / GA4 and the end date. The Google position needs a browser, so on Vercel it's
// skipped; the computer running the app checks it (src/lib/campaigns/scheduler.ts).
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; anything else is refused.

import { errorResponse } from "@/lib/campaigns/api";
import { collectCampaign } from "@/lib/campaigns/collect";
import { listCampaigns } from "@/lib/campaigns/db";
import { todayInVietnam } from "@/lib/campaigns/site";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    const today = todayInVietnam();
    const active = (await listCampaigns()).filter((c) => c.status === "active");
    const results = [];
    for (const c of active) {
      results.push(await collectCampaign(c, today).catch((err: unknown) => ({ campaignId: c.id, problems: [err instanceof Error ? err.message : String(err)] })));
    }
    return Response.json({ day: today, checked: results.length, results });
  } catch (err) {
    return errorResponse(err);
  }
}
