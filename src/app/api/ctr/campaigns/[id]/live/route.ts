// GET /api/ctr/campaigns/:id/live → { computerName, sharing, lastSeen, at, campaign }: what the campaign
// is doing on the computer that runs it (another one, or the other copy of the app on this one), as of
// its last minute check-in (src/lib/campaigns/live-snapshot.ts). sharing: Realtime updates are on
// there; campaign: its latest console lines and recently finished visits (null: no visit there since
// its app started). One small read, only that campaign's part; the page asks once a minute.

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { getCampaign, readLiveSnapshot } from "@/lib/campaigns/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const c = await getCampaign(id);
    if (!c) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (!c.computerId) return badRequest("No computer runs this campaign yet.");
    const live = await readLiveSnapshot(c.computerId, id);
    return Response.json(live ? { computerName: live.name, sharing: live.sharing, lastSeen: live.lastSeen, at: live.at, campaign: live.campaign } : { computerName: c.computerName, sharing: false, lastSeen: null, at: null, campaign: null });
  } catch (err) {
    return errorResponse(err);
  }
}
