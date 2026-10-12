// This computer's name, shown on the campaign pages instead of the Windows computer name.
// GET → { name, hostname, named, suggestion }   (null on Vercel: no computer)
// PUT { name } → gives it that name (empty: back to the Windows name); its campaigns show it. Admins only.

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { renameComputer } from "@/lib/campaigns/db";
import { MAX_COMPUTER_NAME, nameThisComputer, suggestedComputerName, thisComputer } from "@/lib/this-computer";

export const runtime = "nodejs";

export async function GET() {
  const me = await thisComputer().catch(() => null);
  return Response.json(me ? { name: me.name, hostname: me.hostname, named: me.named, suggestion: suggestedComputerName(), max: MAX_COMPUTER_NAME } : null);
}

export async function PUT(request: Request) {
  const session = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (session?.role !== "admin") return Response.json({ error: "Only an admin can name this computer (Settings)." }, { status: 403 });
  const before = await thisComputer().catch(() => null);
  if (!before) return Response.json({ error: "Only the app on a computer has a computer name." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  if (typeof body.name !== "string") return Response.json({ error: "Send the name as text." }, { status: 400 });
  try {
    const after = (await nameThisComputer(body.name, session.username))!;
    // Its campaigns (and their days) show the new name; the database may be offline: the name is kept here anyway.
    const synced = await renameComputer(after.id, before.name, after.name).then(
      () => true,
      () => false,
    );
    return Response.json({ name: after.name, hostname: after.hostname, named: after.named, synced });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
