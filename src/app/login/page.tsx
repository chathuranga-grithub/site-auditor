// Sign-in page: "Sign in with Google" for @grithub.ae accounts only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ALLOWED_DOMAIN, AUTH_CONFIGURED, auth, isCompanyEmail, signIn } from "@/auth";
import { signOutAction } from "@/app/actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: `Only @${ALLOWED_DOMAIN} company accounts can sign in. Choose your work Google account and try again.`,
  Configuration: "Login isn't set up correctly. Please tell the person who manages Site Auditor.",
};

/** Only same-site paths, so the login page can't be used to redirect elsewhere. */
function safePath(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/audit";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrl = safePath(params.callbackUrl);
  const error = typeof params.error === "string" ? (ERRORS[params.error] ?? "Sign-in failed. Please try again.") : null;

  // Company users go straight in. A non-company session must NOT redirect back, or the
  // proxy would bounce it here again (redirect loop); show who they are and offer sign-out.
  const session = AUTH_CONFIGURED ? await auth() : null;
  const signedInEmail = session?.user?.email ?? null;
  if (isCompanyEmail(signedInEmail)) redirect(callbackUrl);

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl });
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-12">
      <div className="glass w-full max-w-sm rounded-2xl p-8 text-center">
        <span className="glow mx-auto grid size-12 place-items-center rounded-xl bg-gradient-accent font-mono text-sm font-bold text-white">
          SA
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">
          Site<span className="text-gradient">Auditor</span>
        </h1>
        <p className="mt-1 text-sm text-muted">Sign in with your company Google account.</p>

        {error && (
          <p role="alert" className="mt-5 rounded-lg border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-left text-sm text-red-200">
            {error}
          </p>
        )}

        {signedInEmail && (
          <div role="alert" className="mt-5 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-left text-sm text-amber-100">
            You&apos;re signed in as <span className="font-mono">{signedInEmail}</span>, which isn&apos;t a company account.
            <form action={signOutAction} className="mt-2">
              <button type="submit" className="font-medium underline underline-offset-2 hover:text-white">
                Sign out and use your @{ALLOWED_DOMAIN} account
              </button>
            </form>
          </div>
        )}

        {AUTH_CONFIGURED && !signedInEmail ? (
          <form action={signInWithGoogle} className="mt-6">
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              <GoogleIcon />
              Sign in with Google
            </button>
          </form>
        ) : !AUTH_CONFIGURED ? (
          <p className="mt-6 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-sm text-amber-100">
            Login isn&apos;t set up yet, so access is locked. Add the Google keys in Vercel (see README).
          </p>
        ) : null}

        <p className="mt-6 inline-flex items-center gap-1.5 font-mono text-[11px] text-subtle">
          <ShieldCheck className="size-3.5" />
          Only @{ALLOWED_DOMAIN} accounts
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
    </svg>
  );
}
