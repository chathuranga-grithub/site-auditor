// Login: "Sign in with Google", limited to company (@grithub.ae) accounts.
// Configured by env vars AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET (see README).

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const ALLOWED_DOMAIN = "grithub.ae";

/**
 * Login is on whenever Google credentials are configured. Without them, production
 * stays locked (see proxy.ts) and local development runs open so work isn't blocked.
 */
export const AUTH_CONFIGURED = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET);
export const AUTH_REQUIRED = AUTH_CONFIGURED || process.env.NODE_ENV === "production";

/** The one rule for "is this a company user" used by the proxy, API routes and login page. */
export function isCompanyEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

/** True only for a verified Google Workspace account on the company domain. */
export function isAllowedAccount(profile: { email?: string | null; email_verified?: boolean; hd?: string } | undefined) {
  return profile?.email_verified === true && profile.hd === ALLOWED_DOMAIN && isCompanyEmail(profile.email);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // "hd" makes Google show only company accounts on the account picker.
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  callbacks: {
    // "hd" in the URL is only a hint, so the domain is enforced again here.
    signIn: ({ profile }) => isAllowedAccount(profile as Parameters<typeof isAllowedAccount>[0]),
  },
});

/** For API routes: true when the request may proceed. */
export async function isAuthorized(): Promise<boolean> {
  if (!AUTH_REQUIRED) return true;
  if (!AUTH_CONFIGURED) return false;
  return isCompanyEmail((await auth())?.user?.email);
}
