import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppWindow, KeyRound, UserRound, Users } from "lucide-react";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { Panel } from "@/components/ui/primitives";
import { ProxyApiField } from "@/components/ui/proxy-api-field";
import { ChromeProfileField } from "@/components/ui/chrome-profile-field";

export const metadata: Metadata = { title: "Settings" };

// Admins only (src/proxy.ts sends everyone else back to their tool).
export default async function SettingsPage() {
  const session = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header>
        <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Admin / Settings</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">App-wide configuration. Only admins can see this page.</p>
      </header>

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
          The Chrome profile campaign visits and ranking checks use (its cookies, settings and history). Pick one of this computer&apos;s
          Chrome profiles and save. After changing that profile in Chrome, click <b className="text-ink">Update</b>. Extensions and sign-ins don&apos;t carry over from Chrome: click <b className="text-ink">Open</b> and add them there.
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
