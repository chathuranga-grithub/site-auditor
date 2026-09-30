// Small presentational building blocks shared by every tool.
// Colors come from the theme tokens in globals.css.

import type { ReactNode } from "react";
import { CircleAlert, ExternalLink, Info, TriangleAlert } from "lucide-react";

export type Severity = "critical" | "serious" | "warning" | "notice" | "good";

/** Status dot classes. Color is always paired with a text label. */
export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-status-critical shadow-[0_0_8px_var(--color-status-critical)]",
  serious: "bg-status-serious shadow-[0_0_8px_var(--color-status-serious)]",
  warning: "bg-status-warning shadow-[0_0_8px_var(--color-status-warning)]",
  notice: "bg-subtle",
  good: "bg-status-good shadow-[0_0_8px_var(--color-status-good)]",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  serious: "High",
  warning: "Medium",
  notice: "Low",
  good: "OK",
};

export function Panel({
  title,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`glass overflow-hidden rounded-xl ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">{title}</h2>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  detail,
  severity,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  severity?: Severity;
}) {
  return (
    <div className="glass group relative min-w-0 overflow-hidden rounded-xl px-4 py-3">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
        {severity && <span className={`size-1.5 rounded-full ${SEVERITY_DOT[severity]}`} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {detail && <div className="mt-0.5 truncate font-mono text-[11px] text-subtle">{detail}</div>}
    </div>
  );
}

/** HTTP status with a colored dot. 0 = no response. */
export function StatusCode({ status, redirected }: { status: number; redirected?: boolean }) {
  const severity: Severity =
    status === 0
      ? "notice"
      : status >= 500
        ? "critical"
        : status >= 400
          ? "serious"
          : status >= 300 || redirected
            ? "warning"
            : "good";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className={`size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[severity]}`} aria-hidden />
      {status === 0 ? "ERR" : status}
      {redirected && status < 400 && status !== 0 && <span className="text-subtle">↪</span>}
    </span>
  );
}

export function SeverityLabel({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide uppercase">
      <span className={`size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[severity]}`} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[10px] tracking-wide text-muted uppercase">
      {children}
    </span>
  );
}

/** A URL rendered as a mono link (scheme and www hidden) that opens in a new tab. */
export function UrlLink({ href, full = false }: { href: string; full?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="group inline-flex max-w-full items-baseline gap-1 font-mono text-xs break-all text-link hover:text-accent-2 hover:underline"
    >
      <span>{full ? href : displayUrl(href)}</span>
      <ExternalLink className="size-3 shrink-0 self-center opacity-0 group-hover:opacity-70" aria-hidden />
    </a>
  );
}

export function Notice({
  tone,
  children,
  className = "",
}: {
  tone: "error" | "warning" | "info";
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    error: "border-status-critical/40 bg-status-critical/10 text-red-200",
    warning: "border-status-warning/30 bg-status-warning/[0.07] text-amber-100",
    info: "border-line bg-surface text-muted",
  }[tone];
  const iconColor = { error: "text-status-critical", warning: "text-status-warning", info: "text-accent-2" }[tone];
  const Icon = tone === "error" ? CircleAlert : tone === "warning" ? TriangleAlert : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-xl border px-4 py-3 text-sm backdrop-blur ${styles} ${className}`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconColor}`} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const buttonClass = {
  primary:
    "glow inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-accent px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50",
  danger:
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-status-critical/50 bg-status-critical/15 px-5 text-sm font-semibold text-red-200 transition hover:bg-status-critical/25",
  ghost:
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink",
  secondary:
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink",
};

/** Drops the scheme and "www." so long URLs are easier to scan in a table. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "");
}
