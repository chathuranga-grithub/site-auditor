// The live console relay (relay/README.md), on the Settings page. Admins only.
// GET → { url, fromEnv, secret }  (secret: the relay's RELAY_SECRET, made from AUTH_SECRET)
// PUT { url } → saves its address for every computer (empty: none)

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { relaySecret, relayUrl, saveRelayUrl } from "@/lib/live-relay";

export const runtime = "nodejs";

async function admin() {
  const s = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return s?.role === "admin" ? s : null;
}
const forbidden = () => Response.json({ error: "Only an admin can set up the live console relay (Settings)." }, { status: 403 });
const failed = (err: unknown) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });

export async function GET() {
  if (!(await admin())) return forbidden();
  try {
    return Response.json({ url: await relayUrl(), fromEnv: !!process.env.LIVE_RELAY_URL, secret: relaySecret() });
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(request: Request) {
  const who = await admin();
  if (!who) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string") return Response.json({ error: "Send the address as text." }, { status: 400 });
  try {
    const saved = await saveRelayUrl(body.url, who.username);
    if (typeof saved === "string") return Response.json({ error: saved }, { status: 400 });
    return Response.json(saved);
  } catch (err) {
    return failed(err);
  }
}
