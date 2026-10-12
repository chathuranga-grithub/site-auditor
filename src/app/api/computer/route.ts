// This computer's name, shown on the campaign pages instead of the Windows computer name; and its
// Realtime updates (what its campaigns are doing, for pages elsewhere: src/lib/campaigns/live-snapshot.ts).
// GET → { name, hostname, named, suggestion, realtime }   (null on Vercel: no computer)
// PUT { name } → gives it that name (empty: back to the Windows name); its campaigns show it. Admins only.
// PUT { realtime: boolean } → Realtime updates on or off for this computer. Admins only.

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { renameComputer } from "@/lib/campaigns/db";
import { realtimeUpdates, setRealtimeUpdates } from "@/lib/campaigns/live-snapshot";
import { MAX_COMPUTER_NAME, nameThisComputer, suggestedComputerName, thisComputer } from "@/lib/this-computer";

export const runtime = "nodejs";

export async function GET() {
  const me = await thisComputer().catch(() => null);
  return Response.json(me ? { name: me.name, hostname: me.hostname, named: me.named, suggestion: suggestedComputerName(), max: MAX_COMPUTER_NAME, realtime: await realtimeUpdates() } : null);
}

export async function PUT(request: Request) {
  const session = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (session?.role !== "admin") return Response.json({ error: "Only an admin can name this computer (Settings)." }, { status: 403 });
  const before = await thisComputer().catch(() => null);
  if (!before) return Response.json({ error: "Only the app on a computer has a computer name." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; realtime?: unknown };
  if (typeof body.realtime === "boolean") {
    await setRealtimeUpdates(body.realtime, session.username);
    return Response.json({ realtime: body.realtime });
  }
  if (typeof body.name !== "string") return Response.json({ error: "Send the name as text." }, { status: 400 });
  try {
    const after = (await nameThisComputer(body.name, session.username))!;
    // Its campaigns (and their days) show the new name; the database may be offline: the name is kept here anyway.
    const synced = await renameComputer(after.id, before.name, after.name, after.named ? after.name : null).then(
      () => true,
      () => false,
    );
    return Response.json({ name: after.name, hostname: after.hostname, named: after.named, synced });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
