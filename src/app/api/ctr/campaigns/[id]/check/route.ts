// POST /api/ctr/campaigns/:id/check → runs today's check now (Google in a browser through the proxy),
// on the computer that runs the campaign only.

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { collectCampaign } from "@/lib/campaigns/collect";
import { getCampaign } from "@/lib/campaigns/db";
import { notHere, runsHere } from "@/lib/campaigns/visits";
import { todayInVietnam } from "@/lib/campaigns/site";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    // One computer checks it (its own ranking checks and proxy links), not two at once.
    if (!(await runsHere(campaign))) return Response.json({ error: notHere(campaign) }, { status: 409 });
    return Response.json(await collectCampaign(campaign, todayInVietnam()));
  } catch (err) {
    return errorResponse(err);
  }
}
