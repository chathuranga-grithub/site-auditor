import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppWindow, Info, KeyRound, UserRound, Users } from "lucide-react";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { Panel } from "@/components/ui/primitives";
import { ProxyApiField } from "@/components/ui/proxy-api-field";
import { ChromeProfileField } from "@/components/ui/chrome-profile-field";
import { thisComputer } from "@/lib/this-computer";

export const metadata: Metadata = { title: "Settings" };

// Admins only (src/proxy.ts sends everyone else back to their tool).
export default async function SettingsPage() {
  const session = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  // The desktop app passes its version to the server it starts (desktop/main.js); npm run dev has none.
  const version = process.env.APP_VERSION ?? null;
  const computer = await thisComputer().catch(() => null);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header>
        <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Admin / Settings</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">App-wide configuration. Only admins can see this page.</p>
      </header>

      <Panel title={<Title icon={<Info className="size-3.5" />} text="About this app" />} bodyClassName="p-4 sm:p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["Version", version ?? "development"],
            ["Running as", version ? "Desktop app (Windows)" : process.env.VERCEL ? "Website (Vercel)" : "Development (npm run dev)"],
            ["This computer", computer?.name ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-surface px-3 py-2">
              <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">{k}</dt>
              <dd className="mt-0.5 font-mono font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title={<Title icon={<KeyRound className="size-3.5" />} text="Proxy" />} bodyClassName="space-y-3 p-4 sm:p-5">
        <p className="text-sm text-muted">
          The ShopLike proxy API links used for campaign visits and Google searches from Vietnam: one, or a list (paste one per line). Saved{" "}
          <b className="text-ink">encrypted</b> in the database (the key isn&apos;t in the database), and never shown in full again after saving.
          For now visits and searches use link #1.
        </p>
        <ProxyApiField />
      </Panel>

      <Panel title={<Title icon={<AppWindow className="size-3.5" />} text="Browser" />} bodyClassName="space-y-3 p-4 sm:p-5">
        <p className="text-sm text-muted">
          The Chrome profile campaign visits and ranking checks use on <b className="text-ink">this computer</b> (its cookies, settings and
          history). Each computer saves its own: pick one of this computer&apos;s Chrome profiles and save. Its extensions run in every visit and ranking check; after changing the profile in Chrome, click <b className="text-ink">Save</b> again. Sign-ins don&apos;t carry over from Chrome: click <b className="text-ink">Open</b> to sign in there.
        </p>
        <ChromeProfileField />
      </Panel>

      <Panel title={<Title icon={<Users className="size-3.5" />} text="Users" />} bodyClassName="space-y-2 p-4 text-sm text-muted sm:p-5">
        <p className="flex items-center gap-2">
          <UserRound className="size-4 text-accent-2" aria-hidden /> Signed in as <span className="font-medium text-ink">{session?.username}</span> (administrator)
        </p>
        <p>
          Add a user or change a password with <code>npm run user:create</code> (see README). A users page here can come next.
        </p>
      </Panel>
    </div>
  );
}

function Title({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      {text}
    </span>
  );
}
