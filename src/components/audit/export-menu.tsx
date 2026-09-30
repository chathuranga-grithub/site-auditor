"use client";

// Export dropdown: the full report plus every category as its own one-click Excel
// download, and the raw scan as JSON. Each row shows a download icon that turns into
// a spinner while the file is built and a check once it's saved.

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Braces, Check, ChevronDown, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { SECTIONS, downloadExcel, saveBlob, type SectionId } from "@/lib/excel-report";
import { exportFileName } from "@/lib/report";
import type { ScanResult } from "@/lib/types";
import { SEVERITY_DOT, buttonClass } from "@/components/ui/primitives";

type Item = "full" | SectionId | "json";

/** Same dot colors as the result tabs. */
const DOT: Record<SectionId, string> = {
  broken: SEVERITY_DOT.critical,
  orphans: SEVERITY_DOT.serious,
  redirects: SEVERITY_DOT.warning,
  blocked: SEVERITY_DOT.warning,
  unreachable: SEVERITY_DOT.notice,
  urls: "bg-accent-2",
};
type ItemState = "busy" | "done" | "failed";

export function ExportMenu({ result }: { result: ScanResult }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Partial<Record<Item, ItemState>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(item: Item) {
    if (state[item] === "busy") return;
    setState((s) => ({ ...s, [item]: "busy" }));
    try {
      if (item === "json") {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
        saveBlob(blob, exportFileName(result, "scan", "json"));
      } else {
        await downloadExcel(result, item);
      }
      setState((s) => ({ ...s, [item]: "done" }));
    } catch (err) {
      console.error(err);
      setState((s) => ({ ...s, [item]: "failed" }));
    }
    setTimeout(() => setState((s) => ({ ...s, [item]: undefined })), 2500);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`${buttonClass.secondary} ${open ? "border-line-strong bg-surface-2 text-ink" : ""}`}
      >
        <Download className="size-3.5" />
        Export
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <button
          type="button"
          aria-label="Close export menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm sm:hidden"
        />
      )}
      {open && (
        <div
          role="menu"
          className="fixed inset-x-3 bottom-3 z-40 max-h-[85vh] overflow-y-auto rounded-xl border border-line-strong bg-surface-solid shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-2 sm:w-[22rem] sm:max-h-none sm:overflow-hidden"
        >
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-medium text-ink">Download report</div>
            <div className="text-xs text-muted">Click any row to download it as an Excel file.</div>
          </div>

          <div className="p-2">
            {/* Full report */}
            <button
              type="button"
              role="menuitem"
              onClick={() => run("full")}
              className="group flex w-full items-center gap-3 rounded-lg bg-accent/10 px-3 py-2.5 text-left ring-1 ring-accent/30 transition hover:bg-accent/20"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-accent text-white">
                <FileSpreadsheet className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Full report</span>
                <span className="block text-xs text-muted">Summary + all categories in one workbook</span>
              </span>
              <RowIcon state={state.full} accent />
            </button>

            <div className="px-3 pt-3 pb-1.5 font-mono text-[10px] tracking-[0.16em] text-subtle uppercase">
              Or one category
            </div>

            <ul className="space-y-0.5">
              {SECTIONS.map((s) => {
                const count = s.count(result);
                const empty = count === 0;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => run(s.id)}
                      disabled={empty}
                      title={empty ? `No ${s.label.toLowerCase()} in this scan` : `Download ${s.label} (.xlsx)`}
                      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className={`size-2 shrink-0 rounded-full ${DOT[s.id]}`} aria-hidden />
                      <span className="flex-1 text-sm text-ink">{s.label}</span>
                      <span className="rounded-md bg-surface-2 px-1.5 font-mono text-[11px] text-muted tabular-nums">
                        {count.toLocaleString()}
                      </span>
                      <RowIcon state={state[s.id]} disabled={empty} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-line p-2">
            <button
              type="button"
              role="menuitem"
              onClick={() => run("json")}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-2"
            >
              <Braces className="size-4 shrink-0 text-subtle" />
              <span className="flex-1 text-sm text-ink">
                Raw scan data <span className="font-mono text-xs text-subtle">.json</span>
              </span>
              <RowIcon state={state.json} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Download icon on the right of each row; spinner while building, check when saved. */
function RowIcon({ state, accent, disabled }: { state?: ItemState; accent?: boolean; disabled?: boolean }) {
  const base = "grid size-8 shrink-0 place-items-center rounded-lg border transition";
  if (state === "busy")
    return (
      <span className={`${base} border-line text-accent-2`}>
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  if (state === "done")
    return (
      <span className={`${base} border-status-good/40 bg-status-good/10 text-status-good`}>
        <Check className="size-4" />
      </span>
    );
  if (state === "failed")
    return <span className={`${base} border-status-critical/40 text-xs font-medium text-status-critical`}>!</span>;
  return (
    <span
      className={`${base} ${
        accent
          ? "border-accent/40 text-ink group-hover:bg-gradient-accent group-hover:text-white"
          : "border-line text-muted group-hover:border-accent/50 group-hover:text-accent-2"
      } ${disabled ? "opacity-60" : ""}`}
      aria-hidden
    >
      <ArrowDownToLine className="size-4" />
    </span>
  );
}
