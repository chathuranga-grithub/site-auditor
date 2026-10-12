// POST /api/ctr/campaigns/:id/live → { url, token, computerName }: watch the campaign's live console
// through the relay, when it runs on another computer (from any computer or the website). Marks it as
// watched for a few minutes (the page asks again every 2 while open), so the computer that runs it
// connects to the relay at its next minute check (src/lib/live-relay.ts). The token only lets the page
// connect, in the next 2 minutes.

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { requestLive } from "@/lib/campaigns/db";
import { relayToken, relayUrl } from "@/lib/live-relay";

export const runtime = "nodejs";

/** Watched this long after the page last asked. */
const WATCH_SEC = 180;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    const url = await relayUrl();
    if (!url) return Response.json({ error: "The live console relay isn't set up yet (Settings → Live console)." }, { status: 503 });
    const c = await requestLive(id, WATCH_SEC);
    if (!c) return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (!c.computerId) return badRequest("No computer runs this campaign yet, so there's no live console to watch.");
    return Response.json({ url, token: relayToken({ r: "v", c: id, pc: c.computerId }, 120), computerName: c.computerName });
  } catch (err) {
    return errorResponse(err);
  }
}
