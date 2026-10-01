// Sign-in page: "Sign in with Google" for @grithub.ae accounts only.
// Split layout: product panel on the left (large screens), sign-in card on the right.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { FileSpreadsheet, Layers, Lock, ShieldCheck, Unlink } from "lucide-react";
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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <ProductPanel />

      <main className="relative flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center gap-2.5 lg:hidden">
          <Logo />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back</h1>
          <p className="mt-2 text-sm text-muted">Sign in with your company Google account to continue.</p>

          {error && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-status-critical/40 bg-status-critical/10 px-3.5 py-2.5 text-sm text-red-200"
            >
              {error}
            </p>
          )}

          {signedInEmail && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3.5 py-2.5 text-sm text-amber-100"
            >
              You&apos;re signed in as <span className="font-mono">{signedInEmail}</span>, which isn&apos;t a company
              account.
              <form action={signOutAction} className="mt-2">
                <button type="submit" className="font-medium underline underline-offset-2 hover:text-white">
                  Sign out and use your @{ALLOWED_DOMAIN} account
                </button>
              </form>
            </div>
          )}

          {AUTH_CONFIGURED && !signedInEmail ? (
            <form action={signInWithGoogle} className="mt-8">
              <button
                type="submit"
                className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-900 shadow-lg shadow-black/30 ring-1 ring-white/10 transition hover:-translate-y-px hover:bg-zinc-50 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-accent-2 focus-visible:outline-none active:translate-y-0"
              >
                <GoogleIcon />
                Sign in with Google
              </button>
            </form>
          ) : !AUTH_CONFIGURED ? (
            <p className="mt-8 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3.5 py-2.5 text-sm text-amber-100">
              Login isn&apos;t set up yet, so access is locked. Add the Google keys in Vercel (see README).
            </p>
          ) : null}

          <div className="mt-8 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-2" aria-hidden />
            <p className="text-xs leading-5 text-muted">
              Access is limited to <span className="font-mono text-ink">@{ALLOWED_DOMAIN}</span> Google Workspace
              accounts. Personal Gmail accounts can&apos;t sign in.
            </p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-subtle">
          <span>© {new Date().getFullYear()} Grithub · Internal tool</span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3" aria-hidden />
            Secured with Google sign-in
          </span>
        </footer>
      </main>
    </div>
  );
}

/** Left panel on large screens: what the tool does, plus a small results preview. */
function ProductPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-surface-solid/60 px-12 py-10 lg:flex lg:flex-col xl:px-16">
      <div
        className="pointer-events-none absolute -top-40 -left-32 size-[32rem] rounded-full bg-accent/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-accent-2/10 blur-3xl"
        aria-hidden
      />

      <div className="relative flex items-center gap-2.5">
        <Logo />
      </div>

      <div className="relative my-auto max-w-lg py-10">
        <p className="font-mono text-[11px] tracking-[0.2em] text-accent-2 uppercase">Site health · SEO</p>
        <h2 className="mt-3 text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">
          Find what&apos;s broken <span className="text-gradient">before Google does.</span>
        </h2>
        <p className="mt-4 text-base leading-7 text-muted">
          Crawl WordPress sites from their sitemap and homepage, then fix broken links, orphan pages and redirects with
          a clear report.
        </p>

        <ul className="mt-8 space-y-4">
          <Feature icon={<Unlink className="size-4" />} title="Broken links & redirects">
            Every 404 and redirect, with the page it was found on.
          </Feature>
          <Feature icon={<Layers className="size-4" />} title="Orphan pages">
            Sitemap pages that nothing links to.
          </Feature>
          <Feature icon={<FileSpreadsheet className="size-4" />} title="Bulk scans & Excel reports">
            Up to 200 sites at once, exported to one workbook.
          </Feature>
        </ul>

        <PreviewCard />
      </div>

      <p className="relative font-mono text-[11px] text-subtle">Built for the Grithub engineering &amp; SEO team</p>
    </aside>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-2 text-accent-2">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

/** Decorative sample of the results table (static, not real data). */
function PreviewCard() {
  const rows = [
    { site: "example.com", pages: 128, broken: 0, orphans: 2 },
    { site: "example.org", pages: 64, broken: 3, orphans: 0 },
    { site: "example.net", pages: 212, broken: 1, orphans: 5 },
  ];
  return (
    // Only on screens tall enough to fit it; shorter laptops just get the feature list.
    <div className="glass mt-10 hidden overflow-hidden rounded-xl [@media(min-height:860px)]:block" aria-hidden>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-subtle uppercase">
        <span>Bulk scan · 3 / 3 sites done</span>
        <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-status-good">
          <span className="size-1.5 rounded-full bg-status-good" />
          Completed
        </span>
      </div>
      <table className="w-full text-left font-mono text-xs">
        <thead className="text-[10px] tracking-[0.14em] text-subtle uppercase">
          <tr>
            <th className="px-4 py-2 font-medium">Site</th>
            <th className="px-4 py-2 text-right font-medium">Pages</th>
            <th className="px-4 py-2 text-right font-medium">Broken</th>
            <th className="px-4 py-2 text-right font-medium">Orphans</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.site}>
              <td className="px-4 py-2 text-ink">{r.site}</td>
              <td className="px-4 py-2 text-right text-muted">{r.pages}</td>
              <td className="px-4 py-2 text-right">
                <Count value={r.broken} dot="bg-status-critical" />
              </td>
              <td className="px-4 py-2 text-right">
                <Count value={r.orphans} dot="bg-status-serious" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Count({ value, dot }: { value: number; dot: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 text-ink">
      {value > 0 && <span className={`size-1.5 rounded-full ${dot}`} />}
      {value}
    </span>
  );
}

function Logo() {
  return (
    <>
      <span className="glow grid size-8 place-items-center rounded-lg bg-gradient-accent font-mono text-xs font-bold text-white">
        SA
      </span>
      <span className="text-base font-semibold tracking-tight">
        Site<span className="text-gradient">Auditor</span>
      </span>
    </>
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
