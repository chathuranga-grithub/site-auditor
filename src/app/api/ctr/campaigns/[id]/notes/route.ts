// POST /api/ctr/campaigns/:id/notes  body: { text, day? } → adds a change-log entry ("New title tag").

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { addNote, getCampaign } from "@/lib/campaigns/db";
import { todayInVietnam } from "@/lib/campaigns/site";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; day?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 500) return badRequest("Write what changed (up to 500 characters).");
  const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : todayInVietnam();
  try {
    if (!(await getCampaign(id))) return Response.json({ error: "Campaign not found." }, { status: 404 });
    return Response.json({ note: await addNote(id, day, text) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
