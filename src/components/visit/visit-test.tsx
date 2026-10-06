"use client";

// Visit Test tool (local only): open a company site in a real browser through a proxy,
// scroll it and click a few internal pages, then show what a visitor there experiences.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CircleCheck, Copy, Globe, KeyRound, Loader2, Play, Square, Timer, TriangleAlert } from "lucide-react";
import { PAGE_LIMITS, type PageLimit, type ScrollResult, type VisitEvent, type VisitPage, type VisitReport } from "@/lib/visit-types";
import { Notice, Panel, StatTile, StatusCode, Tag, UrlLink, buttonClass } from "@/components/ui/primitives";

export function VisitTest() {
  const [url, setUrl] = useState("");
  const [proxyApi, setProxyApi] = useState("");
  const [maxPages, setMaxPages] = useState<PageLimit>(5);
  const [env, setEnv] = useState<{ local: boolean; savedProxyApi: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [pages, setPages] = useState<VisitPage[]>([]);
  const [scroll, setScroll] = useState<ScrollResult | null>(null);
  const [report, setReport] = useState<VisitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/visit-test")
      .then((r) => r.json())
      .then(setEnv)
      .catch(() => setEnv({ local: true, savedProxyApi: false }));
  }, []);

  // Countdown while the proxy provider makes us wait for a new IP.
  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= waitUntil) setWaitUntil(null);
    }, 1000);
    return () => clearInterval(t);
  }, [waitUntil]);
  const waitLeft = waitUntil ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : 0;

  async function handleRun(e: FormEvent) {
    e.preventDefault();
    if (running || waitLeft > 0) return;
    setError(null);
    setSteps([]);
    setPages([]);
    setScroll(null);
    setReport(null);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/visit-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, proxyApiUrl: proxyApi, maxPages }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line) as VisitEvent);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      else setSteps((s) => [...s, "Stopped."]);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function handleEvent(e: VisitEvent) {
    switch (e.type) {
      case "step":
        setSteps((s) => [...s, e.message]);
        break;
      case "page":
        setPages((p) => [...p, e.page]);
        break;
      case "scroll":
        setScroll(e.scroll);
        break;
      case "done":
        setReport(e.report);
        break;
      case "wait":
        setNow(Date.now());
        setWaitUntil(Date.now() + e.seconds * 1000);
        break;
      case "error":
        setError(e.message);
        break;
    }
  }

  const notLocal = env && !env.local;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools / Visit Test</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Visit <span className="text-gradient">Test</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Open one of our sites in a real browser through a Vietnam proxy, scroll it and click a few internal pages,
            to check it works for visitors there.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>runs on this computer</Tag>
          <Tag>1 visit per test</Tag>
          <Tag>internal links only</Tag>
        </div>
      </header>

      {notLocal && (
        <Notice tone="warning">
          Visit Test needs a real browser, so it only works when the app runs on a computer (<code>npm run dev</code>), not on the
          live site.
        </Notice>
      )}

      <form onSubmit={handleRun} className="glass grid gap-2 rounded-xl p-2 lg:grid-cols-[1.2fr_1fr_auto_auto]">
        <label className="relative block">
          <span className="sr-only">Website URL</span>
          <Globe className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={running}
            required
            placeholder="Company site, e.g. https://example.com"
            className="h-10 w-full rounded-lg border border-transparent bg-canvas/60 pr-3 pl-10 font-mono text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
          />
        </label>
        <label className="relative block">
          <span className="sr-only">Proxy API link</span>
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="password"
            autoComplete="off"
            value={proxyApi}
            onChange={(e) => setProxyApi(e.target.value)}
            disabled={running}
            required={!env?.savedProxyApi}
            placeholder={env?.savedProxyApi ? "Proxy API: using the saved link" : "Proxy API link"}
            title="The link that returns {status, data: {proxy: 'ip:port'}}. It stays on this computer."
            className="h-10 w-full rounded-lg border border-transparent bg-canvas/60 pr-3 pl-10 font-mono text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
          />
        </label>
        <div className="flex h-10 rounded-lg bg-canvas/60 p-1" role="radiogroup" aria-label="Internal pages to visit">
          {PAGE_LIMITS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={maxPages === n}
              onClick={() => setMaxPages(n)}
              disabled={running}
              title={`Click up to ${n} internal links`}
              className={`flex-1 rounded-md px-3 text-xs font-medium whitespace-nowrap transition ${
                maxPages === n ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink"
              }`}
            >
              {n} pages
            </button>
          ))}
        </div>
        {running ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className={buttonClass.danger}>
            <Square className="size-3.5 fill-current" />
            Stop
          </button>
        ) : (
          <button type="submit" disabled={waitLeft > 0 || !!notLocal} className={buttonClass.primary}>
            {waitLeft > 0 ? <Timer className="size-4" /> : <Play className="size-3.5 fill-current" />}
            {waitLeft > 0 ? formatWait(waitLeft) : "Run test"}
          </button>
        )}
      </form>

      {waitLeft > 0 && (
        <Notice tone="info">
          The proxy provider gives a new IP in <strong className="font-mono">{formatWait(waitLeft)}</strong>. The test can run again then; the button
          turns back on by itself.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {(running || steps.length > 0) && (
        <Panel title={running ? "Running" : "Steps"} bodyClassName="p-4">
          <ol className="space-y-1.5 font-mono text-xs">
            {steps.map((s, i) => {
              const last = i === steps.length - 1 && running;
              return (
                <li key={i} className={`flex gap-2 ${last ? "text-ink" : "text-muted"}`}>
                  {last ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent-2" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-status-good" />}
                  <span className="break-all">{s}</span>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      {(report || pages.length > 0) && <Results report={report} pages={pages} scroll={scroll} />}
    </div>
  );
}

function Results({ report, pages, scroll }: { report: VisitReport | null; pages: VisitPage[]; scroll: ScrollResult | null }) {
  const start = pages.find((p) => p.kind === "start") ?? null;
  const internal = pages.filter((p) => p.kind === "internal");
  const okPages = pages.filter((p) => p.ok).length;
  const jsErrors = pages.reduce((n, p) => n + p.consoleErrors.length, 0);
  const exit = report?.exit;

  return (
    <div className="space-y-5">
      {report && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {report.issues.length === 0 ? (
            <Notice tone="info" className="flex-1">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <CircleCheck className="size-4 text-status-good" /> No problems found. The site worked for a visitor
                {exit?.country ? ` in ${exit.country}` : ""}.
              </span>
            </Notice>
          ) : (
            <Notice tone="warning" className="flex-1">
              <div className="font-medium">
                {report.issues.length} problem{report.issues.length === 1 ? "" : "s"} found
                {report.cancelled ? " (test stopped early)" : ""}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {report.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Notice>
          )}
          <CopySummary report={report} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Visitor location"
          value={exit?.country ?? "—"}
          detail={exit ? [exit.city, exit.countryCode].filter(Boolean).join(", ") : "checking…"}
          severity={exit ? (exit.countryCode === "VN" ? "good" : "warning") : undefined}
        />
        <StatTile label="IP / network" value={<span className="text-base">{exit?.ip ?? "—"}</span>} detail={exit?.org ?? (report?.proxy?.reused ? "previous proxy reused" : "")} />
        <StatTile
          label="Pages OK"
          value={`${okPages}/${pages.length}`}
          detail="start + internal"
          severity={pages.length ? (okPages === pages.length ? "good" : "serious") : undefined}
        />
        <StatTile label="Start page load" value={start?.loadMs != null ? formatMs(start.loadMs) : "—"} detail={start?.ttfbMs != null ? `first byte ${formatMs(start.ttfbMs)}` : ""} />
        <StatTile label="JS errors" value={jsErrors} detail="all pages" severity={jsErrors ? "warning" : pages.length ? "good" : undefined} />
        <StatTile
          label="Images"
          value={scroll ? `${scroll.imagesLoaded}/${scroll.images}` : "—"}
          detail={scroll ? (scroll.brokenImages.length ? `${scroll.brokenImages.length} broken` : "loaded after scrolling") : "start page"}
          severity={scroll ? (scroll.brokenImages.length ? "warning" : "good") : undefined}
        />
      </div>

      {start && <PageCard page={start} heading="Start page" scroll={scroll} />}

      {internal.length > 0 && (
        <div>
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.18em] text-muted uppercase">
            Internal pages visited · {internal.length}
            {report ? ` of ${report.linksFound} found` : ""}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {internal.map((p, i) => (
              <PageCard key={`${p.url}-${i}`} page={p} heading={`Page ${i + 1}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PageCard({ page, heading, scroll }: { page: VisitPage; heading: string; scroll?: ScrollResult | null }) {
  const [big, setBig] = useState(false);
  return (
    <Panel
      title={heading}
      actions={
        <span className="inline-flex items-center gap-3 font-mono text-xs text-muted">
          {page.status !== null ? <StatusCode status={page.status} /> : <span className="text-status-serious">no response</span>}
          {page.loadMs != null && <span>{formatMs(page.loadMs)}</span>}
        </span>
      }
      bodyClassName="grid gap-4 p-4 sm:grid-cols-[minmax(0,14rem)_1fr]"
    >
      {page.screenshot ? (
        <button
          type="button"
          onClick={() => setBig((b) => !b)}
          title={big ? "Smaller" : "Bigger"}
          className={`overflow-hidden rounded-lg border border-line bg-black/30 ${big ? "sm:col-span-2" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL screenshot */}
          <img src={page.screenshot} alt={`Screenshot of ${page.title ?? page.url}`} className="block w-full" />
        </button>
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-line text-xs text-subtle">
          No screenshot
        </div>
      )}

      <div className="min-w-0 space-y-2 text-sm">
        <div className="font-medium break-words text-ink">{page.title ?? "(no title)"}</div>
        <UrlLink href={page.finalUrl} full />
        {page.linkText && <div className="text-xs text-muted">Link text: &ldquo;{page.linkText}&rdquo;</div>}
        {page.how && (
          <div className="text-xs">
            <span className={page.how === "clicked" ? "text-status-good" : "text-status-warning"}>
              {page.how === "clicked" ? "Clicked like a visitor" : "Opened directly"}
            </span>
            {page.note && <span className="text-muted"> · {page.note}</span>}
          </div>
        )}
        {page.error && (
          <div className="flex gap-1.5 text-xs text-status-serious">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {page.error}
          </div>
        )}
        {scroll && (
          <div className="text-xs text-muted">
            Scrolled {scroll.reachedBottom ? "to the bottom" : "partway"} in {scroll.steps} steps (
            {scroll.pageHeight.toLocaleString()}px tall). Images: {scroll.imagesLoaded}/{scroll.images} loaded
            {scroll.brokenImages.length ? `, ${scroll.brokenImages.length} broken` : ""}.
          </div>
        )}
        <Details title="JavaScript errors" items={page.consoleErrors} />
        <Details title="Files that failed to load" items={page.failedRequests} />
        {scroll && <Details title="Broken images" items={scroll.brokenImages} />}
      </div>
    </Panel>
  );
}

function Details({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
      <summary className="text-status-warning">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 space-y-1 font-mono text-[11px] break-all text-muted">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </details>
  );
}

function CopySummary({ report }: { report: VisitReport }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const all = [report.start, ...report.pages].filter((p): p is VisitPage => !!p);
    const lines = [
      `Visit test: ${report.url}`,
      `From: ${report.exit ? `${report.exit.country ?? "?"} · ${report.exit.ip}${report.exit.org ? ` · ${report.exit.org}` : ""}` : "unknown location"}`,
      `Result: ${report.issues.length ? `${report.issues.length} problem(s)` : "no problems found"}`,
      ...report.issues.map((i) => `- ${i}`),
      "",
      ...all.map((p) => `${p.ok ? "OK " : "ERR"} ${p.status ?? "---"}  ${p.loadMs != null ? formatMs(p.loadMs) : "-"}  ${p.finalUrl}`),
    ];
    await navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={copy} className={buttonClass.secondary}>
      {copied ? <Check className="size-3.5 text-status-good" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy summary"}
    </button>
  );
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatWait(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
