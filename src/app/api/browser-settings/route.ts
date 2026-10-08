// The Chrome profile the app's browsers use (Settings): one of this computer's Chrome profiles, by
// name, copied into the app's own folder. Not a secret.
// GET → { profiles, selected, dir, source, copiedAt, open, updatedBy? }
// POST { name, update? } → pick it (copied the first time; update: true copies it again)   POST { open: true } → open the copy in Chrome (add extensions, sign in)
// DELETE → back to fresh profiles   (admins only)

import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { chromeProfileStatus, openChromeProfile, stopUsingChromeProfile, selectChromeProfile } from "@/lib/browser-profile";

export const runtime = "nodejs";

/** Changing it is an admin setting (Settings page). */
async function admin() {
  const s = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return s?.role === "admin" ? s : null;
}
const forbidden = () => Response.json({ error: "Only an admin can change the Chrome profile (Settings)." }, { status: 403 });
const failed = (err: unknown) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });

export async function GET() {
  try {
    return Response.json(await chromeProfileStatus());
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  const who = await admin();
  if (!who) return forbidden();
  let body: { name?: unknown; open?: unknown; update?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const problem = body.open === true ? await openChromeProfile() : await selectChromeProfile(typeof body.name === "string" ? body.name : "", who.username, body.update === true);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    return Response.json(await chromeProfileStatus());
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE() {
  if (!(await admin())) return forbidden();
  try {
    await stopUsingChromeProfile();
    return Response.json(await chromeProfileStatus());
  } catch (err) {
    return failed(err);
  }
}
