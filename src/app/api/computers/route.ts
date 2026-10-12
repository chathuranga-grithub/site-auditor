// The computers campaigns can run on, to pick one when starting or moving a campaign (from any computer,
// or the website). GET → { computers: KnownComputer[], me } (me: this computer's id; null on Vercel).
// This computer is always in the list, even before it first said it's on (just after the app started).

import { NotConfiguredError, listComputers } from "@/lib/campaigns/db";
import { errorResponse } from "@/lib/campaigns/api";
import type { KnownComputer } from "@/lib/campaigns/types";
import { thisComputer } from "@/lib/this-computer";

export const runtime = "nodejs";

export async function GET() {
  const me = await thisComputer().catch(() => null);
  try {
    const computers = await listComputers();
    const mine = computers.find((c) => c.id === me?.id);
    if (me && !mine) computers.unshift({ id: me.id, name: me.name, hostname: me.hostname, appVersion: null, lastSeen: null, online: true, campaigns: 0 });
    // The app runs here now, whatever the database last heard.
    else if (mine) Object.assign(mine, { name: me!.name, online: true } satisfies Partial<KnownComputer>);
    return Response.json({ computers, me: me?.id ?? null });
  } catch (err) {
    if (err instanceof NotConfiguredError) return Response.json({ computers: [], me: me?.id ?? null });
    return errorResponse(err);
  }
}
