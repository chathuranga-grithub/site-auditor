"use client";

// Visit Test tool (local only): open a company site in a real browser through a proxy,
// find every internal page and open each one, then show what a visitor there experiences.

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CircleCheck, CircleMinus, CircleX, Copy, Globe, KeyRound, LayoutGrid, List, Loader2, Camera, CameraOff, Monitor, Smartphone, Play, Square, Timer, TriangleAlert } from "lucide-react";
import {
  buildChecklist,
  checklistHeadline,
  checklistTotals,
  discoverySources,
  pageActivities,
  pageProblems,
  type CheckStatus,
  type ChecklistItem,
} from "@/lib/visit-checklist";
import { MAX_PAGES, type Discovery, type ScrollResult, type VisitEvent, type VisitPage, type VisitReport } from "@/lib/visit-types";
import { Notice, Panel, StatTile, StatusCode, Tag, UrlLink, buttonClass } from "@/components/ui/primitives";
import { ACTIVITY_STYLE, DetailDialog, VisitPageCards } from "./visit-page-cards";
import { VisitPagesTable } from "./visit-pages-table";

/** Problems listed in the notice before "and N more". */
const ISSUES_SHOWN = 15;

export function VisitTest() {
  // ?url= fills in the site, e.g. when opened from a Keyword Rankings result. The test isn't started automatically.
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(() => searchParams.get("url") ?? "");
  const [proxyApi, setProxyApi] = useState("");
  const [mobile, setMobile] = useState(true);
  const [screenshots, setScreenshots] = useState(true);
  const [env, setEnv] = useState<{ local: boolean; savedProxyApi: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [pages, setPages] = useState<VisitPage[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  // Start time and time of the latest page, for the "time left" estimate.
  const [timing, setTiming] = useState({ start: 0, last: 0 });
  const [report, setReport] = useState<VisitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const discoveredRef = useRef(false);

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
    setDiscovery(null);
    discoveredRef.current = false;
    setReport(null);
    setTiming({ start: Date.now(), last: 0 });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/visit-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, proxyApiUrl: proxyApi, mobile, screenshots }),
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
        // The start page is sent again once its phone check is done: replace it, don't add it twice.
        setPages((p) => (e.page.kind === "start" && p.some((x) => x.kind === "start") ? p.map((x) => (x.kind === "start" ? e.page : x)) : [...p, e.page]));
        setTiming((t) => ({ ...t, last: Date.now() }));
        break;
      case "discovered":
        // The first count goes in the step log; later ones (pages found while visiting) only update the progress bar.
        if (!discoveredRef.current) setSteps((s) => [...s, discoveryMessage(e.discovery)]);
        discoveredRef.current = true;
        setDiscovery(e.discovery);
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
            Open one of our sites in a real browser through a Vietnam proxy. It finds every internal page (sitemap and
            start-page links), opens and scrolls each one, and checks it works for visitors there.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>runs on this computer</Tag>
          <Tag>every page once</Tag>
          <Tag>desktop + phone</Tag>
          <Tag>internal pages only</Tag>
        </div>
      </header>

      {notLocal && (
        <Notice tone="warning">
          Visit Test needs a real browser, so it only works when the app runs on a computer (<code>npm run dev</code>), not on the
          live site.
        </Notice>
      )}

      <form onSubmit={handleRun} className="glass grid gap-2 rounded-xl p-2 lg:grid-cols-[1.2fr_1fr_auto_auto_auto]">
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
        <div className="flex h-10 rounded-lg bg-canvas/60 p-1" role="radiogroup" aria-label="Devices">
          {([true, false] as const).map((m) => (
            <button
              key={String(m)}
              type="button"
              role="radio"
              aria-checked={mobile === m}
              onClick={() => setMobile(m)}
              disabled={running}
              title={m ? "Check every page on a desktop and on a phone (takes about twice as long)" : "Check every page on a desktop only (faster)"}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap transition ${
                mobile === m ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink"
              }`}
            >
              {m ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
              {m ? "Desktop + phone" : "Desktop only"}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={screenshots}
          onClick={() => setScreenshots((v) => !v)}
          disabled={running}
          title={screenshots ? "Screenshots on. Turn off for a faster, lighter test (all checks still run)." : "Screenshots off: faster and lighter, all checks still run. Turn on to see each page."}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition disabled:opacity-60 ${
            screenshots ? "bg-canvas/60 text-ink" : "bg-canvas/60 text-muted ring-1 ring-line-strong"
          }`}
        >
          {screenshots ? <Camera className="size-3.5" /> : <CameraOff className="size-3.5" />}
          {screenshots ? "Screenshots on" : "Screenshots off"}
        </button>
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
              const last = i === steps.length - 1 && running && !discovery;
              return (
                <li key={i} className={`flex gap-2 ${last ? "text-ink" : "text-muted"}`}>
                  {last ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent-2" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-status-good" />}
                  <span className="break-all">{s}</span>
                </li>
              );
            })}
          </ol>
          {discovery && discovery.total > 0 && (
            <Progress done={pages.filter((p) => p.kind === "internal").length} total={discovery.total} running={running} elapsedMs={timing.last - timing.start} />
          )}
        </Panel>
      )}

      {(report || pages.length > 0) && <Results report={report} pages={pages} />}
    </div>
  );
}

function Progress({ done, total, running, elapsedMs }: { done: number; total: number; running: boolean; elapsedMs: number }) {
  const pct = Math.round((done / total) * 100);
  const elapsed = elapsedMs / 1000;
  const left = done > 2 && running ? Math.round((elapsed / done) * (total - done)) : null;
  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
        <span className="text-ink">
          Page {done.toLocaleString()} of {total.toLocaleString()}
        </span>
        <span className="text-muted">
          {pct}%{left !== null && left > 0 ? ` · about ${formatWait(left)} left` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Pages visited">
        <div className="h-full rounded-full bg-series-1 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function discoveryMessage(d: Discovery) {
  const found = d.total + d.leftOut;
  if (!found) return "No other internal pages found on the start page or in a sitemap.";
  return `Found ${found} internal page${found === 1 ? "" : "s"} (${discoverySources(d)}). ${
    d.leftOut ? `Visiting the first ${MAX_PAGES}` : "Visiting all of them"
  }, 3 at a time. Links on each page are followed too, so the total can grow…`;
}

function Results({ report, pages }: { report: VisitReport | null; pages: VisitPage[] }) {
  const start = pages.find((p) => p.kind === "start") ?? null;
  const okPages = pages.filter((p) => p.ok).length;
  const jsPages = pages.filter((p) => p.consoleErrors.length).length;
  const scrolled = pages.filter((p) => p.scroll);
  const images = scrolled.reduce((n, p) => n + p.scroll!.images, 0);
  const brokenImages = scrolled.reduce((n, p) => n + p.scroll!.brokenImages.length, 0);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [openPage, setOpenPage] = useState<VisitPage | null>(null);
  // Screenshots turned off: no picture areas in the results, so they stay compact.
  const hasShots = pages.some((p) => p.screenshot || p.mobile?.screenshot);
  const exit = report?.exit;

  return (
    <div className="space-y-5">
      {report && <Checklist report={report} />}

      {report && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {report.issues.length === 0 ? (
            <Notice tone="info" className="flex-1">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <CircleCheck className="size-4 text-status-good" /> No problems found. All {pages.length} pages worked for a visitor
                {exit?.country ? ` in ${exit.country}` : ""}.
              </span>
            </Notice>
          ) : (
            <Notice tone="warning" className="flex-1">
              <div className="font-medium">
                {report.issues.length} problem{report.issues.length === 1 ? "" : "s"} found
                {report.cancelled ? " (test stopped early)" : ""}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 break-words">
                {report.issues.slice(0, ISSUES_SHOWN).map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
              {report.issues.length > ISSUES_SHOWN && (
                <div className="mt-1 text-xs">…and {report.issues.length - ISSUES_SHOWN} more. Use the Problems filter below, or Copy summary.</div>
              )}
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
        <StatTile label="JS errors" value={jsPages} detail={`pages with errors, of ${pages.length}`} severity={jsPages ? "warning" : pages.length ? "good" : undefined} />
        <StatTile
          label="Images"
          value={scrolled.length ? `${images - brokenImages}/${images}` : "—"}
          detail={scrolled.length ? (brokenImages ? `${brokenImages} broken` : "all pages, after scrolling") : "all pages"}
          severity={scrolled.length ? (brokenImages ? "warning" : "good") : undefined}
        />
      </div>

      {pages.length > 0 && (
        <Panel
          title={"All pages visited · " + pages.length + (report?.discovery ? " of " + (report.discovery.total + 1) : "")}
          actions={
            <div className="flex rounded-lg bg-canvas/60 p-0.5" role="radiogroup" aria-label="View">
              {(["cards", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition " + (view === v ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink")}
                >
                  {v === "cards" ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
                  {v === "cards" ? "Cards" : "List"}
                </button>
              ))}
            </div>
          }
          bodyClassName=""
        >
          {view === "cards" ? (
            <VisitPageCards pages={pages} onOpen={setOpenPage} showShots={hasShots} />
          ) : (
            <VisitPagesTable pages={pages} onOpen={setOpenPage} showShots={hasShots} />
          )}
        </Panel>
      )}

      {openPage && (
        <DetailDialog onClose={() => setOpenPage(null)}>
          <PageCard page={openPage} heading={openPage.kind === "start" ? "Start page" : (openPage.title ?? "Page")} scroll={openPage.scroll} large />
        </DetailDialog>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "NOT RUN" };

const STATUS_STYLE: Record<CheckStatus, { icon: typeof CircleCheck; color: string }> = {
  pass: { icon: CircleCheck, color: "text-status-good" },
  warn: { icon: TriangleAlert, color: "text-status-warning" },
  fail: { icon: CircleX, color: "text-status-critical" },
  skip: { icon: CircleMinus, color: "text-subtle" },
};

/** Every step the test performed, marked pass / warning / fail. */
function Checklist({ report }: { report: VisitReport }) {
  const items = buildChecklist(report);
  const t = checklistTotals(items);
  const overall: CheckStatus = t.fail ? "fail" : t.warn ? "warn" : "pass";
  const O = STATUS_STYLE[overall];
  return (
    <Panel
      title="Test results"
      actions={
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${O.color}`}>
          <O.icon className="size-4" aria-hidden />
          {checklistHeadline(items)}
        </span>
      }
    >
      <ol className="divide-y divide-line">
        {items.map((c, i) => {
          const S = STATUS_STYLE[c.status];
          return (
            <li key={c.id} className="grid grid-cols-[1.5rem_1fr_auto] items-start gap-3 px-4 py-2.5 sm:grid-cols-[1.5rem_14rem_1fr_auto]">
              <span className="pt-0.5 font-mono text-xs text-subtle tabular-nums">{i + 1}</span>
              <span className="text-sm text-ink">{c.label}</span>
              <span className="col-span-2 col-start-2 text-xs break-words text-muted sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:text-sm">
                {c.detail}
              </span>
              <span className={`col-start-3 row-start-1 inline-flex items-center gap-1.5 justify-self-end font-mono text-xs font-semibold ${S.color} sm:col-start-4`}>
                <S.icon className="size-4" aria-hidden />
                {STATUS_TEXT[c.status]}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function PageCard({
  page,
  heading,
  scroll,
  large = false,
  onOpen,
}: {
  page: VisitPage;
  heading: string;
  scroll?: ScrollResult | null;
  /** In the details popup: big screenshots side by side, details below. */
  large?: boolean;
  /** Clicking a screenshot opens the details popup. */
  onOpen?: () => void;
}) {
  const phone = page.mobile?.screenshot;
  const menu = page.menus?.mobile?.screenshot;
  const anyShot = !!(page.screenshot || phone || menu);
  const desktop = page.screenshot ? (
    // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot
    <img src={page.screenshot} alt={`Desktop screenshot of ${page.title ?? page.url}`} className="block w-full" />
  ) : (
    <div className="grid aspect-video place-items-center text-xs text-subtle">No screenshot</div>
  );

  return (
    <Panel
      title={heading}
      actions={
        <span className="inline-flex items-center gap-3 font-mono text-xs text-muted">
          {page.status !== null ? <StatusCode status={page.status} /> : <span className="text-status-serious">no response</span>}
          {page.loadMs != null && <span>{formatMs(page.loadMs)}</span>}
        </span>
      }
      bodyClassName={`grid gap-5 p-4 ${large || !anyShot ? "" : "md:grid-cols-[minmax(0,17rem)_1fr] xl:grid-cols-[minmax(0,24rem)_1fr]"}`}
    >
      {!anyShot ? null : large ? (
        <div className="flex items-start gap-3">
          <figure className="min-w-0 flex-1">
            <div className="overflow-hidden rounded-lg border border-line bg-black/30">{desktop}</div>
            <figcaption className="mt-1 text-center font-mono text-[10px] text-subtle">Desktop</figcaption>
          </figure>
          {phone && <PhoneShot src={phone} label="Phone" />}
          {menu && <PhoneShot src={menu} label="Phone menu open" />}
        </div>
      ) : (
        // Screenshots grouped: desktop on top, phone views side by side below it.
        <div className="space-y-3">
          <figure>
            <button
              type="button"
              onClick={onOpen}
              disabled={!onOpen}
              title={onOpen ? "Open bigger screenshots" : undefined}
              className="block w-full overflow-hidden rounded-lg border border-line bg-black/30 transition enabled:hover:border-line-strong"
            >
              {desktop}
            </button>
            <figcaption className="mt-1 font-mono text-[10px] text-subtle">Desktop</figcaption>
          </figure>
          {(phone || menu) && (
            <div className="flex gap-3">
              {phone && <PhoneShot src={phone} label="Phone" size="md" onClick={onOpen} />}
              {menu && <PhoneShot src={menu} label="Phone menu open" size="md" onClick={onOpen} />}
            </div>
          )}
        </div>
      )}

      <div className="min-w-0 space-y-3 text-sm">
        <div className="space-y-1">
          <div className="font-medium break-words text-ink">{page.title ?? "(no title)"}</div>
          <UrlLink href={page.finalUrl} full />
          {page.linkText && <div className="text-xs text-muted">Link text: &ldquo;{page.linkText}&rdquo;</div>}
          {page.kind === "internal" && (
            <div className="text-xs">
              <span className="text-muted">
                {page.foundIn === "another page" ? "Found through a link on another page" : `Found in the ${page.foundIn ?? "sitemap"}`}
              </span>
              {page.note && <span className="text-muted"> · {page.note}</span>}
            </div>
          )}
          {page.error && (
            <div className="flex gap-1.5 text-xs text-status-serious">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {page.error}
            </div>
          )}
        </div>
        <ActivityList items={pageActivities(page)} />
        <Details title="Still loading after 30s" items={page.stillLoading ?? []} />
        <Details title="JavaScript errors" items={page.consoleErrors} />
        <Details title="Files that failed to load" items={page.failedRequests} />
        {scroll && <Details title="Broken images" items={scroll.brokenImages} />}
        {page.mobile && <Details title="Broken images on a phone" items={page.mobile.brokenImages} />}
      </div>
    </Panel>
  );
}

function PhoneShot({ src, label, size = "lg", onClick }: { src: string; label: string; size?: "md" | "lg"; onClick?: () => void }) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot
    <img src={src} alt={`${label} screenshot`} className="block w-full rounded-lg border border-line bg-black/30" />
  );
  return (
    <figure className={`shrink-0 ${size === "md" ? "w-28" : "w-28 sm:w-36"}`}>
      {onClick ? (
        <button type="button" onClick={onClick} title="Open bigger screenshots" className="block w-full rounded-lg transition hover:opacity-90">
          {img}
        </button>
      ) : (
        img
      )}
      <figcaption className="mt-1 text-center font-mono text-[10px] text-subtle">{label}</figcaption>
    </figure>
  );
}

/** "What was checked" on one page: every step with PASS / WARN / FAIL. */
function ActivityList({ items }: { items: ChecklistItem[] }) {
  return (
    <div className="@container rounded-lg border border-line">
      <div className="border-b border-line px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
        What was checked · {items.filter((i) => i.status === "pass").length}/{items.length} passed
      </div>
      <ul className="divide-y divide-line">
        {items.map((i) => {
          const S = ACTIVITY_STYLE[i.status];
          return (
            <li key={i.id} className="grid grid-cols-[1rem_1fr_auto] items-start gap-x-2 gap-y-0.5 @md:grid-cols-[1rem_minmax(0,9.5rem)_1fr_auto] px-3 py-1.5 text-xs">
              <S.icon className={`mt-0.5 size-3.5 ${S.color}`} aria-hidden />
              <span className="text-ink">{i.label}</span>
              <span className="col-start-2 row-start-2 min-w-0 break-words text-muted @md:col-start-3 @md:row-start-1">{i.detail}</span>
              <span className={`col-start-3 row-start-1 font-mono text-[10px] font-semibold ${S.color} @md:col-start-4`}>{S.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
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
      `Result: ${checklistHeadline(buildChecklist(report))}`,
      "",
      ...buildChecklist(report).map((c) => `[${STATUS_TEXT[c.status]}] ${c.label}: ${c.detail}`),
      "",
      ...(report.issues.length ? ["Problems:", ...report.issues.map((i) => `- ${i}`), ""] : []),
      "Pages:",
      ...all.map((p) => {
        const problems = pageProblems(p);
        return `${problems.length ? "!! " : "OK "} ${p.status ?? "---"}  ${p.loadMs != null ? formatMs(p.loadMs) : "-"}  ${p.finalUrl}${problems.length ? `  (${problems.join("; ")})` : ""}`;
      }),
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
