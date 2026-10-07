// GET    /api/ctr/campaigns/:id → { campaign, days, notes }
// PATCH  /api/ctr/campaigns/:id  body: { status: "active" | "paused" }
// DELETE /api/ctr/campaigns/:id

import { badRequest, errorResponse, parseId } from "@/lib/campaigns/api";
import { deleteCampaign, getCampaign, listDays, listNotes, setCampaignStatus } from "@/lib/campaigns/db";

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
  if (body.status !== "active" && body.status !== "paused") return badRequest('Status must be "active" or "paused".');
  try {
    if (!(await getCampaign(id))) return Response.json({ error: "Campaign not found." }, { status: 404 });
    await setCampaignStatus(id, body.status);
    return Response.json({ campaign: await getCampaign(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  try {
    await deleteCampaign(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
