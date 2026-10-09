// GET  /api/ctr/campaigns → { items: { campaign, summary }[], setup }
// POST /api/ctr/campaigns  body: NewCampaign → saves it (run by this computer), starts its visits, and
//   starts the first check in the background (the page doesn't wait for the Google search).

import { badRequest, errorResponse, parseNewCampaign } from "@/lib/campaigns/api";
import { collectCampaign, ctrSetup } from "@/lib/campaigns/collect";
import { NotConfiguredError, createCampaign, listCampaigns, listDaysFor } from "@/lib/campaigns/db";
import { summarize } from "@/lib/campaigns/metrics";
import { todayInVietnam } from "@/lib/campaigns/site";
import { startCampaignVisit } from "@/lib/campaigns/visits";
import { thisComputer } from "@/lib/this-computer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const today = todayInVietnam();
    const setup = ctrSetup();
    const campaigns = await listCampaigns();
    const days = await listDaysFor(campaigns.map((c) => c.id));
    const items = campaigns.map((campaign) => ({ campaign, summary: summarize(campaign, days.get(campaign.id) ?? [], today) }));
    return Response.json({ items, setup: await setup });
  } catch (err) {
    // No database yet: an empty list, and the page shows what to connect.
    if (err instanceof NotConfiguredError) return Response.json({ items: [], setup: await ctrSetup() });
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
  const input = parseNewCampaign(body, (await ctrSetup()).proxyApis);
  if (typeof input === "string") return badRequest(input);
  try {
    const today = todayInVietnam();
    // It runs on this computer (on Vercel: none, the first computer that starts takes it).
    const campaign = await createCampaign(input, today, await thisComputer());
    // An active campaign runs its visit through the proxy (on the server; pages follow its console).
    startCampaignVisit(campaign);
    // First reading right away, so the campaign isn't empty until tomorrow. In the background: the
    // Google search takes a while (and waits for a free proxy link), and the page shouldn't wait for it.
    void collectCampaign(campaign, today).catch((err: unknown) => console.error(`Campaign ${campaign.id}: first check failed:`, err));
    return Response.json({ campaign, problems: [] }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
