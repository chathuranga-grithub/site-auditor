// GET    /api/ctr/campaigns/:id → { campaign, days, notes, here, canRunHere }
//        here: this computer runs it (visits, ranking checks); canRunHere: it could ("Run on this computer").
// PATCH  /api/ctr/campaigns/:id  body: { status: "active" | "paused" | "stopped" }
//        "stopped" ends it early, for good. "finished" is set only by the daily check, at the end date.
//        From another computer, only the status is saved: the computer that runs it picks it up within
//        a minute (src/lib/campaigns/scheduler.ts).
// PATCH  /api/ctr/campaigns/:id  body: { move: true } → it runs on this computer from now on.
// DELETE /api/ctr/campaigns/:id

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { deleteCampaign, getCampaign, listDays, listNotes, moveCampaign, setCampaignStatus } from "@/lib/campaigns/db";
import { canRunVisits, forgetCampaignVisit, runsHere, startCampaignVisit, stopCampaignVisit } from "@/lib/campaigns/visits";
import { thisComputer } from "@/lib/this-computer";
import { stopCampaignCheck } from "@/lib/campaigns/collect";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    const [days, notes] = await Promise.all([listDays(id), listNotes(id)]);
    return Response.json({ campaign, days, notes, here: await runsHere(campaign), canRunHere: canRunVisits() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  const body = (await request.json().catch(() => ({}))) as { status?: unknown; move?: unknown };
  if (body.move === true) return moveHere(id);
  if (body.status !== "active" && body.status !== "paused" && body.status !== "stopped") return badRequest("That action isn't available for this campaign.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "finished" || campaign.status === "stopped") return badRequest(`This campaign has ${campaign.status === "stopped" ? "been stopped" : "finished"}, so it can't be changed.`);
    await setCampaignStatus(id, body.status);
    // Active runs the visit; paused or stopped ends everything the campaign has running: its visits
    // and its ranking check (their browsers close). Only here when it runs here.
    if (!(await runsHere(campaign))) {
      // Another computer runs it: it picks the change up by itself.
    } else if (body.status === "active") {
      if (campaign.status !== "active") startCampaignVisit(campaign);
    } else {
      stopCampaignVisit(id);
      stopCampaignCheck(id);
    }
    return Response.json({ campaign: await getCampaign(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** "Run on this computer": the campaign moves here; the computer that ran it ends its visit within a minute. */
async function moveHere(id: number) {
  const me = canRunVisits() ? await thisComputer() : null;
  if (!me) return badRequest("Campaigns only run on a computer with the app installed, not here.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "finished" || campaign.status === "stopped") return badRequest(`This campaign has ${campaign.status === "stopped" ? "been stopped" : "finished"}, so it doesn't run anywhere.`);
    if (await runsHere(campaign)) return Response.json({ campaign });
    const moved = await moveCampaign(id, me);
    if (moved?.status === "active") startCampaignVisit(moved);
    return Response.json({ campaign: moved });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    // Ends everything the campaign has running first: its visits and its ranking check (on another
    // computer, that one ends them within a minute).
    forgetCampaignVisit(id);
    stopCampaignCheck(id);
    await deleteCampaign(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
