// GET /api/ctr/campaigns/:id/heartbeat → { status, here, computerName, visit, at }: whether the campaign and its visit
// are up right now. The campaign page asks every 5 minutes while an active campaign is open.

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { getCampaign } from "@/lib/campaigns/db";
import { campaignVisitStatus, canRunVisits, runsHere } from "@/lib/campaigns/visits";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    return Response.json(
      { status: campaign.status, canRunVisits: canRunVisits(), here: await runsHere(campaign), computerName: campaign.computerName, visit: campaignVisitStatus(id), at: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
