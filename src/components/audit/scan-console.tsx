"use client";

// Live view while a scan runs: phase, progress bar, throughput, and a terminal-style request log.

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { ScanPhase, ScanProgress } from "@/lib/types";
import { Panel, StatusCode, displayUrl } from "@/components/ui/primitives";

export interface LogEntry {
  id: number;
  /** ms since scan start */
  at: number;
  phase: ScanPhase;
  status: number;
  redirected: boolean;
  blocked: boolean;
  durationMs: number;
  url: string;
  error?: string;
}

const PHASE_LABELS: Record<ScanPhase, string> = {
  sitemap: "Resolving sitemap",
  crawl: "Crawling",
  orphans: "Verifying orphans",
  soft404: "Soft-404 probe",
  done: "Finalizing",
};

export function ScanConsole({
  progress,
  log,
  elapsedMs,
}: {
  progress: ScanProgress | null;
  log: LogEntry[];
  elapsedMs: number;
}) {
  const phase = progress?.phase ?? "sitemap";
  const done = progress?.crawled ?? 0;
  const queued = progress?.queued ?? 0;
  const total = done + queued;
  const pct = phase === "sitemap" || total === 0 ? 0 : Math.round((done / total) * 100);
  const rate = elapsedMs > 0 ? done / (elapsedMs / 1000) : 0;

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent-2 opacity-75" />
            <span className="relative size-2 rounded-full bg-accent-2" />
          </span>
          Live · {PHASE_LABELS[phase]}
        </span>
      }
      actions={<span className="font-mono text-xs text-muted tabular-nums">{formatDuration(elapsedMs)}</span>}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className={`h-full rounded-full bg-gradient-accent transition-[width] duration-300 ${
                phase === "sitemap" ? "w-1/4 animate-pulse" : ""
              }`}
              style={phase === "sitemap" ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs text-ink tabular-nums">{pct}%</span>
        </div>

        <dl className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
          <Metric label="Checked" value={done.toLocaleString()} />
          <Metric label="Queued" value={queued.toLocaleString()} />
          <Metric label="Discovered" value={(progress?.found ?? 0).toLocaleString()} />
          <Metric label="Req/s" value={rate.toFixed(1)} />
        </dl>

        <div className="overflow-hidden rounded-lg border border-line bg-black/40">
          <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-subtle uppercase">
            <Terminal className="size-3" />
            Request log
          </div>
          <div ref={logRef} className="h-56 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
            {log.length === 0 ? (
              <div className="text-subtle">
                <span className="text-accent-2">$</span> waiting for first response…
              </div>
            ) : (
              log.map((e) => (
                <div key={e.id} className="flex gap-3 whitespace-nowrap">
                  <span className="w-14 shrink-0 text-subtle tabular-nums">+{(e.at / 1000).toFixed(1)}s</span>
                  <span className="w-12 shrink-0">
                    <StatusCode status={e.status} redirected={e.redirected} />
                  </span>
                  <span className="w-14 shrink-0 text-right text-muted tabular-nums">{e.durationMs}ms</span>
                  <span className="w-16 shrink-0 text-subtle">{e.phase}</span>
                  <span className="truncate text-ink/90" title={e.url}>
                    {displayUrl(e.url)}
                    {e.blocked && <span className="ml-2 text-status-warning">[challenge]</span>}
                    {e.error && <span className="ml-2 text-status-serious">{e.error}</span>}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-[10px] tracking-[0.16em] text-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink tabular-nums">{value}</dd>
    </div>
  );
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
