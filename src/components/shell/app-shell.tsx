"use client";

// App frame shared by every tool: sidebar navigation on desktop, a top bar with a
// slide-out menu on mobile. Navigation comes from src/config/tools.ts.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogOut, Menu, UserRound, X } from "lucide-react";
import { TOOLS } from "@/config/tools";
import { allowedTools, type ToolId } from "@/lib/auth/permissions";
import { Logo } from "./logo";

export interface ShellUser {
  username: string;
  role: "admin" | "user";
  /** null = all tools (admins). */
  tools: ToolId[] | null;
}

export function AppShell({ children, user }: { children: ReactNode; user: ShellUser | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // The login page has its own full-screen layout.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-canvas/60 backdrop-blur-xl md:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <Brand />
          <Nav user={user} />
          <UserBox user={user} />
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-line bg-surface-solid">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <Nav user={user} onNavigate={() => setOpen(false)} />
            <UserBox user={user} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/70 px-3 backdrop-blur-xl md:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Menu className="size-4" />
          </button>
          <Brand compact />
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** Who is signed in, and Sign out. */
function UserBox({ user }: { user: ShellUser | null }) {
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Full reload on purpose: nothing from the signed-in session stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  return (
    <div className="mt-auto border-t border-line p-3">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-line-strong">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{user.username}</span>
          <span className="block font-mono text-[10px] tracking-wide text-subtle uppercase">{user.role}</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          aria-label="Sign out"
          title="Sign out"
          className="grid size-8 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 font-semibold tracking-tight ${compact ? "" : "h-16 px-5"}`}>
      <Logo className="glow size-7 rounded-lg" />
      <span className="text-sm">
        SEO <span className="text-gradient">Auditor</span>
      </span>
    </Link>
  );
}

function Nav({ user, onNavigate }: { user: ShellUser | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Only the tools this account may use.
  const allowed = user ? allowedTools(user) : [];
  const tools = TOOLS.filter((t) => allowed.includes(t.id));

  return (
    <nav className="px-3 py-2">
      <div className="px-2 pb-2 font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools</div>
      <ul className="space-y-1">
        {tools.map(({ href, name, icon: Icon, children }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  active
                    ? "bg-surface-2 text-ink ring-1 ring-line-strong"
                    : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                {active && (
                  <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-gradient-accent" aria-hidden />
                )}
                <Icon className={`size-4 shrink-0 ${active ? "text-accent-2" : ""}`} />
                {name}
              </Link>
              {children && active && (
                <ul className="mt-1 mb-2 ml-[1.15rem] space-y-0.5 border-l border-line pl-3">
                  {children.map((c) => {
                    // The section's first page (its dashboard) only matches exactly; deeper pages by prefix.
                    const on = c.href === href ? pathname === href : pathname.startsWith(c.href);
                    return (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          onClick={onNavigate}
                          aria-current={on ? "page" : undefined}
                          className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${on ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"}`}
                        >
                          {c.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
