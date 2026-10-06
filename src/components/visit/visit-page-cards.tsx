"use client";

// Visit Test: every page as a card with its screenshots and check icons, page by page, plus the
// details popup and check icons shared with the list view.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert, X } from "lucide-react";
import { pageActivities, pageProblems, type CheckStatus, type ChecklistItem } from "@/lib/visit-checklist";
import type { VisitPage } from "@/lib/visit-types";
import { Pagination } from "@/components/ui/pagination";
import { StatusCode, displayUrl } from "@/components/ui/primitives";

const PAGE_SIZE = 24;

type Filter = "all" | "problems" | "ok";

export function VisitPageCards({ pages, onOpen }: { pages: VisitPage[]; onOpen: (page: VisitPage) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);

  const rows = pages.map((p, i) => ({ n: i + 1, page: p, problems: pageProblems(p) }));
  const counts = { all: rows.length, problems: rows.filter((r) => r.problems.length).length, ok: rows.filter((r) => !r.problems.length).length };
  const visible = rows.filter((r) => filter === "all" || (filter === "problems") === r.problems.length > 0);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);

  const goTo = (p: number) => {
    setPage(p);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div ref={top} className="scroll-mt-4">
      <div className="flex flex-wrap gap-1.5 border-b border-line p-3" role="group" aria-label="Show pages">
        {(["all", "problems", "ok"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              filter === f ? "border-accent/50 bg-accent/15 text-ink" : "border-line text-muted hover:text-ink"
            }`}
          >
            {f === "all" ? "All" : f === "problems" ? "Problems" : "OK"}
            <span className="font-mono text-[10px] text-subtle tabular-nums">{counts[f]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted">{filter === "problems" ? "No pages with problems." : "No pages yet."}</div>
      ) : (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(({ n, page: p, problems }) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                className={`group flex h-full w-full flex-col overflow-hidden rounded-lg border bg-surface text-left transition hover:border-line-strong hover:bg-surface-2 ${
                  problems.length ? "border-status-warning/50" : "border-line"
                }`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-black/30">
                  {p.screenshot ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot
                    <img src={p.screenshot} alt="" loading="lazy" className="size-full object-cover object-top transition group-hover:scale-[1.02]" />
                  ) : (
                    <div className="grid size-full place-items-center text-xs text-subtle">No screenshot</div>
                  )}
                  <span className="absolute top-1.5 left-1.5 rounded bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">#{n}</span>
                  <span className="absolute top-1.5 right-1.5 rounded bg-canvas/85 px-1.5 py-0.5 text-xs">
                    {p.status !== null ? <StatusCode status={p.status} /> : <span className="font-mono text-status-serious">none</span>}
                  </span>
                  {p.mobile?.screenshot && (
                    // Phone view in the corner, like a phone held in front of the screen.
                    // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot
                    <img
                      src={p.mobile.screenshot}
                      alt=""
                      loading="lazy"
                      title="Phone view"
                      className="absolute right-1.5 bottom-1.5 h-[70%] w-auto rounded-md border-2 border-canvas object-cover object-top shadow-lg"
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                  <div className="truncate text-sm font-medium text-ink">{p.title ?? "(no title)"}</div>
                  <div className="truncate font-mono text-[11px] text-link" title={p.finalUrl}>
                    {displayUrl(p.finalUrl)}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                    {problems.length ? (
                      <span className="flex min-w-0 items-center gap-1 text-status-warning">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate" title={problems.join(" · ")}>
                          {problems.join(" · ")}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-status-good">
                        <CircleCheck className="size-3.5" aria-hidden /> OK
                      </span>
                    )}
                    <span className={`shrink-0 font-mono tabular-nums ${(p.loadMs ?? 0) > 8000 ? "text-status-warning" : "text-subtle"}`}>
                      {p.loadMs != null ? formatMs(p.loadMs) : "–"}
                    </span>
                  </div>
                  <ActivityIcons items={pageActivities(p)} className="mt-auto border-t border-line pt-2" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={current} pageSize={PAGE_SIZE} total={visible.length} unit="pages" onPage={goTo} />
    </div>
  );
}

export const ACTIVITY_STYLE: Record<CheckStatus, { icon: typeof CircleCheck; color: string; text: string }> = {
  pass: { icon: CircleCheck, color: "text-status-good", text: "PASS" },
  warn: { icon: TriangleAlert, color: "text-status-warning", text: "WARN" },
  fail: { icon: CircleX, color: "text-status-critical", text: "FAIL" },
  skip: { icon: CircleMinus, color: "text-subtle", text: "NOT RUN" },
};

const SEVERITY: CheckStatus[] = ["fail", "warn", "pass"];

/** Short name of what went wrong, shown on a badge when one check in its group fails or warns. */
const PROBLEM_NAME: Record<string, string> = {
  open: "didn't open",
  loaded: "slow to load",
  scroll: "very long page",
  images: "broken images",
  js: "JS errors",
  files: "failed files",
  clickable: "link not clickable",
  "phone-open": "didn't open",
  "phone-fit": "too wide",
  "phone-viewport": "no viewport tag",
  "phone-images": "broken images",
  "menu-phone": "doesn't open",
};

const CHECK_GROUPS = [
  { name: "Desktop", test: (id: string) => !id.startsWith("phone") && id !== "menu-phone", count: true },
  { name: "Phone", test: (id: string) => id.startsWith("phone"), count: true },
  { name: "Menu", test: (id: string) => id === "menu-phone", count: false },
];

/**
 * The page's checks as labelled badges: "✓ Desktop 6/6", "✕ Phone 3/4 · fits the screen", "✓ Menu".
 * Each badge has the worst result of its group; hovering shows every check in it.
 */
export function ActivityIcons({ items, className = "" }: { items: ChecklistItem[]; className?: string }) {
  const groups = CHECK_GROUPS.map((g) => ({ ...g, items: items.filter((i) => g.test(i.id)) })).filter((g) => g.items.length);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} role="list" aria-label="Checks on this page">
      {groups.map((g) => {
        const status = SEVERITY.find((s) => g.items.some((i) => i.status === s)) ?? "skip";
        const S = ACTIVITY_STYLE[status];
        const passed = g.items.filter((i) => i.status === "pass").length;
        const bad = g.items.filter((i) => i.status === "fail" || i.status === "warn");
        const what = status === "skip" ? "not run" : bad.length === 1 ? (PROBLEM_NAME[bad[0].id] ?? "problem") : bad.length > 1 ? `${bad.length} issues` : "";
        return (
          <HoverTip key={g.name} content={<GroupTip name={g.name} status={status} items={g.items} />}>
            <span
              role="listitem"
              aria-label={`${g.name}: ${S.text}${what ? `, ${what}` : ""}. ${g.items.map((i) => `${i.label}: ${ACTIVITY_STYLE[i.status].text}`).join(", ")}`}
              className={`inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
                status === "fail" ? "border-status-critical/40 bg-status-critical/10" : status === "warn" ? "border-status-warning/40 bg-status-warning/10" : "border-line"
              }`}
            >
              <S.icon className={`size-3 shrink-0 ${S.color}`} aria-hidden />
              <span className="text-ink">{g.name}</span>
              {g.count && status !== "skip" && (
                <span className="font-mono text-[10px] text-subtle tabular-nums">
                  {passed}/{g.items.length}
                </span>
              )}
              {what && <span className={`truncate ${S.color}`}>· {what}</span>}
            </span>
          </HoverTip>
        );
      })}
    </div>
  );
}

/** Tooltip body: every check in one group with its result and detail. */
function GroupTip({ name, status, items }: { name: string; status: CheckStatus; items: ChecklistItem[] }) {
  const S = ACTIVITY_STYLE[status];
  return (
    <div className="w-72">
      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
        <span>{name} checks</span>
        <span className={S.color}>{S.text}</span>
      </div>
      <ul className="space-y-1">
        {items.map((i) => {
          const I = ACTIVITY_STYLE[i.status];
          return (
            <li key={i.id} className="grid grid-cols-[0.875rem_1fr] gap-x-1.5 text-xs">
              <I.icon className={`mt-0.5 size-3.5 ${I.color}`} aria-hidden />
              <span className="text-ink first-letter:uppercase">{i.label.replace(/^Phone: /, "")}</span>
              <span className="col-start-2 text-[11px] text-muted">{i.detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A styled tooltip shown while hovering its child. Drawn in a layer above the page (fixed position)
 * so a card's clipped edges never cut it off; placed above the badge, or below it near the top.
 */
function HoverTip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [box, setBox] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const show = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const width = 320; // w-72 content + padding + border
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = r.top < 260;
    setBox({ left, top: below ? r.bottom + 6 : r.top - 6, below });
  };
  return (
    <span className="inline-flex max-w-full min-w-0" onMouseEnter={show} onMouseLeave={() => setBox(null)}>
      {children}
      {box &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: box.left, top: box.top, transform: box.below ? undefined : "translateY(-100%)" }}
            className="pointer-events-none fixed z-[60] rounded-lg border border-line-strong bg-canvas p-3 text-left shadow-2xl shadow-black/60"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

export function DetailDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label="Page details">
      <div className="relative mx-auto max-w-4xl rounded-xl bg-canvas" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-2 -right-2 z-10 grid size-8 place-items-center rounded-full border border-line bg-surface text-muted shadow-lg hover:text-ink"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
