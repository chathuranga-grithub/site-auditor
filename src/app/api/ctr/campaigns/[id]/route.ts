// GET    /api/ctr/campaigns/:id → { campaign, days, notes }
// PATCH  /api/ctr/campaigns/:id  body: { status: "active" | "paused" | "stopped" }
//        "stopped" ends it early, for good. "finished" is set only by the daily check, at the end date.
// DELETE /api/ctr/campaigns/:id

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { deleteCampaign, getCampaign, listDays, listNotes, setCampaignStatus } from "@/lib/campaigns/db";
import { forgetCampaignVisit, startCampaignVisit, stopCampaignVisit } from "@/lib/campaigns/visits";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    const [days, notes] = await Promise.all([listDays(id), listNotes(id)]);
    return Response.json({ campaign, days, notes });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  if (body.status !== "active" && body.status !== "paused" && body.status !== "stopped") return badRequest("That action isn't available for this campaign.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "finished" || campaign.status === "stopped") return badRequest(`This campaign has ${campaign.status === "stopped" ? "been stopped" : "finished"}, so it can't be changed.`);
    await setCampaignStatus(id, body.status);
    // Active runs the visit; paused or stopped ends it.
    if (body.status === "active") {
      if (campaign.status !== "active") startCampaignVisit(campaign);
    } else stopCampaignVisit(id);
    return Response.json({ campaign: await getCampaign(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    forgetCampaignVisit(id);
    await deleteCampaign(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
