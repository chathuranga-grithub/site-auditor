"use client";

// App frame shared by every tool: sidebar navigation on desktop, a slide-out menu on
// mobile, and a top bar with the signed-in account on the right. Navigation comes
// from src/config/tools.ts.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu, X } from "lucide-react";
import { signOutAction } from "@/app/actions";
import { TOOLS } from "@/config/tools";

export interface ShellUser {
  email: string;
  name?: string | null;
  image?: string | null;
}

export function AppShell({ children, user }: { children: ReactNode; user?: ShellUser | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The login page is shown on its own, without navigation.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-canvas/60 backdrop-blur-xl md:block">
        <div className="sticky top-0">
          <Brand />
          <Nav />
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
          <aside className="relative h-full w-64 border-r border-line bg-surface-solid">
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
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/70 px-3 backdrop-blur-xl sm:px-6 lg:px-8 ${
            user ? "" : "md:hidden" // nothing to show on desktop when login is off (local dev)
          }`}
        >
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <div className="md:hidden">
            <Brand compact />
          </div>
          <div className="ml-auto">{user && <AccountMenu user={user} />}</div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** Avatar + first name in the top bar; click for full details and Sign out. */
function AccountMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const firstName = user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1 transition hover:bg-surface-2 ${
          open ? "bg-surface-2 ring-1 ring-line-strong" : ""
        }`}
      >
        <Avatar user={user} size="sm" />
        <span className="hidden max-w-32 truncate text-sm text-ink sm:inline">{firstName}</span>
        <ChevronDown className={`size-3.5 text-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line-strong bg-surface-solid shadow-2xl shadow-black/50"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-4">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              {user.name && <div className="truncate text-sm font-medium text-ink">{user.name}</div>}
              <div className="truncate font-mono text-xs text-muted" title={user.email}>
                {user.email}
              </div>
              <div className="mt-1 font-mono text-[10px] tracking-wide text-subtle uppercase">Signed in with Google</div>
            </div>
          </div>
          <form action={signOutAction} className="p-1.5">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink transition hover:bg-surface-2"
            >
              <LogOut className="size-4 text-muted" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Google profile photo, or the first letter of the name/email if there isn't one. */
function Avatar({ user, size }: { user: ShellUser; size: "sm" | "lg" }) {
  const [broken, setBroken] = useState(false);
  const dims = size === "sm" ? "size-7 text-[11px]" : "size-10 text-sm";
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  if (user.image && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small external avatar; next/image would need remote config
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`${dims} shrink-0 rounded-full object-cover ring-1 ring-line-strong`}
      />
    );
  }
  return (
    <span
      className={`${dims} grid shrink-0 place-items-center rounded-full bg-gradient-accent font-semibold text-white`}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 font-semibold tracking-tight ${compact ? "" : "h-16 px-5"}`}>
      <span className="glow grid size-7 place-items-center rounded-lg bg-gradient-accent font-mono text-[11px] font-bold text-white">
        SA
      </span>
      <span className="text-sm">
        Site<span className="text-gradient">Auditor</span>
      </span>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="px-3 py-2">
      <div className="px-2 pb-2 font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools</div>
      <ul className="space-y-1">
        {TOOLS.map(({ href, name, icon: Icon }) => {
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
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
