// Locks every page and API route behind company login (src/auth.ts).
// Pages redirect to /login; API routes answer 401 so the crawler can show a clear error.
// The API routes also check the session themselves, so this isn't the only gate.

import { NextResponse } from "next/server";
import { AUTH_CONFIGURED, AUTH_REQUIRED, auth, isCompanyEmail } from "@/auth";

function deny(req: Request, message: string, status = 401) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return NextResponse.json({ error: message }, { status });
  const login = new URL("/login", url.origin);
  if (url.pathname !== "/") login.searchParams.set("callbackUrl", url.pathname + url.search);
  return NextResponse.redirect(login);
}

const withAuth = auth((req) => {
  if (isCompanyEmail(req.auth?.user?.email)) return NextResponse.next();
  return deny(req, "Sign in with your company Google account to use Site Auditor.");
});

export default function proxy(req: Parameters<typeof withAuth>[0], ctx: Parameters<typeof withAuth>[1]) {
  if (!AUTH_REQUIRED) return NextResponse.next(); // local development without Google keys
  if (!AUTH_CONFIGURED) {
    // Production without keys: stay locked rather than open.
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return NextResponse.json({ error: "Login is not configured." }, { status: 503 });
    if (url.pathname !== "/login") return NextResponse.redirect(new URL("/login", url.origin));
    return NextResponse.next();
  }
  return withAuth(req, ctx);
}

export const config = {
  // Everything except the login page, Auth.js endpoints and static assets.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp)$).*)"],
};
