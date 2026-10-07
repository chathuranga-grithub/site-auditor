// GET /api/ctr/campaigns/:id/visit → the campaign's visit console as newline-delimited JSON
// (VisitEvent + `at` per line): everything so far, then live lines until the visit ends.
// The visit itself is started and stopped with the campaign (src/lib/campaigns/visits.ts).

import { badRequest, parseId } from "@/lib/campaigns/api";
import { campaignVisitStream } from "@/lib/campaigns/visits";

export const runtime = "nodejs";
// A page may follow a long visit; this only runs locally, where there is no limit.
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return badRequest("Invalid campaign id.");
  return new Response(campaignVisitStream(id, request.signal), {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

