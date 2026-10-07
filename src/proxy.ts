// Every page and API route needs a login. Pages redirect to /login; API routes answer 401.
// Open: the login page and login API, the daily job (it checks CRON_SECRET itself), static files.

import { NextResponse, type NextRequest } from "next/server";
import { TOOL_HOME, allowedTools, canUsePath } from "@/lib/auth/permissions";
import { SESSION_COOKIE, readSessionToken, sessionConfigured } from "@/lib/auth/session";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/auth/login" || pathname.startsWith("/api/cron/")) return NextResponse.next();

  const session = sessionConfigured() ? await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value) : null;
  if (session) {
    if (canUsePath(session, pathname)) return NextResponse.next();
    // Signed in, but this tool isn't on the account: APIs refuse; pages go to the account's own tool.
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Your account doesn't have access to this tool." }, { status: 403 });
    const home = allowedTools(session)[0];
    if (home) return NextResponse.redirect(new URL(TOOL_HOME[home], req.url));
    return new NextResponse("Your account doesn't have access to any tool yet. Ask an admin.", { status: 403 });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: sessionConfigured() ? "Please sign in." : "Login isn't set up: AUTH_SECRET is missing." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next.js internals and static files (the favicon, images).
  matcher: ["/((?!_next/static|_next/image|icon\\.svg|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp)$).*)"],
};
