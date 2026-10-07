// GET  /api/ctr/campaigns → { items: { campaign, summary }[], setup }
// POST /api/ctr/campaigns  body: NewCampaign → saves it and runs the first check right away.

import { badRequest, errorResponse, parseNewCampaign } from "@/lib/campaigns/api";
import { collectCampaign, ctrSetup } from "@/lib/campaigns/collect";
import { NotConfiguredError, createCampaign, getCampaign, listCampaigns, listDays } from "@/lib/campaigns/db";
import { summarize } from "@/lib/campaigns/metrics";
import { todayInVietnam } from "@/lib/campaigns/site";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const today = todayInVietnam();
    const campaigns = await listCampaigns();
    const items = await Promise.all(campaigns.map(async (campaign) => ({ campaign, summary: summarize(campaign, await listDays(campaign.id), today) })));
    return Response.json({ items, setup: ctrSetup() });
  } catch (err) {
    // No database yet: an empty list, and the page shows what to connect.
    if (err instanceof NotConfiguredError) return Response.json({ items: [], setup: ctrSetup() });
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }
  const input = parseNewCampaign(body);
  if (typeof input === "string") return badRequest(input);
  try {
    const today = todayInVietnam();
    const campaign = await createCampaign(input, today);
    // First reading right away, so the campaign isn't empty until tomorrow.
    const first = await collectCampaign(campaign, today).catch((err: unknown) => ({ problems: [err instanceof Error ? err.message : String(err)] }));
    return Response.json({ campaign: (await getCampaign(campaign.id)) ?? campaign, problems: first.problems }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
