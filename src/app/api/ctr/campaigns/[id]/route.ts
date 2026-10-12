// GET    /api/ctr/campaigns/:id → { campaign, days, notes, changes, here, canRunHere }
//        here: this computer runs it (visits, ranking checks); canRunHere: it could ("Run on this computer").
//        changes: its change history, newest first (who changed what, when, from what to what).
// PATCH  /api/ctr/campaigns/:id  body: { status: "active" | "paused" | "stopped" }
//        "stopped" ends it early, for good. "finished" is set only by the daily check, at the end date.
//        From another computer, only the status is saved: the computer that runs it picks it up within
//        a minute (src/lib/campaigns/scheduler.ts).
// PATCH  /api/ctr/campaigns/:id  body: { move: true } → it runs on this computer from now on.
// PATCH  /api/ctr/campaigns/:id  body: { moveTo: computerId } → it runs on that computer from now on
//        (any computer the app is on, from any computer or the website): it starts there within a minute.
// PATCH  /api/ctr/campaigns/:id  body: { edit: { siteUrl?, keyword?, durationDays?, … }, computerId? } → saves
//        the changes (same rules as a new campaign; the end date follows the duration), kept in the change
//        history. The computer that runs it starts its visit again with them (here now, elsewhere within a minute).
// Every change is kept in the change history, with who made it.
// DELETE /api/ctr/campaigns/:id

import { badRequest, errorResponse, parseCampaignEdit, parseId, pickComputer, signedInAs } from "@/lib/campaigns/api";
import { ctrSetup, stopCampaignCheck } from "@/lib/campaigns/collect";
import { deleteCampaign, getCampaign, listChanges, listDays, listNotes, moveCampaign, setCampaignStatus, updateCampaign } from "@/lib/campaigns/db";
import { campaignEdited } from "@/lib/campaigns/scheduler";
import { todayInVietnam } from "@/lib/campaigns/site";
import { forgetCampaignVisit, runsHere, startCampaignVisit, stopCampaignVisit } from "@/lib/campaigns/visits";
import { campaignRunner } from "@/lib/runner-lock";
import { thisComputer } from "@/lib/this-computer";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    const [days, notes, changes] = await Promise.all([listDays(id), listNotes(id), listChanges(id)]);
    const computer = await thisComputer().catch(() => null);
    // runner: the other copy of the app on this computer that runs its campaigns (null: this one, or none).
    return Response.json({ campaign, days, notes, changes, here: await runsHere(campaign), canRunHere: !!computer, computer, runner: campaignRunner() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  const body = (await request.json().catch(() => ({}))) as { status?: unknown; move?: unknown; moveTo?: unknown; edit?: unknown; computerId?: unknown };
  const by = await signedInAs();
  if (body.edit && typeof body.edit === "object") return edit(id, body.edit as Record<string, unknown>, body.computerId, by);
  if (body.move === true) return moveHere(id, by);
  if (typeof body.moveTo === "string" && body.moveTo) return moveTo(id, body.moveTo, by);
  if (body.status !== "active" && body.status !== "paused" && body.status !== "stopped") return badRequest("That action isn't available for this campaign.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "finished" || campaign.status === "stopped") return badRequest(`This campaign has ${campaign.status === "stopped" ? "been stopped" : "finished"}, so it can't be changed.`);
    await setCampaignStatus(id, body.status, by);
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

/** Edit: saves what changed (kept in the change history), then moves it if another computer was picked. */
async function edit(id: number, fields: Record<string, unknown>, computerId: unknown, by: string | null) {
  try {
    const before = await getCampaign(id);
    if (!before) return Response.json({ error: "Campaign not found." }, { status: 404 });
    const changes = parseCampaignEdit(before, fields, (await ctrSetup()).proxyApis, todayInVietnam());
    if (typeof changes === "string") return badRequest(changes);
    const after = await updateCampaign(id, changes, by);
    if (!after) return Response.json({ error: "Campaign not found." }, { status: 404 });
    campaignEdited(before, after, await runsHere(after));
    if (typeof computerId === "string" && computerId && computerId !== after.computerId) return moveTo(id, computerId, by);
    return Response.json({ campaign: after, changes });
  } catch (err) {
    return errorResponse(err);
  }
}

/** "Run on this computer": the campaign moves here; the computer that ran it ends its visit within a minute. */
async function moveHere(id: number, by: string | null) {
  const me = await thisComputer();
  if (!me) return badRequest("Campaigns only run on a computer with the app installed, not here.");
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "finished" || campaign.status === "stopped") return badRequest(`This campaign has ${campaign.status === "stopped" ? "been stopped" : "finished"}, so it doesn't run anywhere.`);
    if (campaign.computerId === me.id) return Response.json({ campaign });
    const moved = await moveCampaign(id, me, by);
    // In the copy of the app that runs this computer's campaigns (another copy: it picks it up within a minute).
    if (moved?.status === "active" && (await runsHere(moved))) startCampaignVisit(moved);
    return Response.json({ campaign: moved });
  } catch (err) {
    return errorResponse(err);
  }
}

/** "Move to …": the campaign runs on that computer; what it had running here ends now (elsewhere, within a minute). */
async function moveTo(id: number, computerId: string, by: string | null) {
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "finished" || campaign.status === "stopped") return badRequest(`This campaign has ${campaign.status === "stopped" ? "been stopped" : "finished"}, so it doesn't run anywhere.`);
    if (campaign.computerId === computerId) return Response.json({ campaign });
    const computer = await pickComputer(computerId);
    if (typeof computer === "string") return badRequest(computer);
    if (!computer) return badRequest("Pick the computer to run the campaign on.");
    const wasHere = await runsHere(campaign);
    const moved = await moveCampaign(id, computer, by);
    if (!moved) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (await runsHere(moved)) {
      if (moved.status === "active") startCampaignVisit(moved);
    } else if (wasHere) {
      stopCampaignVisit(id);
      stopCampaignCheck(id);
    }
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
