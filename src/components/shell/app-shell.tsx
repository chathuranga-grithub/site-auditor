"use client";

// App frame shared by every tool: sidebar navigation on desktop, a top bar with a
// slide-out menu on mobile. Navigation comes from src/config/tools.ts.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { TOOLS } from "@/config/tools";
import { Logo } from "./logo";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

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

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="px-3 py-2">
      <div className="px-2 pb-2 font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools</div>
      <ul className="space-y-1">
        {TOOLS.map(({ href, name, icon: Icon, children }) => {
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
