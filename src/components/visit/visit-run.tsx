"use client";

// A campaign's visit console (local only): the site opened in a real browser through a proxy,
// every internal page found and opened, and what a visitor there experiences.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleCheck, CircleMinus, CircleX, Clock, Copy, Loader2, TriangleAlert } from "lucide-react";
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
import { MAX_PAGES, OVERFLOW_PX, type Discovery, type VisitEvent, type VisitPage, type VisitReport, type VisitStage } from "@/lib/visit-types";
import { Notice, Panel, StatusCode, UrlLink, buttonClass } from "@/components/ui/primitives";
import { ACTIVITY_STYLE, DetailDialog } from "./visit-dialog";

/** Problems listed in the notice before "and N more". */
const ISSUES_SHOWN = 15;

export type VisitRun = ReturnType<typeof useVisitRun>;

/** One lane of a campaign's visit: the runs it does one after another, shown in its own tab. */
interface Lane {
  steps: string[];
  pages: LoggedPage[];
  discovery: Discovery | null;
  /** The first page count went in the steps already. */
  discovered: boolean;
  /** Start time and time of the latest page, for the "time left" estimate. */
  timing: { start: number; last: number };
  report: VisitReport | null;
  error: string | null;
  /** What it's waiting for now, until when (null: not known, shown as time waited so far), since when. */
  wait: { reason: string; until: number | null; since: number } | null;
  /** The run it's on now, e.g. 3 of 20. */
  run: { n: number; of: number } | null;
  /** Runs this lane has finished. */
  finished: number;
  /** The proxy link (number in Settings) and the proxy IP of the run going on now. */
  link: { number: number; of: number } | null;
  ip: string | null;
  /** Stopped by hand (pause or stop). */
  stopped: boolean;
  /** The step the run is on (VisitSteps), and the steps that only happen sometimes: did they. */
  stage: VisitStage | null;
  captcha: boolean;
  clicked: boolean;
  /** The last run that reached the site: its pages and results, shown until this run has pages of its own. */
  last: { run: { n: number; of: number } | null; pages: LoggedPage[]; discovery: Discovery | null; report: VisitReport | null } | null;
}

const newLane = (): Lane => ({ steps: [], pages: [], discovery: null, discovered: false, timing: { start: 0, last: 0 }, report: null, error: null, wait: null, run: null, finished: 0, link: null, ip: null, stopped: false, stage: null, captcha: false, clicked: false, last: null });

/** A lane's next state for one console line. */
function laneReducer(l: Lane, e: VisitEvent, at: number): Lane {
  const timing = l.timing.start ? l.timing : { ...l.timing, start: at };
  switch (e.type) {
    case "step":
      // Stopped: no more waiting, so the countdown goes.
      return { ...l, timing, steps: [...l.steps, e.message], ...(e.message === "Stopped." ? { stopped: true, wait: null } : {}) };
    case "run":
      // The lane's next run starts: its steps, pages and results start over (the tab keeps its count).
      return { ...newLane(), last: l.pages.length ? { run: l.run, pages: l.pages, discovery: l.discovery, report: l.report } : l.last, steps: [`Run ${e.n} of ${e.of}: new visit${e.deviceName ? ` on a ${e.deviceName}` : e.device ? ` on a ${e.device}` : ""}`], timing: { start: at, last: 0 }, run: { n: e.n, of: e.of }, finished: l.finished, link: e.link ?? null };
    case "page": {
      // The start page is sent again once its phone check is done: replace it, don't add it twice.
      const logged: LoggedPage = { ...e.page, at };
      const pages = logged.kind === "start" && l.pages.some((x) => x.kind === "start") ? l.pages.map((x) => (x.kind === "start" ? { ...logged, at: x.at } : x)) : [...l.pages, logged];
      return { ...l, pages, timing: { ...timing, last: at } };
    }
    case "discovered":
      // The first count goes in the step log; later ones (pages found while visiting) only update the progress bar.
      return { ...l, timing, discovery: e.discovery, discovered: true, steps: l.discovered ? l.steps : [...l.steps, discoveryMessage(e.discovery)] };
    case "done":
      return { ...l, timing, report: e.report, wait: null, finished: l.finished + 1 };
    case "proxy":
      return { ...l, timing, ip: e.exit?.ip ?? null, wait: null };
    case "wait":
      return { ...l, timing, wait: { reason: e.reason ?? "a new proxy IP from the provider", until: e.seconds === null ? null : at + e.seconds * 1000, since: at } };
    case "waited":
      return { ...l, timing, wait: null };
    case "stage":
      return { ...l, timing, stage: e.stage, captcha: l.captcha || e.stage === "captcha", clicked: l.clicked || e.stage === "click" };
    case "error":
      return { ...l, timing, error: e.message };
    default:
      return l;
  }
}

/**
 * A campaign's visit console: everything the live logs and results need, per lane. A campaign with
 * concurrency N runs N visits side by side (lanes 1..N); lines without a lane are about the whole visit.
 */
export function useVisitRun() {
  const [env, setEnv] = useState<{ local: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  /** Lines about the whole visit (no lane). */
  const [common, setCommon] = useState<string[]>([]);
  const [lanes, setLanes] = useState<Record<number, Lane>>({});
  const [selected, setSelected] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** Runs finished in any lane, so the page can reload its numbers. */
  const [reports, setReports] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const [openPage, setOpenPage] = useState<VisitPage | null>(null);
  /** Every visit finished since the page started following (newest last), for the visits table. */
  const [visits, setVisits] = useState<FinishedVisit[]>([]);
  /** The run each lane is on, to number the finished visits. */
  const runOf = useRef<Record<number, { n: number; of: number }>>({});
  // Each start / follow gets a number; lines from an older one (still arriving) are ignored.
  const genRef = useRef(0);

  useEffect(() => {
    fetch("/api/ctr/visit-env")
      .then((r) => r.json())
      .then(setEnv)
      .catch(() => setEnv({ local: true }));
  }, []);

  // A clock while any lane waits (a countdown, or the time waited so far).
  const waiting = running && Object.values(lanes).some((l) => !l.stopped && l.wait);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  /** Reads a newline-delimited JSON console until it ends. */
  const consume = useCallback(async (request: (signal: AbortSignal) => Promise<Response>) => {
    abortRef.current?.abort();
    const gen = ++genRef.current;
    const current = () => genRef.current === gen;
    setError(null);
    setCommon([]);
    setLanes({});
    setVisits([]);
    runOf.current = {};
    setSelected(1);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const handle = (e: VisitEvent & { at?: number; lane?: number }) => {
      const at = e.at ?? Date.now();
      if (e.type === "wait" || e.type === "waited") setNow(Date.now());
      const laneNo = e.lane ?? 1;
      if (e.type === "run") runOf.current[laneNo] = { n: e.n, of: e.of };
      if (e.type === "done") {
        setReports((n) => n + 1);
        const run = runOf.current[laneNo] ?? null;
        setVisits((v) => [...v, { lane: laneNo, run, report: e.report, at }]);
      }
      if (!e.lane) {
        if (e.type === "step") setCommon((s) => [...s, e.message]);
        else if (e.type === "error") setError(e.message);
        else setLanes((all) => ({ ...all, 1: laneReducer(all[1] ?? newLane(), e, at) })); // older servers: one lane, no tag
        return;
      }
      const lane = e.lane;
      setLanes((all) => ({ ...all, [lane]: laneReducer(all[lane] ?? newLane(), e, at) }));
    };

    try {
      const res = await request(controller.signal);
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || !current()) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as VisitEvent & { at?: number; lane?: number });
      }
    } catch (err) {
      if (!current()) return;
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current()) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, []);

  /** Auto CTR: shows the campaign's visit (all lines so far, then live). Returns a function that stops following. */
  const follow = useCallback(
    (campaignId: number) => {
      void consume((signal) => fetch(`/api/ctr/campaigns/${campaignId}/visit`, { signal, cache: "no-store" }));
      return () => abortRef.current?.abort();
    },
    [consume],
  );

  const laneNumbers = Object.keys(lanes)
    .map(Number)
    .sort((a, b) => a - b);
  const shown = lanes[selected] ? selected : (laneNumbers[0] ?? 1);
  return {
    follow,
    running,
    common,
    lanes,
    laneNumbers,
    selected: shown,
    setSelected,
    error,
    reports,
    now,
    notLocal: !!env && !env.local,
    openPage,
    setOpenPage,
    visits,
  };
}

/** The visit's notices, then its console: one tab per visit running side by side (when several do), and the chosen visit's results. */
export function VisitRunView({ run }: { run: VisitRun }) {
  const { running, common, lanes, laneNumbers, selected, setSelected, error, now, notLocal, openPage, setOpenPage, visits } = run;
  const lane = lanes[selected] ?? null;
  const tabbed = laneNumbers.length > 1;
  return (
    <>
      {notLocal && (
        <Notice tone="warning">
          Campaign visits need a real browser, so it only works when the app runs on a computer (<code>npm run dev</code>), not on the
          live site.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!tabbed && common.length > 0 && <CommonSteps steps={common} />}

      {tabbed ? (
        <section className="glass overflow-hidden rounded-xl">
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3">
            <h2 className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Visits</h2>
            <span className="text-xs text-subtle">
              {laneNumbers.length} at the same time · {laneNumbers.reduce((n, k) => n + lanes[k].finished, 0)} finished
            </span>
          </header>
          {common.length > 0 && (
            <div className="px-4 pt-2">
              <CommonSteps steps={common} />
            </div>
          )}
          <div role="tablist" aria-label="Visits running at the same time" className="mt-2 flex gap-0.5 overflow-x-auto border-b border-line px-2">
            {laneNumbers.map((n) => (
              <LaneTab key={n} n={n} lane={lanes[n]} active={n === selected} onSelect={() => setSelected(n)} running={running} now={now} />
            ))}
          </div>
          {lane && (
            <div role="tabpanel" id={`visit-lane-${selected}`} aria-labelledby={`visit-tab-${selected}`} className="p-4">
              <LaneFacts lane={lane} />
              <VisitSteps lane={lane} running={running} />
              <LaneNotices lane={lane} running={running} now={now} />
              <LaneConsole lane={lane} running={running} onOpen={setOpenPage} />
              <LastRun lane={lane} onOpen={setOpenPage} />
            </div>
          )}
        </section>
      ) : (
        lane && (
          <>
            <VisitSteps lane={lane} running={running} />
            <LaneNotices lane={lane} running={running} now={now} />
            {(running || lane.steps.length > 0) && (
              <Panel title={running ? "Running" : "Steps"} bodyClassName="p-4">
                <LaneConsole lane={lane} running={running} onOpen={setOpenPage} />
                <LastRun lane={lane} onOpen={setOpenPage} />
              </Panel>
            )}
          </>
        )
      )}

      {visits.length > 0 && <VisitsTable visits={visits} tabbed={tabbed} onOpen={setOpenPage} />}

      {lane && (lane.report || lane.pages.length > 0) && <Results report={lane.report} pages={lane.pages} />}

      {openPage && (
        <DetailDialog onClose={() => setOpenPage(null)}>
          <PageDetails page={openPage} heading={openPage.kind === "start" ? "Start page" : (openPage.title ?? "Page")} />
        </DetailDialog>
      )}
    </>
  );
}

type LaneState = "running" | "waiting" | "done" | "failed" | "stopped";

/** A lane's state; once the visit isn't running, never "waiting" (no countdown after a stop). */
function laneState(l: Lane, running: boolean, now: number): LaneState {
  if (l.error) return "failed";
  if (l.stopped) return "stopped";
  if (!running) return "done";
  return l.wait && (l.wait.until === null || l.wait.until > now) ? "waiting" : "running";
}

/** A lane's wait on the clock: the time left when known, else the time waited so far. */
function waitClock(w: NonNullable<Lane["wait"]>, now: number): { left: boolean; seconds: number } {
  return w.until === null ? { left: false, seconds: Math.max(0, Math.floor((now - w.since) / 1000)) } : { left: true, seconds: Math.max(0, Math.ceil((w.until - now) / 1000)) };
}

const LANE_STATE: Record<LaneState, { icon: typeof CircleCheck; color: string; label: string }> = {
  running: { icon: Loader2, color: "text-accent-2", label: "Running" },
  waiting: { icon: Clock, color: "text-status-warning", label: "Waiting" },
  done: { icon: CircleCheck, color: "text-status-good", label: "Done" },
  failed: { icon: CircleX, color: "text-status-critical", label: "Failed" },
  stopped: { icon: CircleMinus, color: "text-subtle", label: "Stopped" },
};

/** One visit's tab, kept small: its state, its number, a wait countdown, and the runs it has finished. */
function LaneTab({ n, lane: l, active, onSelect, running, now }: { n: number; lane: Lane; active: boolean; onSelect: () => void; running: boolean; now: number }) {
  const state = laneState(l, running, now);
  const { icon: Icon, color, label } = LANE_STATE[state];
  const clock = l.wait ? waitClock(l.wait, now) : null;
  const detail = [state === "waiting" && l.wait ? `Waiting for ${l.wait.reason}` : label, l.run && `run ${l.run.n} of ${l.run.of}`, l.link && `proxy link #${l.link.number}`, `${l.finished} finished`].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      role="tab"
      id={`visit-tab-${n}`}
      aria-selected={active}
      aria-controls={`visit-lane-${n}`}
      onClick={onSelect}
      title={detail}
      className={`relative flex shrink-0 items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors ${
        active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      <Icon className={`size-3.5 shrink-0 ${color} ${state === "running" ? "animate-spin" : ""}`} aria-label={label} />
      <span className="font-medium">Visit {n}</span>
      {state === "waiting" && clock && <span className="font-mono text-[11px] text-status-warning">{clock.left ? formatWait(clock.seconds) : `+${formatWait(clock.seconds)}`}</span>}
      {l.finished > 0 && (
        <span className={`rounded px-1 font-mono text-[10px] tabular-nums ${active ? "bg-accent/20 text-ink" : "bg-surface-2 text-subtle"}`}>{l.finished}</span>
      )}
      {active && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-gradient-accent" aria-hidden />}
    </button>
  );
}

/** The open tab's facts: run, proxy link, IP, runs finished. */
function LaneFacts({ lane: l }: { lane: Lane }) {
  const facts: [string, string][] = [];
  if (l.run) facts.push(["Run", `${l.run.n} of ${l.run.of}`]);
  if (l.link) facts.push(["Proxy link", `#${l.link.number} of ${l.link.of}`]);
  if (l.ip) facts.push(["IP", l.ip]);
  facts.push(["Finished", String(l.finished)]);
  return (
    <dl className="mb-3 flex flex-wrap gap-2 text-xs">
      {facts.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5 rounded-md bg-canvas/60 px-2 py-1 ring-1 ring-line">
          <dt className="text-subtle">{k}</dt>
          <dd className="font-mono text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lines about the whole visit (no lane). */
const STEPS: { stage: VisitStage; label: string }[] = [
  { stage: "browser", label: "Open browser" },
  { stage: "search", label: "Search keyword" },
  { stage: "captcha", label: "CAPTCHA" },
  { stage: "click", label: "Click the site" },
  { stage: "visit", label: "Visit the site" },
  { stage: "done", label: "Visit complete" },
];

/**
 * The visit's steps in order, the one it's on now highlighted. Passed without a CAPTCHA (Google
 * didn't ask) or without a click (the site wasn't on Google's first page): that step is crossed out.
 */
/** Why a step was passed by: shown next to it. */
function skipWhy(stage: VisitStage, l: Lane): string {
  if (stage === "captcha") return "Google didn't ask";
  // Clicked only from Google's results: not reached when the CAPTCHA wasn't solved, or the site wasn't there.
  if (l.captcha && l.steps.some((m) => m.includes("CAPTCHA wasn't solved") || m.includes("it wasn't solved"))) return "CAPTCHA not solved: opened directly";
  if (l.steps.some((m) => m.includes("Only Vietnam can be searched"))) return "no Google search: opened directly";
  return "not on Google's first page: opened directly";
}

function VisitSteps({ lane: l, running }: { lane: Lane; running: boolean }) {
  if (!l.stage) return null;
  const at = STEPS.findIndex((s) => s.stage === l.stage);
  // The run ended without completing (it failed, or was stopped): the step it was on failed.
  const ended = !running || l.stopped || (!!l.report && l.stage !== "done");
  return (
    <ol aria-label="Visit steps" className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
      {STEPS.map((s, i) => {
        const skipped = (s.stage === "captcha" && !l.captcha) || (s.stage === "click" && !l.clicked);
        const state = i < at ? (skipped ? "skipped" : "done") : i === at ? (l.stage === "done" ? "done" : ended ? "failed" : "now") : "next";
        const style = {
          done: "bg-status-good/10 text-status-good ring-status-good/30",
          now: "bg-accent/15 font-medium text-ink ring-accent/50",
          failed: "bg-status-critical/10 text-status-critical ring-status-critical/30",
          skipped: "text-subtle ring-line",
          next: "text-subtle ring-line",
        }[state];
        return (
          <li key={s.stage} className="flex items-center gap-1" aria-current={state === "now" ? "step" : undefined}>
            {i > 0 && (
              <span aria-hidden className="text-subtle">
                →
              </span>
            )}
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ring-1 ${style}`}>
              {state === "done" && <Check aria-hidden className="size-3" />}
              {state === "now" && <Loader2 aria-hidden className="size-3 animate-spin" />}
              {state === "failed" && <CircleX aria-hidden className="size-3" />}
              {state === "skipped" ? <s>{s.label}</s> : s.label}
              {state === "skipped" && <span className="text-[10px]">({skipWhy(s.stage, l)})</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Until this run reaches the site's pages: the pages of the last run that did. */
function LastRun({ lane, onOpen }: { lane: Lane; onOpen: (page: VisitPage) => void }) {
  if (lane.pages.length || !lane.last) return null;
  const { run, pages, discovery } = lane.last;
  return (
    <div className="mt-4">
      <h3 className="mb-1 font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Pages visited{run ? ` · run ${run.n} of ${run.of}` : " · last run"}</h3>
      <LiveLog pages={pages} total={discovery ? discovery.total + 1 : null} onOpen={onOpen} />
    </div>
  );
}

/** A visit that finished (reached the site or not), for the visits table. */
interface FinishedVisit {
  lane: number;
  run: { n: number; of: number } | null;
  report: VisitReport;
  at: number;
}

/** Scrolls on one page: going down it to the bottom, and the small ones while reading it. */
const pageScrolls = (p: VisitPage) => (p.scroll?.steps ?? 0) + (p.readScrolls ?? 0);

/**
 * Every visit finished so far, newest first: how it reached the site, the pages it visited, its time
 * on the site and its scrolling. A row opens to show each page (time on it, scrolls, read to the bottom).
 */
function VisitsTable({ visits, tabbed, onOpen }: { visits: FinishedVisit[]; tabbed: boolean; onOpen: (page: VisitPage) => void }) {
  const done = visits.filter((v) => !v.report.stopReason && !v.report.cancelled && v.report.start?.ok);
  const avg = (f: (v: FinishedVisit) => number) => (done.length ? Math.round(done.reduce((n, v) => n + f(v), 0) / done.length) : 0);
  const pagesOf = (v: FinishedVisit) => [v.report.start, ...v.report.pages].filter((p): p is VisitPage => !!p && p.ok);
  return (
    <Panel title={`Visits (${visits.length})`} bodyClassName="p-0">
      {done.length > 0 && (
        <p className="border-b border-line px-4 py-2 text-xs text-muted">
          {done.length} completed · on average {avg((v) => pagesOf(v).length)} pages, {formatSec(avg((v) => v.report.onSiteSec ?? 0))} on the site,{" "}
          {avg((v) => pagesOf(v).reduce((n, p) => n + pageScrolls(p), 0))} scrolls
        </p>
      )}
      {/* One line per visit (details on click); a long list scrolls inside, the page stays short. */}
      <ol className="max-h-80 divide-y divide-line overflow-y-auto">
        {[...visits].reverse().map((v) => {
          const r = v.report;
          const pages = pagesOf(v);
          const scrolls = pages.reduce((n, p) => n + pageScrolls(p), 0);
          const bottom = pages.filter((p) => p.scroll?.reachedBottom).length;
          const ok = !r.stopReason && !r.cancelled && !!r.start?.ok;
          const facts = [
            r.deviceName ?? r.device ?? "desktop",
            r.exit?.ip,
            r.reachedBy === "google" ? "clicked on Google" : r.reachedBy === "direct" ? "opened directly" : null,
          ].filter(Boolean);
          return (
            <li key={`${v.at}-${v.lane}`}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs hover:bg-canvas/40">
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    {ok ? <CircleCheck aria-hidden className="size-3.5 text-status-good" /> : <CircleX aria-hidden className="size-3.5 text-status-critical" />}
                    {v.run ? `Visit ${v.run.n} of ${v.run.of}` : "Visit"}
                    {tabbed && <span className="font-normal text-subtle">· lane {v.lane}</span>}
                  </span>
                  <span className="text-muted">{facts.join(" · ")}</span>
                  {ok ? (
                    <span className="ml-auto flex flex-wrap gap-x-4 font-mono text-ink">
                      <span>{pages.length} pages</span>
                      <span>{formatSec(r.onSiteSec ?? 0)} on site</span>
                      <span>{scrolls} scrolls</span>
                      <span className="text-muted">{bottom}/{pages.length} read to the bottom</span>
                    </span>
                  ) : (
                    <span className="ml-auto text-status-critical">{r.cancelled ? "Stopped" : (r.stopReason ?? r.start?.error ?? "Didn't reach the site")}</span>
                  )}
                </summary>
                {pages.length > 0 && (
                  <table className="mb-2 w-full text-xs">
                    <thead>
                      <tr className="text-left text-subtle">
                        <th className="px-4 py-1 font-normal">Page</th>
                        <th className="px-2 py-1 font-normal">Loaded in</th>
                        <th className="px-2 py-1 font-normal">Read for</th>
                        <th className="px-2 py-1 font-normal">Scrolls</th>
                        <th className="px-4 py-1 font-normal">To the bottom</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {pages.map((p, i) => (
                        <tr key={i} className="border-t border-line/60">
                          <td className="max-w-0 truncate px-4 py-1">
                            <button type="button" className="truncate text-link hover:underline" onClick={() => onOpen(p)} title={p.finalUrl}>
                              {p.kind === "start" ? "Start · " : ""}
                              {pathOf(p.finalUrl)}
                            </button>
                          </td>
                          <td className="px-2 py-1">{p.loadMs != null ? formatMs(p.loadMs) : "–"}</td>
                          <td className="px-2 py-1">{p.readSec != null ? formatSec(p.readSec) : "–"}</td>
                          <td className="px-2 py-1">{pageScrolls(p)}</td>
                          <td className="px-4 py-1">{p.scroll?.reachedBottom ? "yes" : "no"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function formatSec(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function CommonSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-1 font-mono text-xs text-muted">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-status-good" />
          <span className="break-all">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** What a lane is waiting for, on a clock (only while the visit runs), and its error. */
function LaneNotices({ lane, running, now }: { lane: Lane; running: boolean; now: number }) {
  const clock = running && !lane.stopped && lane.wait ? waitClock(lane.wait, now) : null;
  return (
    <>
      {clock && lane.wait && (clock.seconds > 0 || !clock.left) && (
        <Notice tone="info" className="mb-3">
          Waiting for {lane.wait.reason}:{" "}
          {clock.left ? (
            <>
              <strong className="font-mono">{formatWait(clock.seconds)}</strong> left.
            </>
          ) : (
            <>
              waiting <strong className="font-mono">{formatWait(clock.seconds)}</strong> so far.
            </>
          )}
        </Notice>
      )}
      {lane.error && (
        <Notice tone="error" className="mb-3">
          {lane.error}
        </Notice>
      )}
    </>
  );
}

/** A lane's steps, page progress and live log. */
function LaneConsole({ lane, running, onOpen }: { lane: Lane; running: boolean; onOpen: (page: VisitPage) => void }) {
  const { steps, pages, discovery, timing } = lane;
  return (
    <>
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
      {pages.length > 0 && <LiveLog pages={pages} total={discovery ? discovery.total + 1 : null} onOpen={onOpen} />}
    </>
  );
}

/** A page result plus the time it arrived, for the console. */
type LoggedPage = VisitPage & { at: number };

type LogFilter = "all" | "problems" | "failed";

/**
 * The test console: a live summary, then one line per page as it's checked (time, number, status,
 * load time, phone result, page, result) with the details of any problem underneath. Follows the
 * newest line unless scrolled up; click a line for everything about that page.
 */
function LiveLog({ pages, total, onOpen }: { pages: LoggedPage[]; total: number | null; onOpen: (page: VisitPage) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [filter, setFilter] = useState<LogFilter>("all");
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [pages.length, filter]);

  const lines = pages.map((p, i) => ({ n: i + 1, page: p, problems: pageProblems(p) }));
  const failed = lines.filter((l) => !l.page.ok).length;
  const warnings = lines.filter((l) => l.page.ok && l.problems.length).length;
  const ok = lines.length - failed - warnings;
  const loads = pages.map((p) => p.loadMs).filter((ms): ms is number => ms != null);
  const avg = loads.length ? Math.round(loads.reduce((x, y) => x + y, 0) / loads.length) : null;
  const elapsed = pages.length > 1 ? Math.round((Math.max(...pages.map((p) => p.at)) - Math.min(...pages.map((p) => p.at))) / 1000) : 0;
  const shown = filter === "all" ? lines : filter === "failed" ? lines.filter((l) => !l.page.ok) : lines.filter((l) => l.problems.length);
  const width = String(total ?? pages.length).length;
  const counts: Record<LogFilter, number> = { all: lines.length, problems: failed + warnings, failed };
  const grid = "grid grid-cols-[4.5rem_4rem_2.5rem_3rem_4.5rem_minmax(10rem,18rem)_1fr] gap-x-3";

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-black/50 font-mono text-[11px]">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-black/40 px-3 py-2">
        <span className="text-ink">
          Checked <b className="tabular-nums">{lines.length}</b>
          {total ? <span className="text-subtle">/{total}</span> : null}
        </span>
        <span className="text-status-good tabular-nums">✓ {ok} OK</span>
        <span className={`tabular-nums ${warnings ? "text-status-warning" : "text-subtle"}`}>⚠ {warnings} warning{warnings === 1 ? "" : "s"}</span>
        <span className={`tabular-nums ${failed ? "text-status-critical" : "text-subtle"}`}>✕ {failed} failed</span>
        <span className="text-muted tabular-nums">avg load {avg != null ? formatMs(avg) : "–"}</span>
        <span className="text-muted tabular-nums">elapsed {formatWait(elapsed)}</span>
        <span className="ml-auto flex rounded-md bg-canvas/60 p-0.5" role="radiogroup" aria-label="Log lines">
          {(["all", "problems", "failed"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={filter === v}
              onClick={() => setFilter(v)}
              className={`rounded px-2 py-0.5 transition ${filter === v ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink"}`}
            >
              {v === "all" ? "All" : v === "problems" ? "Problems" : "Failed"} ({counts[v]})
            </button>
          ))}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[56rem]">
          {/* Column headers */}
          <div className={`${grid} border-b border-line px-3 py-1 text-[10px] tracking-[0.12em] text-subtle uppercase`}>
            <span>Time</span>
            <span>#</span>
            <span>Code</span>
            <span className="text-right">Load</span>
            <span>Phone</span>
            <span>Page</span>
            <span>Result · click a line for details</span>
          </div>

          <div
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            role="log"
            aria-label="Live log"
            className="max-h-[30rem] overflow-y-auto py-1 leading-5"
          >
            {shown.length === 0 && <div className="px-3 py-1 text-subtle">{filter === "all" ? "Waiting for the first page…" : "Nothing here so far."}</div>}
            {shown.map(({ n, page: p, problems }) => {
              const tone = !p.ok ? "text-status-critical" : problems.length ? "text-status-warning" : "text-status-good";
              const details = problemDetails(p);
              return (
                <button
                  key={`${n}-${p.url}`}
                  type="button"
                  onClick={() => onOpen(p)}
                  title={`${p.finalUrl} · click for details`}
                  className={`block w-full px-3 text-left hover:bg-white/5 ${problems.length ? "bg-white/[0.02]" : ""}`}
                >
                  <span className={`${grid} whitespace-nowrap`}>
                    <span className="text-subtle tabular-nums">{clock(p.at)}</span>
                    <span className="text-subtle tabular-nums">
                      [{String(n).padStart(width, " ")}/{total ?? "?"}]
                    </span>
                    <span className={`tabular-nums ${p.status === null || p.status >= 400 ? "text-status-critical" : "text-muted"}`}>{p.status ?? "---"}</span>
                    <span className={`text-right tabular-nums ${(p.loadMs ?? 0) > 8000 ? "text-status-warning" : "text-muted"}`}>{p.loadMs != null ? formatMs(p.loadMs) : "–"}</span>
                    <PhoneCell page={p} />
                    <span className="truncate text-ink">{pathOf(p.finalUrl)}</span>
                    <span className={`truncate ${tone}`}>{problems.length ? `${p.ok ? "⚠" : "✕"} ${problems.join(" · ")}` : "✓ OK"}</span>
                  </span>
                  {details.length > 0 && (
                    <span className="mb-1 block pl-[calc(4.5rem+4rem+2.5rem+3rem+4.5rem+3.75rem)] text-[10.5px] leading-4">
                      {details.map((d, i) => (
                        <span key={i} className="block truncate text-muted">
                          <span className="text-subtle">└ {d.label}:</span> {d.text}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The phone result in one word. */
function PhoneCell({ page: p }: { page: VisitPage }) {
  const m = p.mobile;
  if (m === undefined) return <span className="text-subtle">–</span>;
  if (m === null) return <span className="text-subtle">not run</span>;
  if (!m.ok) return <span className="text-status-critical">✕ failed</span>;
  if (m.overflowPx > OVERFLOW_PX) return <span className="text-status-critical">✕ wide</span>;
  if (!m.viewportTag || m.brokenImages.length) return <span className="text-status-warning">⚠ check</span>;
  return <span className="text-status-good">✓ ok</span>;
}

/** The first example of each problem on a page, shown under its console line. */
function problemDetails(p: VisitPage): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const more = (n: number) => (n > 1 ? `  (+${n - 1} more)` : "");
  if (!p.ok && p.error) out.push({ label: "Error", text: p.error });
  if (p.consoleErrors.length) out.push({ label: "JS error", text: p.consoleErrors[0] + more(p.consoleErrors.length) });
  if (p.failedRequests.length) out.push({ label: "Failed file", text: p.failedRequests[0] + more(p.failedRequests.length) });
  if (p.scroll?.brokenImages.length) out.push({ label: "Broken image", text: p.scroll.brokenImages[0] + more(p.scroll.brokenImages.length) });
  if (p.stillLoading?.length) out.push({ label: "Still loading", text: p.stillLoading[0] + more(p.stillLoading.length) });
  if (p.clickable === false && p.note) out.push({ label: "Link", text: p.note });
  const m = p.mobile;
  if (m && !m.ok) out.push({ label: "Phone", text: m.error ?? "didn't load" });
  if (m?.ok && m.overflowPx > OVERFLOW_PX) out.push({ label: "Phone", text: `page is ${m.overflowPx}px wider than the screen (scrolls sideways)` });
  if (m?.ok && !m.viewportTag) out.push({ label: "Phone", text: "no viewport tag (may show a tiny desktop page)" });
  if (m?.brokenImages.length) out.push({ label: "Phone image", text: m.brokenImages[0] + more(m.brokenImages.length) });
  if (p.menus?.mobile && !p.menus.mobile.opened) out.push({ label: "Phone menu", text: p.menus.mobile.note ?? "didn't open" });
  return out;
}

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}

function Progress({ done, total, running, elapsedMs }: { done: number; total: number; running: boolean; elapsedMs: number }) {
  const pct = Math.round((done / total) * 100);
  const elapsed = elapsedMs / 1000;
  const left = done > 2 && running ? Math.round((elapsed / done) * (total - done)) : null;
  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
        {/* Not the site's page count: the pages this visit has found so far (it grows while links are followed). */}
        <span className="text-ink" title="Pages this visit has found so far: the sitemap, the start page's links, and links on the pages visited. It grows while the visit runs, so two visits can show different numbers until both have seen the whole site.">
          Page {done.toLocaleString()} · {total.toLocaleString()} found so far
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
                <div className="mt-1 text-xs">…and {report.issues.length - ISSUES_SHOWN} more. Use the Problems filter in the live log, or Copy summary.</div>
              )}
            </Notice>
          )}
          <CopySummary report={report} />
        </div>
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

/** Everything about one page (opened from a console line): what was checked, and every error. */
function PageDetails({ page, heading }: { page: VisitPage; heading: string }) {
  return (
    <Panel
      title={heading}
      actions={
        <span className="inline-flex items-center gap-3 font-mono text-xs text-muted">
          {page.status !== null ? <StatusCode status={page.status} /> : <span className="text-status-serious">no response</span>}
          {page.loadMs != null && <span>{formatMs(page.loadMs)}</span>}
          {page.readSec != null && <span title="Time spent on the page after it loaded">read {page.readSec}s</span>}
        </span>
      }
      bodyClassName="space-y-3 p-4 text-sm"
    >
      <div className="space-y-1">
        <div className="font-medium break-words text-ink">{page.title ?? "(no title)"}</div>
        <UrlLink href={page.finalUrl} full />
        {page.kind === "internal" && (
          <div className="text-xs text-muted">
            {page.foundIn === "another page" ? "Found through a link on another page" : `Found in the ${page.foundIn ?? "sitemap"}`}
            {page.note && <> · {page.note}</>}
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
      <Details title="Broken images" items={page.scroll?.brokenImages ?? []} />
      <Details title="Broken images on a phone" items={page.mobile?.brokenImages ?? []} />
    </Panel>
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
