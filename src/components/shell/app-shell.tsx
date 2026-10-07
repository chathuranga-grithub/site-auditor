"use client";

// App frame shared by every tool: sidebar navigation on desktop, a top bar with a
// slide-out menu on mobile. Navigation comes from src/config/tools.ts.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { TOOL_GROUPS, TOOLS } from "@/config/tools";
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
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface-solid/70 backdrop-blur-xl md:block">
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
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface-solid">
            <div className="flex items-center justify-between border-b border-line pr-2">
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
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-2.5 py-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-accent font-semibold text-white uppercase shadow-md shadow-accent/20" aria-hidden>
          {user.username.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{user.username}</span>
          <span className={`mt-0.5 inline-flex items-center gap-1 text-[11px] ${user.role === "admin" ? "text-accent-2" : "text-muted"}`}>
            {user.role === "admin" ? <ShieldCheck className="size-3" aria-hidden /> : <UserRound className="size-3" aria-hidden />}
            {user.role === "admin" ? "Administrator" : "Team member"}
          </span>
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          aria-label="Sign out"
          title="Sign out"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-status-critical disabled:opacity-50"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-3 ${compact ? "" : "h-[4.25rem] border-b border-line px-5"}`}>
      <Logo className={`glow rounded-lg ${compact ? "size-7" : "size-8"}`} />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">
          SEO <span className="text-gradient">Auditor</span>
        </span>
        {!compact && <span className="block text-[11px] text-subtle">Internal SEO toolkit</span>}
      </span>
    </Link>
  );
}

function Nav({ user, onNavigate }: { user: ShellUser | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Only the tools this account may use, in their groups.
  const allowed = user ? allowedTools(user) : [];
  const tools = TOOLS.filter((t) => allowed.includes(t.id));
  const groups = TOOL_GROUPS.map((g) => ({ name: g, tools: tools.filter((t) => t.group === g) })).filter((g) => g.tools.length);

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Tools">
      {groups.map((group) => (
        <div key={group.name}>
          <div className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">{group.name}</div>
          <ul className="space-y-0.5">
            {group.tools.map(({ href, name, icon: Icon, badge, description, children }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    title={description}
                    aria-current={active && !children ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    {active && <span className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-gradient-accent" aria-hidden />}
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
                        active ? "bg-gradient-accent text-white shadow-md shadow-accent/25" : "bg-surface-2 text-muted ring-1 ring-line group-hover:text-ink"
                      }`}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {badge && (
                      <span className="rounded-full border border-line-strong px-1.5 py-px font-mono text-[9px] tracking-wide text-subtle uppercase" title="Runs only on a computer (npm run dev)">
                        {badge}
                      </span>
                    )}
                    {children && <ChevronDown className={`size-3.5 shrink-0 text-subtle transition-transform ${active ? "" : "-rotate-90"}`} aria-hidden />}
                  </Link>
                  {children && active && (
                    <ul className="mt-1 ml-[1.35rem] space-y-0.5 border-l border-line pl-3">
                      {children.map((c) => {
                        // The section's first page (its dashboard) only matches exactly; deeper pages by prefix.
                        const on = c.href === href ? pathname === href : pathname === c.href || pathname.startsWith(`${c.href}/`);
                        const CIcon = c.icon;
                        return (
                          <li key={c.href}>
                            <Link
                              href={c.href}
                              onClick={onNavigate}
                              aria-current={on ? "page" : undefined}
                              className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                                on ? "bg-accent/10 font-medium text-ink" : "text-muted hover:bg-surface hover:text-ink"
                              }`}
                            >
                              {on && <span className="absolute top-1.5 bottom-1.5 -left-[13px] w-px bg-accent-2" aria-hidden />}
                              <CIcon className={`size-3.5 shrink-0 ${on ? "text-accent-2" : ""}`} aria-hidden />
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
        </div>
      ))}
    </nav>
  );
}
