// Sign-in page: username + password. Split layout: product panel on the left (large screens),
// sign-in card on the right.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChartSpline, Lock, MousePointerClick, ScanSearch, ShieldCheck, TrendingUp } from "lucide-react";
import { SESSION_COOKIE, readSessionToken, safeNextPath } from "@/lib/auth/session";
import { Logo } from "@/components/shell/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNextPath((await searchParams).next);
  // Already signed in: straight on.
  if (await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <ProductPanel />

      <main className="relative flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center gap-2.5 lg:hidden">
          <Brand />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back</h1>
          <p className="mt-2 text-sm text-muted">Sign in with your SEO Auditor account.</p>
          <LoginForm next={next} />
          <div className="mt-8 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-2" aria-hidden />
            <p className="text-xs leading-5 text-muted">Internal tool. Accounts are created by an admin; ask them if you need access or a new password.</p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-subtle">
          <span>© {new Date().getFullYear()} Grithub · Internal tool</span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3" aria-hidden />
            Signed-in access only
          </span>
        </footer>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <>
      <Logo className="glow size-8 rounded-lg" />
      <span className="text-base font-semibold tracking-tight">
        SEO <span className="text-gradient">Auditor</span>
      </span>
    </>
  );
}

/** Left panel on large screens: what the tools do. */
function ProductPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-surface-solid/60 px-12 py-10 lg:flex lg:flex-col xl:px-16">
      <div className="pointer-events-none absolute -top-40 -left-32 size-[32rem] rounded-full bg-accent/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-accent-2/10 blur-3xl" aria-hidden />

      <div className="relative flex items-center gap-2.5">
        <Brand />
      </div>

      <div className="relative my-auto max-w-lg py-10">
        <p className="font-mono text-[11px] tracking-[0.2em] text-accent-2 uppercase">Site health · SEO</p>
        <h2 className="mt-3 text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">
          Find what&apos;s broken <span className="text-gradient">before Google does.</span>
        </h2>
        <p className="mt-4 text-base leading-7 text-muted">One place to check our sites, see how they rank, and track real results over time.</p>

        <ul className="mt-8 space-y-4">
          <Feature icon={<ScanSearch className="size-4" />} title="Site Audit">
            Broken links, orphan pages and redirects, for up to 200 sites at once.
          </Feature>
          <Feature icon={<TrendingUp className="size-4" />} title="Keyword Rankings">
            Who ranks on Google Vietnam, and how their pages compare.
          </Feature>
          <Feature icon={<MousePointerClick className="size-4" />} title="Visit Test">
            Every page checked through a Vietnam proxy, on desktop and phone.
          </Feature>
          <Feature icon={<ChartSpline className="size-4" />} title="Auto CTR">
            Real position, clicks and CTR over time, against goals.
          </Feature>
        </ul>
      </div>

      <p className="relative font-mono text-[11px] text-subtle">Built for the Grithub engineering &amp; SEO team</p>
    </aside>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-2 text-accent-2">{icon}</span>
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}
