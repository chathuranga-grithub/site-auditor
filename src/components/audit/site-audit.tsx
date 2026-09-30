"use client";

// Site Audit tool: scan form (one site or a pasted list), bulk queue, live console,
// and results (overview + tabbed tables). Sites in a list are scanned a few at a time,
// automatically; each crawl runs in the browser via runScan (src/lib/crawler.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, Copy, FileDown, Globe, Loader2, Play, RotateCcw, Square, Upload } from "lucide-react";
import { MAX_SITES, parseSiteList, type SiteJob } from "@/lib/batch";
import { IMPORT_ACCEPT, downloadSampleCsv, readSiteFile } from "@/lib/site-import";
import { runScan } from "@/lib/crawler";
import {
  buildTextReport,
  friendlyError,
  homepageProblem,
  responseTimes,
  scanWarnings,
} from "@/lib/report";
import type { ScanProgress, ScanResult } from "@/lib/types";
import { Notice, Panel, StatTile, Tag, buttonClass } from "@/components/ui/primitives";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ScanConsole, formatDuration, type LogEntry } from "./scan-console";
import { StatusBreakdown } from "./status-breakdown";
import { ExportMenu } from "./export-menu";
import { BatchQueue } from "./batch-queue";
import {
  AllUrlsTable,
  BlockedTable,
  BrokenTable,
  OrphanTable,
  RedirectTable,
  UnreachableTable,
} from "./result-tables";

/** Safety limit on HTML pages crawled. Our sites are small, so this is never reached in practice. */
const MAX_PAGES = 500;
/** Parallel requests per site. 10 keeps a site under ~200 requests/min, below common WordPress security-plugin throttles. */
const CONCURRENCY = 10;
/** Sites scanned at the same time in a bulk scan. Different sites are different servers, so this adds no load per site. */
const SITES_IN_PARALLEL = 3;
const LOG_LIMIT = 300;

type Tab = "urls" | "broken" | "orphans" | "redirects" | "blocked" | "unreachable";

export function SiteAudit() {
  const [input, setInput] = useState("");
  const [jobs, setJobs] = useState<SiteJob[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("broken");
  const [siteStartedAt, setSiteStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseSiteList(input), [input]);
  const current = jobs.find((j) => j.status === "running");
  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const isBulk = jobs.length > 1;

  // Tick the elapsed timer; Esc stops the scan.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && controllerRef.current?.abort();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [running]);

  const patchJob = (id: string, patch: Partial<SiteJob>) =>
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  /** Back to an empty form. */
  function handleReset() {
    setInput("");
    setJobs([]);
    setSelectedId(null);
    setError(null);
    setNotice(null);
    setProgress(null);
    setLog([]);
    setTab("broken");
  }

  // Stable callback (reads jobs through a ref) so memoised queue rows don't re-render on every update.
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  const handleSelect = useCallback((id: string) => {
    const job = jobsRef.current.find((j) => j.id === id);
    setSelectedId(id);
    if (job?.result) setTab(defaultTab(job.result));
  }, []);

  async function handleScan(e?: FormEvent) {
    e?.preventDefault();
    if (running) return;

    const { sites, invalid, blocked, duplicates, overLimit } = parsed;
    if (sites.length === 0) {
      setError(
        invalid.length
          ? `${invalid.length === 1 ? "That doesn't" : "These don't"} look like website addresses: ${invalid.slice(0, 3).join(", ")}. Try something like example.com.`
          : blocked.length
            ? friendlyError("This host is not allowed")
            : friendlyError("Invalid URL"),
      );
      return;
    }

    const skippedNotes = [
      invalid.length && `${invalid.length} invalid entr${invalid.length === 1 ? "y" : "ies"} skipped (${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""})`,
      blocked.length && `${blocked.length} local/private address${blocked.length === 1 ? "" : "es"} not allowed (${blocked.slice(0, 3).join(", ")})`,
      duplicates && `${duplicates} duplicate${duplicates === 1 ? "" : "s"} removed`,
      overLimit && `${overLimit} site${overLimit === 1 ? "" : "s"} over the ${MAX_SITES}-site limit left out`,
    ].filter(Boolean);
    setNotice(skippedNotes.length ? `${skippedNotes.join(" · ")}.` : null);

    const list: SiteJob[] = sites.map((s, i) => ({ id: `${i}-${s.host}`, input: s.input, host: s.host, status: "queued" }));
    const controller = new AbortController();
    controllerRef.current = controller;
    setJobs(list);
    setSelectedId(null);
    setError(null);
    setRunning(true);
    setNow(Date.now());

    const single = list.length === 1;

    async function scanOne(job: SiteJob) {
      const start = Date.now();
      let nextId = 0;
      if (single) {
        // The live console and request log are only shown for a single-site scan.
        setLog([]);
        setProgress(null);
        setSiteStartedAt(start);
        setNow(start);
      }
      patchJob(job.id, { status: "running", startedAt: start });

      try {
        const result = await runScan(
          job.input,
          {
            maxPages: MAX_PAGES,
            concurrency: CONCURRENCY,
            signal: controller.signal,
            onFetch: single
              ? (r, phase) => {
                  const entry: LogEntry = {
                    id: nextId++,
                    at: Date.now() - start,
                    phase,
                    status: r.status,
                    redirected: r.redirected,
                    blocked: r.blocked,
                    durationMs: r.durationMs,
                    url: r.url,
                    error: r.error,
                  };
                  setLog((prev) => (prev.length >= LOG_LIMIT ? [...prev.slice(-LOG_LIMIT + 1), entry] : [...prev, entry]));
                }
              : undefined,
          },
          (p) => {
            if (single) setProgress(p);
            patchJob(job.id, { progress: p });
          },
        );
        // A scan whose homepage never loaded (unreachable, blocked, 5xx) found nothing; report it as failed.
        const problem = result.cancelled ? null : homepageProblem(result);
        patchJob(job.id, {
          status: result.cancelled ? "stopped" : problem ? "failed" : "done",
          error: problem ?? undefined,
          result,
          finishedAt: Date.now(),
        });
        if (single) {
          setSelectedId(job.id);
          setTab(defaultTab(result));
        }
      } catch (err) {
        const aborted = controller.signal.aborted;
        const message = err instanceof Error ? err.message : String(err);
        patchJob(job.id, {
          status: aborted ? "stopped" : "failed",
          error: aborted ? undefined : message,
          finishedAt: Date.now(),
        });
        if (single && !aborted) setError(friendlyError(message));
      }
    }

    // Up to SITES_IN_PARALLEL sites at once; each free slot picks up the next queued site.
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const job = list[next++];
        if (controller.signal.aborted) patchJob(job.id, { status: "skipped" });
        else await scanOne(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SITES_IN_PARALLEL, list.length) }, worker));

    setRunning(false);
    setNow(Date.now());
    controllerRef.current = null;
  }

  /** Adds the sites from a file to the box so they can be reviewed before scanning. */
  async function handleImport(file: File) {
    setImporting(true);
    setError(null);
    try {
      const { sites: entries, skipped } = await readSiteFile(file);
      if (entries.length === 0) {
        setError(`No website addresses found in ${file.name}. Put one site per row in the first column, or in a column named "url".`);
        return;
      }
      setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n` : "") + entries.join("\n"));
      const skippedNote = skipped ? ` (${skipped} empty row${skipped === 1 ? "" : "s"} skipped)` : "";
      setNotice(
        `Imported ${entries.length} row${entries.length === 1 ? "" : "s"} from ${file.name}${skippedNote}. Check the list in the box, then click Scan.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't read ${file.name}.`);
    } finally {
      setImporting(false);
    }
  }

  // Enter runs the scan; Shift+Enter adds a new line for typing a list by hand.
  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleScan();
    }
  }

  const lineCount = input.split("\n").length;
  const siteCount = parsed.sites.length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools / Site Audit</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Site <span className="text-gradient">Audit</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Sitemap + link crawl. Detects orphan pages, broken internal links, redirects and bot challenges.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>up to {MAX_SITES} sites</Tag>
          <Tag>limit {MAX_PAGES} pages / site</Tag>
          <Tag>{CONCURRENCY} requests / site</Tag>
          <Tag>{SITES_IN_PARALLEL} sites at a time</Tag>
        </div>
      </header>

      <form
        onSubmit={handleScan}
        onDragOver={(e) => {
          if (running || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !running) void handleImport(file);
        }}
        className={`glass relative rounded-xl p-2 transition ${dragOver ? "ring-2 ring-accent-2" : ""}`}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-canvas/80 text-sm font-medium text-ink backdrop-blur-sm">
            <span className="inline-flex items-center gap-2">
              <Upload className="size-4 text-accent-2" />
              Drop a .csv, .xlsx or .txt file to import sites
            </span>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <label className="relative flex-1">
            <span className="sr-only">Website URLs</span>
            <Globe className="pointer-events-none absolute top-3 left-3.5 size-4 text-subtle" />
            <textarea
              rows={Math.min(8, Math.max(1, lineCount))}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com — or paste several sites, one per line"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              disabled={running}
              required
              className="block min-h-10 w-full resize-none rounded-lg border border-transparent bg-canvas/60 py-2 pr-3 pl-10 font-mono text-base leading-6 text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
            />
          </label>
          {running ? (
            <button type="button" onClick={() => controllerRef.current?.abort()} className={buttonClass.danger}>
              <Square className="size-3.5 fill-current" />
              {isBulk ? "Stop all" : "Stop"}
              <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[10px] opacity-70 sm:inline">
                Esc
              </kbd>
            </button>
          ) : (
            <>
              <button type="submit" className={buttonClass.primary}>
                <Play className="size-3.5 fill-current" />
                {siteCount > 1 ? `Scan ${siteCount} sites` : "Run scan"}
              </button>
              {(input || jobs.length > 0 || error) && (
                <button type="button" onClick={handleReset} className={buttonClass.ghost}>
                  <RotateCcw className="size-3.5" />
                  Reset
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-2 pb-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept={IMPORT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={running || importing}
              className={`${buttonClass.secondary} disabled:opacity-50`}
              title="Import a list of sites from a .csv, .xlsx or .txt file"
            >
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              Import CSV / Excel
            </button>
            <button
              type="button"
              onClick={downloadSampleCsv}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-link hover:bg-surface-2 hover:text-accent-2"
              title="Download a sample file to fill in with your sites"
            >
              <FileDown className="size-3.5" />
              Sample CSV
            </button>
            <span className="hidden font-mono text-[11px] text-subtle lg:inline">
              · or paste a list (one per line, or comma-separated) · drop a file here
            </span>
          </div>
          {input.trim() && (
            <span
              className={`font-mono text-[11px] ${parsed.invalid.length || parsed.blocked.length ? "text-status-warning" : "text-muted"}`}
            >
              {siteCount} site{siteCount === 1 ? "" : "s"} ready
              {parsed.invalid.length > 0 && ` · ${parsed.invalid.length} not valid`}
              {parsed.blocked.length > 0 && ` · ${parsed.blocked.length} not allowed`}
              {parsed.duplicates > 0 && ` · ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}

      {isBulk && (
        <BatchQueue jobs={jobs} running={running} selectedId={selectedId} onSelect={handleSelect} now={now} parallel={SITES_IN_PARALLEL} />
      )}

      {running && !isBulk && current && (
        <ScanConsole
          progress={progress}
          log={log}
          elapsedMs={now - siteStartedAt}
          site={isBulk ? `${current.host} (${jobs.indexOf(current) + 1}/${jobs.length})` : undefined}
        />
      )}

      {selected?.result && (
        <Results
          result={selected.result}
          tab={tab}
          onTab={setTab}
          durationMs={(selected.finishedAt ?? now) - (selected.startedAt ?? now)}
        />
      )}
    </div>
  );
}

function Results({
  result,
  tab,
  onTab,
  durationMs,
}: {
  result: ScanResult;
  tab: Tab;
  onTab: (t: Tab) => void;
  durationMs: number;
}) {
  const problem = homepageProblem(result);
  const warnings = scanWarnings(result);
  const times = responseTimes(result);
  const soft = result.soft404;

  const tabs: TabItem<Tab>[] = [
    { id: "broken", label: "Broken links", count: result.brokenLinks.length, severity: "critical" },
    { id: "orphans", label: "Orphans", count: result.orphans.length, severity: "serious" },
    { id: "redirects", label: "Redirects", count: result.redirects.length, severity: "warning" },
    { id: "blocked", label: "Cloudflare", count: result.blocked.length, severity: "warning" },
    ...(result.unreachable.length
      ? [{ id: "unreachable" as const, label: "Unreachable", count: result.unreachable.length, severity: "notice" as const }]
      : []),
    { id: "urls", label: "All URLs", count: result.pages.length },
  ];

  return (
    <div className="space-y-5">
      {problem && <Notice tone="error">{problem}</Notice>}
      {warnings.map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${result.cancelled ? "bg-status-warning" : "bg-status-good"}`} aria-hidden />
            <span className="text-ink">{result.cancelled ? "Stopped" : "Completed"}</span>
          </span>
          <a href={result.origin} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
            {result.origin}
          </a>
          <span>{formatDuration(durationMs)}</span>
          <span>{new Date(result.finishedAt).toLocaleString()}</span>
        </div>
        <ReportActions result={result} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatTile label="Sitemap" value={result.sitemapCount.toLocaleString()} detail="URLs listed" />
        <StatTile label="Crawled" value={result.pagesCrawled.toLocaleString()} detail="HTML pages" />
        <StatTile label="Requests" value={result.urlsChecked.toLocaleString()} detail="pages + files" />
        <StatTile
          label="Broken"
          value={result.brokenLinks.length.toLocaleString()}
          severity={result.brokenLinks.length ? "critical" : "good"}
        />
        <StatTile
          label="Orphans"
          value={result.orphans.length.toLocaleString()}
          severity={result.orphans.length ? "serious" : "good"}
        />
        <StatTile
          label="Redirects"
          value={result.redirects.length.toLocaleString()}
          severity={result.redirects.length ? "warning" : "good"}
        />
        <StatTile
          label="Median resp."
          value={times.median === null ? "—" : `${times.median}ms`}
          detail={times.p95 === null ? undefined : `p95 ${times.p95}ms`}
        />
        <StatTile
          label="Soft-404"
          value={soft ? (soft.passed ? "PASS" : "FAIL") : "—"}
          severity={soft ? (soft.passed ? "good" : "serious") : undefined}
          detail={soft ? `probe → ${soft.status}` : "not run"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="HTTP status" className="lg:col-span-2" bodyClassName="p-4">
          <StatusBreakdown result={result} />
        </Panel>
        <Panel title="Scan parameters" bodyClassName="p-4">
          <dl className="space-y-2 font-mono text-xs">
            <Row label="Origin" value={new URL(result.origin).host} />
            <Row label="Sitemap" value={result.sitemapError ? "not found" : `${result.sitemapCount} URLs`} />
            <Row label="Page limit" value={result.truncated ? `${MAX_PAGES} (reached)` : `${MAX_PAGES}`} />
            <Row label="Concurrency" value={`${CONCURRENCY}`} />
            <Row label="Started" value={new Date(result.startedAt).toLocaleTimeString()} />
            <Row label="Duration" value={formatDuration(durationMs)} />
          </dl>
        </Panel>
      </div>

      <Panel>
        <Tabs items={tabs} value={tab} onChange={onTab} />
        {tab === "broken" && <BrokenTable result={result} />}
        {tab === "orphans" && <OrphanTable result={result} />}
        {tab === "redirects" && <RedirectTable result={result} />}
        {tab === "blocked" && <BlockedTable result={result} />}
        {tab === "unreachable" && <UnreachableTable result={result} />}
        {tab === "urls" && <AllUrlsTable result={result} />}
      </Panel>
    </div>
  );
}

/** Header actions: copy the text report, and the Export dropdown. */
function ReportActions({ result }: { result: ScanResult }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildTextReport(result));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex gap-1.5">
      <button type="button" onClick={copy} className={buttonClass.secondary} title="Copy a plain-text summary">
        {copied === "ok" ? <Check className="size-3.5 text-status-good" /> : <Copy className="size-3.5" />}
        {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy report"}
      </button>
      <ExportMenu result={result} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </div>
  );
}

function defaultTab(result: ScanResult): Tab {
  if (result.brokenLinks.length) return "broken";
  if (result.orphans.length) return "orphans";
  if (result.redirects.length) return "redirects";
  if (result.blocked.length) return "blocked";
  return "urls";
}
