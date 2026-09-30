"use client";

// Site Audit tool: scan form, live console, and results (overview + tabbed tables).
// The crawl itself runs in the browser via runScan (src/lib/crawler.ts).

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Globe, Play, RotateCcw, Square } from "lucide-react";
import { runScan } from "@/lib/crawler";
import {
  buildTextReport,
  friendlyError,
  homepageProblem,
  responseTimes,
  scanWarnings,
} from "@/lib/report";
import type { ScanProgress, ScanResult } from "@/lib/types";
import { parseSiteUrl } from "@/lib/url";
import { Notice, Panel, StatTile, Tag, buttonClass } from "@/components/ui/primitives";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ScanConsole, formatDuration, type LogEntry } from "./scan-console";
import { StatusBreakdown } from "./status-breakdown";
import { ExportMenu } from "./export-menu";
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
const CONCURRENCY = 5;
const LOG_LIMIT = 300;

type Tab = "urls" | "broken" | "orphans" | "redirects" | "blocked" | "unreachable";

export function SiteAudit() {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("broken");
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  // Tick the elapsed timer; Esc stops the scan.
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && controllerRef.current?.abort();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [scanning]);

  /** Back to an empty form. */
  function handleReset() {
    setUrl("");
    setResult(null);
    setError(null);
    setProgress(null);
    setLog([]);
    setTab("broken");
  }

  async function handleScan(e: FormEvent) {
    e.preventDefault();
    if (scanning) return;
    if (!parseSiteUrl(url)) {
      setError(friendlyError("Invalid URL"));
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const start = Date.now();
    let nextId = 0;

    setScanning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setLog([]);
    setStartedAt(start);
    setNow(start);

    try {
      const scan = await runScan(
        url,
        {
          maxPages: MAX_PAGES,
          concurrency: CONCURRENCY,
          signal: controller.signal,
          onFetch: (r, phase) => {
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
          },
        },
        setProgress,
      );
      setResult(scan);
      setTab(defaultTab(scan));
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(friendlyError(err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setScanning(false);
      setNow(Date.now());
      controllerRef.current = null;
    }
  }

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
          <Tag>limit {MAX_PAGES} pages</Tag>
          <Tag>{CONCURRENCY} workers</Tag>
          <Tag>15s timeout</Tag>
        </div>
      </header>

      <form onSubmit={handleScan} className="glass flex flex-col gap-2 rounded-xl p-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Website URL</span>
          <Globe className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={scanning}
            required
            className="h-10 w-full rounded-lg border border-transparent bg-canvas/60 pr-3 pl-10 font-mono text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
          />
        </label>
        {scanning ? (
          <button type="button" onClick={() => controllerRef.current?.abort()} className={buttonClass.danger}>
            <Square className="size-3.5 fill-current" />
            Stop
            <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[10px] opacity-70 sm:inline">
              Esc
            </kbd>
          </button>
        ) : (
          <>
            <button type="submit" className={buttonClass.primary}>
              <Play className="size-3.5 fill-current" />
              Run scan
            </button>
            {(url || result || error) && (
              <button type="button" onClick={handleReset} className={buttonClass.ghost}>
                <RotateCcw className="size-3.5" />
                Reset
              </button>
            )}
          </>
        )}
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      {scanning && <ScanConsole progress={progress} log={log} elapsedMs={now - startedAt} />}

      {result && (
        <Results result={result} tab={tab} onTab={setTab} durationMs={now - startedAt} />
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
