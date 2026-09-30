"use client";

// Bulk scan queue: every site with its live status and issue counts. A few sites run
// at the same time and the rest start automatically; clicking a finished site opens
// its full results below.

import { useState } from "react";
import { Check, ChevronRight, Copy, FileSpreadsheet, Loader2 } from "lucide-react";
import { isFinished, type SiteJob } from "@/lib/batch";
import { downloadBatchExcel } from "@/lib/excel-report";
import { buildBatchTextReport, friendlyError } from "@/lib/report";
import { Panel, SEVERITY_DOT, buttonClass, type Severity } from "@/components/ui/primitives";
import { formatDuration } from "./scan-console";

export function BatchQueue({
  jobs,
  running,
  selectedId,
  onSelect,
  now,
  parallel,
}: {
  jobs: SiteJob[];
  running: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
  /** How many sites are scanned at the same time. */
  parallel: number;
}) {
  const finished = jobs.filter(isFinished).length;
  const pct = jobs.length ? Math.round((finished / jobs.length) * 100) : 0;

  return (
    <Panel
      title={
        <span>
          Bulk scan · {finished} / {jobs.length} sites {running ? "checked" : "done"}
        </span>
      }
      actions={!running && finished > 0 ? <BatchActions jobs={jobs} /> : undefined}
    >
      <div className="px-4 pt-3">
        <div className="h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {running
            ? `Up to ${parallel} sites are checked at the same time. The rest start automatically as slots free up.`
            : "Click a site to see its full results."}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-y border-line bg-surface font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
            <tr>
              <th className="w-10 px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Site</th>
              <th className="w-48 px-4 py-2 font-medium">Status</th>
              <th className="w-20 px-4 py-2 text-right font-medium">Pages</th>
              <th className="w-20 px-4 py-2 text-right font-medium">Broken</th>
              <th className="w-20 px-4 py-2 text-right font-medium">Orphans</th>
              <th className="w-24 px-4 py-2 text-right font-medium">Redirects</th>
              <th className="w-20 px-4 py-2 text-right font-medium">Time</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {jobs.map((job, i) => {
              const r = job.result;
              const selectable = !!r;
              const selected = job.id === selectedId;
              const elapsed = job.startedAt ? Math.max(0, (job.finishedAt ?? now) - job.startedAt) : null;
              return (
                <tr
                  key={job.id}
                  onClick={selectable ? () => onSelect(job.id) : undefined}
                  className={`transition-colors ${selectable ? "cursor-pointer hover:bg-surface-2" : ""} ${
                    selected ? "bg-accent/10 ring-1 ring-accent/40 ring-inset" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-subtle tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{job.host}</td>
                  <td className="px-4 py-2.5">
                    <JobStatusCell job={job} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
                    {r ? r.pagesCrawled : job.status === "running" ? (job.progress?.crawled ?? 0) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Count value={r?.brokenLinks.length} severity="critical" />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Count value={r?.orphans.length} severity="serious" />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Count value={r?.redirects.length} severity="warning" />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
                    {elapsed === null ? "—" : formatDuration(elapsed)}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {selectable && (
                      <ChevronRight className={`inline size-4 ${selected ? "text-accent-2" : "text-subtle"}`} aria-hidden />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function JobStatusCell({ job }: { job: SiteJob }) {
  switch (job.status) {
    case "queued":
      return <StatusText dot="notice" label="Queued" />;
    case "running": {
      const p = job.progress;
      const total = (p?.crawled ?? 0) + (p?.queued ?? 0);
      const pct = p && p.phase !== "sitemap" && total ? Math.round((p.crawled / total) * 100) : 0;
      return (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-accent-2">
            <Loader2 className="size-3.5 animate-spin" />
            {p?.phase === "sitemap" || !p ? "Reading sitemap…" : `Scanning · ${pct}%`}
          </span>
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent-2 transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case "done":
      return <StatusText dot="good" label={job.result?.truncated ? "Done · page limit" : "Done"} />;
    case "stopped":
      return <StatusText dot="warning" label="Stopped" />;
    case "skipped":
      return <StatusText dot="notice" label="Skipped" />;
    case "failed":
      return (
        <span title={job.error} className="block">
          <StatusText dot="critical" label="Failed" />
          <span className="mt-0.5 line-clamp-1 text-[11px] text-muted">{job.error && friendlyError(job.error)}</span>
        </span>
      );
  }
}

function StatusText({ dot, label }: { dot: Severity; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink">
      <span className={`size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[dot]}`} aria-hidden />
      {label}
    </span>
  );
}

/** Issue count with a status dot when above zero. */
function Count({ value, severity }: { value?: number; severity: Severity }) {
  if (value === undefined) return <span className="font-mono text-xs text-subtle">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 font-mono text-xs text-ink tabular-nums">
      {value > 0 && <span className={`size-1.5 rounded-full ${SEVERITY_DOT[severity]}`} aria-hidden />}
      {value.toLocaleString()}
    </span>
  );
}

function BatchActions({ jobs }: { jobs: SiteJob[] }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildBatchTextReport(jobs));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadBatchExcel(jobs);
    } catch (err) {
      console.error(err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      <button type="button" onClick={copy} className={buttonClass.secondary}>
        {copied === "ok" ? <Check className="size-3.5 text-status-good" /> : <Copy className="size-3.5" />}
        {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy summary"}
      </button>
      <button type="button" onClick={download} disabled={busy} className={buttonClass.secondary}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileSpreadsheet className="size-3.5" />}
        {failed ? "Download failed" : busy ? "Preparing…" : "Download all sites"}
        {!busy && !failed && <span className="font-mono text-[10px] opacity-60">.xlsx</span>}
      </button>
    </div>
  );
}
