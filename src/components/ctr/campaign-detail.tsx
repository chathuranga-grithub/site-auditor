"use client";

// Auto CTR: one campaign. Its visit to the site through the proxy runs on the server while the
// campaign is active (src/lib/campaigns/visits.ts); this page shows its console and results, the same
// live. Then goals vs real numbers, visits done vs the plan, daily data. Each campaign runs on one
// computer: opened on another one, the page says which, and can move it there ("Run on this computer"),
// or from any computer to any other ("Move to…").

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Monitor, Pause, Pencil, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { daysBetween, summarize } from "@/lib/campaigns/metrics";
import { todayInVietnam } from "@/lib/campaigns/site";
import { plannedVisits, visitPlanProgress, type Campaign, type CampaignChange, type CampaignDay } from "@/lib/campaigns/types";
import { Notice, Panel, StatTile, buttonClass } from "@/components/ui/primitives";
import { Loader } from "@/components/ui/loader";
import { VisitRunView, useVisitRun } from "@/components/visit/visit-run";
import { RealtimePanel } from "./realtime";
import { CONFIRM, CampaignConfirm, isOpen, HealthBadge, PageHeader, Progress, StatusBadge, api, changeText, ComputerBadge, GOOGLE_CONNECTOR, type ThisComputer } from "./ui";
import { ComputerSelect, useComputers } from "./computer-picker";

const HEARTBEAT_MS = 5 * 60_000;

interface Heartbeat {
  status: Campaign["status"];
  canRunVisits: boolean;
  here?: boolean;
  computerName?: string | null;
  visit: { running: boolean; startedAt: number; run: number; runs: number; lanes?: number; pages: number; lastEventAt: number | null } | null;
  at: number;
}

/** One line for the browser console, e.g. "up · active · visit running 12m, 37 pages, last line 4s ago". */
function heartbeatText(h: Heartbeat): string {
  const ago = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`);
  if (h.status !== "active") return `campaign is ${h.status}`;
  if (!h.canRunVisits) return "up · active · visits don't run here (not on a computer)";
  if (h.here === false) return `up · active · runs on ${h.computerName ?? "no computer yet"}, not this one`;
  if (!h.visit) return "up · active · no visit since the app started";
  const v = h.visit;
  const last = v.lastEventAt ? `, last line ${ago(h.at - v.lastEventAt)} ago` : "";
  const run = v.runs > 1 ? ` (run ${v.run} of ${v.runs}${(v.lanes ?? 1) > 1 ? `, ${v.lanes} at a time` : ""})` : "";
  return v.running
    ? `up · active · visit running${run} ${ago(h.at - v.startedAt)}, ${v.pages} pages${last}`
    : `up · active · visit finished${run}, ${v.pages} pages${last}`;
}

/**
 * Active campaigns: visit runs done (counted as each one finishes) against the visit plan (day 1
 * visits, compounded by the daily increase): today, so far, and what's left of the plan's total.
 */
function VisitPlanTiles({ campaign: c, day, done, doneToday }: { campaign: Campaign; day: number; done: number; doneToday: number }) {
  const plan = visitPlanProgress(c, day);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatTile label="Visits today" value={`${doneToday} / ${plan.today.toLocaleString()}`} detail={`done / planned · day ${day} of ${c.durationDays}`} />
      <StatTile label="Visits so far" value={`${done.toLocaleString()} / ${plan.soFar.toLocaleString()}`} detail="done / planned up to today" />
      <StatTile label="Balance" value={Math.max(0, plan.total - done).toLocaleString()} detail={`left of ${plan.total.toLocaleString()} planned in total`} />
      <StatTile label="Plan" value={`${plan.total.toLocaleString()} visits`} detail={`${c.day1Visits} on day 1, +${c.dailyIncreasePct}% a day · ${c.concurrency} at a time · ${c.mobilePct}% on a phone · ${c.minDwellSec === c.maxDwellSec ? c.minDwellSec : `${c.minDwellSec}–${c.maxDwellSec}`}s on the site`} />
    </div>
  );
}

interface Detail {
  campaign: Campaign;
  days: CampaignDay[];
  /** Its change history, newest first. */
  changes?: CampaignChange[];
  /** This computer runs it; it could (the app runs on a computer, not on Vercel). */
  here?: boolean;
  canRunHere?: boolean;
  /** The computer the page is open on; null on Vercel. */
  computer?: ThisComputer | null;
  /** The other copy of the app on this computer that runs its campaigns (null: this one, or none). */
  runner?: { app: string; pid: number; since: string } | null;
}

export function CampaignDetail({ id }: { id: number }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  // Answer of the last "Check ranking": Google position now (null = not in the top 10).
  const [ranking, setRanking] = useState<{ position: number | null } | null>(null);
  // Waiting for "yes" in the popup.
  const [confirming, setConfirming] = useState<keyof typeof CONFIRM | null>(null);

  const visit = useVisitRun();
  const { follow } = visit;
  const computers = useComputers();

  const load = useCallback(() => api<Detail>(`/api/ctr/campaigns/${id}`).then(setData, (e: Error) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  // The campaign's visit console: what has happened so far, then live while it runs. On another PC:
  // from that PC's minute check-in (Realtime updates on there; only while it's active or paused). Followed
  // again when it moves.
  const source = !data ? null : data.here ? "here" : isOpen(data.campaign.status) && data.campaign.computerId ? data.campaign.computerId : null;
  useEffect(() => (source ? follow(id, source !== "here") : undefined), [follow, id, source]);

  // A run finished: reload the numbers, so the visits done go up without reloading the page. Once
  // finished runs stop arriving for a moment: opening the page replays every visit since the app
  // started in one burst, which would otherwise reload the page once per visit (and make it blink).
  // The moment also lets the server count the run (it counts just before "done").
  const { reports } = visit;
  useEffect(() => {
    if (!reports) return;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [reports, load]);

  // Heartbeat: while an active campaign is open, ask the server every 5 minutes (and once now)
  // whether it and its visit are still up, and log the answer to the browser console.
  const active = data?.campaign.status === "active";
  useEffect(() => {
    if (!active) return;
    const beat = () => {
      const time = new Date().toLocaleTimeString();
      api<Heartbeat>(`/api/ctr/campaigns/${id}/heartbeat`).then(
        (h) => console.log(`[campaign ${id}] ${time} ${heartbeatText(h)}`, h),
        (e: Error) => console.error(`[campaign ${id}] ${time} server not reachable: ${e.message}`),
      );
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [active, id]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <Shell><Notice tone="error">{error}</Notice></Shell>;
  if (!data) return <Shell><Loader title="Loading the campaign…" detail="Its numbers, days and live console" className="py-16" /></Shell>;

  const { campaign: c, days, changes = [], here = false, canRunHere = false, computer = null, runner = null } = data;
  // It runs on this computer, but in the other copy of the app (the desktop app, or npm run dev).
  const otherCopy = !here && !!runner && !!computer && c.computerId === computer.id;
  const s = summarize(c, days, todayInVietnam());
  const runsOn = here ? "this computer" : (c.computerName ?? "no computer yet");

  return (
    <Shell>
      <PageHeader
        section="Campaigns"
        title={c.keyword}
        intro={
          <span className="font-mono text-xs">
            <a href={c.pageUrl ?? c.siteUrl} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
              {(c.pageUrl ?? c.siteUrl).replace(/^https?:\/\//, "")}
            </a>{" "}
            · {c.startDate} → {c.endDate}
            {isOpen(c.status) && <> · runs on {runsOn}</>}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ComputerBadge campaign={c} me={computer} size="md" />
            {isOpen(c.status) && computers && computers.computers.some((pc) => pc.id !== c.computerId) && (
              <ComputerSelect
                data={computers}
                value=""
                exclude={c.computerId}
                placeholder={busy === "moveTo" ? "Moving…" : "Move to…"}
                disabled={!!busy}
                ariaLabel="Move this campaign to another computer"
                className={`${buttonClass.secondary} max-w-52 cursor-pointer pr-2`}
                onChange={(to) =>
                  to &&
                  run("moveTo", async () => {
                    // The console follows it (here, or from that PC) once the page reloads.
                    await api(`/api/ctr/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ moveTo: to }) });
                  })
                }
              />
            )}
            <StatusBadge status={c.status} />
            {isOpen(c.status) && here && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={!!busy}
                title="Search Google Vietnam for the keyword now (in a browser, through the proxy) and save where the site ranks. Also runs by itself every day."
                onClick={() =>
                  run("check", async () => {
                    setRanking(null);
                    const r = await api<{ position: number | null; problems: string[] }>(`/api/ctr/campaigns/${id}/check`, { method: "POST" });
                    setProblems(r.problems);
                    if (!r.problems.some((p) => p.startsWith("Google position"))) setRanking({ position: r.position });
                  })
                }
              >
                {busy === "check" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check ranking
              </button>
            )}
            {isOpen(c.status) && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={!!busy}
                onClick={() => {
                  // The server ends the visit on Pause and starts a new one on Resume.
                  if (c.status === "active") {
                    run("status", () => api(`/api/ctr/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "paused" }) }));
                  } else {
                    run("status", async () => {
                      await api(`/api/ctr/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
                      // On another PC, it starts there at its next minute check, and shows here after the next one.
                      follow(id, !here);
                    });
                  }
                }}
              >
                {c.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {c.status === "active" ? "Pause" : "Resume"}
              </button>
            )}
            {c.status !== "stopped" && (
              <Link
                href={`/ctr/campaigns/${id}/edit`}
                className={buttonClass.secondary}
                title={c.status === "finished" ? "Change its settings, or give it more days (it runs again)" : "Change its settings or extend it (kept in the change history)"}
              >
                <Pencil className="size-3.5" /> Edit
              </Link>
            )}
            {isOpen(c.status) && (
              <button type="button" className={buttonClass.secondary} disabled={!!busy} title="End the campaign early, for good (its data is kept)" onClick={() => setConfirming("stop")}>
                <Square className="size-3.5" /> Stop
              </button>
            )}
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={!!busy}
              aria-label="Delete campaign"
              title="Delete campaign"
              onClick={() => setConfirming("delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        }
      />
      {confirming && (
        <CampaignConfirm
          kind={confirming}
          campaign={c}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const action = confirming;
            setConfirming(null);
            if (action === "stop") run("status", () => api(`/api/ctr/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "stopped" }) }));
            else
              run("delete", async () => {
                await api(`/api/ctr/campaigns/${id}`, { method: "DELETE" });
                router.push("/ctr/campaigns");
              });
          }}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {isOpen(c.status) && !here && (
        <Notice tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {otherCopy ? (
                <>
                  This campaign runs on this PC, but in the other copy of the app that&apos;s open here (<b>{runner!.app}</b>): only one copy
                  runs the campaigns, so no visit is done twice. Its console comes from that copy, updated every minute (with Realtime
                  updates on in Settings → This computer). Quit that copy, and
                  this one takes over within a minute.
                </>
              ) : c.computerName ? (
                <>
                  This campaign runs on <b>{c.computerName}</b>: its visits and ranking checks happen there. Its console below comes from
                  there, updated every minute, when Realtime updates are on for that PC (its Settings → This computer). Pause, Resume,
                  Stop and Move to work from here too (that computer picks them up within a minute).
                </>
              ) : (
                <>No computer runs this campaign yet. The first computer with the app running takes it within a minute.</>
              )}
            </span>
            {canRunHere && c.computerId !== computer?.id && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={!!busy}
                title="Run its visits and ranking checks on this computer from now on (the other computer stops them within a minute)"
                onClick={() =>
                  run("move", () => api(`/api/ctr/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ move: true }) }))
                }
              >
                {busy === "move" ? <Loader2 className="size-3.5 animate-spin" /> : <Monitor className="size-3.5" />} Run on this computer
              </button>
            )}
          </div>
        </Notice>
      )}
      {/* Realtime, like Google Analytics: wherever the campaign's console comes from (here, or the PC that runs it). */}
      {source && <RealtimePanel run={visit} />}
      <VisitRunView run={visit} />
      {ranking && (
        <Notice tone="info">
          {ranking.position != null ? (
            <>
              Google ranking today: <strong className="font-mono">#{ranking.position}</strong> for &ldquo;{c.keyword}&rdquo;. Saved to the Google position tile, chart and daily numbers below.
            </>
          ) : (
            <>
              Not in Google&apos;s top 10 today for &ldquo;{c.keyword}&rdquo;. Saved to the daily numbers below.
            </>
          )}
        </Notice>
      )}
      {problems.length > 0 && (
        <Notice tone="warning">
          <div className="font-medium">Some numbers couldn&apos;t be read</div>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <HealthBadge health={s.health} />
        <Progress day={s.dayNumber} total={c.durationDays} />
        <span className="text-xs text-subtle">
          {s.daysLeft} day(s) left{GOOGLE_CONNECTOR ? " · Search Console and GA4 numbers arrive about 3 days late" : ""}
        </span>
      </div>

      {/* Without Search Console and GA4: what the visits did today, from their own numbers. */}
      {!GOOGLE_CONNECTOR && <VisitDayTiles day={days.find((d) => d.day === todayInVietnam()) ?? null} position={s.position} positionDay={s.positionDay} target={c.targetPosition} />}

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6 ${GOOGLE_CONNECTOR ? "" : "hidden"}`}>
        <StatTile label="Google position" value={s.position ?? "—"} detail={c.targetPosition != null ? `goal ≤ ${c.targetPosition}` : s.positionDay ?? "not checked yet"} severity={s.position != null && c.targetPosition != null ? (s.position <= c.targetPosition ? "good" : "warning") : undefined} />
        <StatTile label="CTR (7 days)" value={s.ctr != null ? `${s.ctr}%` : "—"} detail={`goal ${c.targetCtr}%${s.expected != null ? ` · typical ${s.expected}%` : ""}`} severity={s.ctr != null ? (s.ctr >= c.targetCtr ? "good" : "warning") : undefined} />
        <StatTile label="Clicks (7 days)" value={s.clicks7 ?? "—"} detail={s.growthPct != null ? `${s.growthPct > 0 ? "+" : ""}${s.growthPct}% vs last week${c.weeklyGrowthPct != null ? ` · goal +${c.weeklyGrowthPct}%` : ""}` : "growth after 2 weeks of data"} severity={s.growthPct != null && c.weeklyGrowthPct != null ? (s.growthPct >= c.weeklyGrowthPct ? "good" : "warning") : undefined} />
        <StatTile label="Impressions (7 days)" value={s.impressions7?.toLocaleString() ?? "—"} detail="times shown in Google" />
        <StatTile label="Mobile clicks" value={s.mobileShare != null ? `${s.mobileShare}%` : "—"} detail="phones and tablets" />
        <StatTile label="Time on page" value={s.engagementSec != null ? `${s.engagementSec}s` : "—"} detail={c.targetEngagementSec != null ? `goal ${c.targetEngagementSec}s` : "Google Analytics"} severity={s.engagementSec != null && c.targetEngagementSec != null ? (s.engagementSec >= c.targetEngagementSec ? "good" : "warning") : undefined} />
      </div>

      {c.status === "active" && <VisitPlanTiles campaign={c} day={s.dayNumber} done={s.visitsDone} doneToday={s.visitsDoneToday} />}

      <Panel title={`Daily numbers · ${days.length}`} bodyClassName="">
        {days.length && !GOOGLE_CONNECTOR ? (
          <VisitDaysTable campaign={c} days={days} />
        ) : days.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left font-mono text-xs">
              <thead className="border-b border-line text-[10px] tracking-[0.12em] text-subtle uppercase">
                <tr>
                  {["Day", "Visits (done / planned)", "Position", "Impressions", "Clicks", "CTR", "Mobile / desktop clicks", "Time on page", "Notes"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...days].reverse().map((d) => (
                  <tr key={d.day} className="align-top">
                    <td className="px-3 py-2 text-muted">{d.day}</td>
                    <td className="px-3 py-2">
                      {d.visitsDone} / {plannedVisits(c.day1Visits, c.dailyIncreasePct, Math.max(1, daysBetween(c.startDate, d.day) + 1)).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{d.position ?? "–"}</td>
                    <td className="px-3 py-2">{d.impressions ?? "–"}</td>
                    <td className="px-3 py-2">{d.clicks ?? "–"}</td>
                    <td className="px-3 py-2">{d.ctr != null ? `${d.ctr}%` : "–"}</td>
                    <td className="px-3 py-2">{d.mobileClicks != null ? `${d.mobileClicks} / ${d.desktopClicks ?? 0}` : "–"}</td>
                    <td className="px-3 py-2">{d.engagementSec != null ? `${d.engagementSec}s` : "–"}</td>
                    <td className="px-3 py-2 font-sans text-[11px] text-subtle">{Object.values(d.notes).filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted">No numbers yet. The Google ranking is checked when the campaign starts, then once a day.</div>
        )}
      </Panel>

      <ChangeHistory changes={changes} />
    </Shell>
  );
}

const CHANGE_KIND: Record<CampaignChange["kind"], string> = { created: "Created", edited: "Edited", status: "Status", moved: "Computer" };

/** Who changed what, when, from what to what: edits, pause / resume / stop, moves, finished. Newest first. */
function ChangeHistory({ changes }: { changes: CampaignChange[] }) {
  return (
    <Panel title={`Changes · ${changes.length}`} bodyClassName="">
      {changes.length ? (
        <ul className="divide-y divide-line">
          {changes.map((ch) => (
            <li key={ch.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-4">
              <div className="w-44 shrink-0 font-mono text-[11px] text-muted">
                {new Date(ch.at).toLocaleString()}
                <div className="text-subtle">{ch.by ?? "the app"}</div>
              </div>
              <span className="w-20 shrink-0 font-mono text-[10px] tracking-wide text-accent-2 uppercase">{CHANGE_KIND[ch.kind] ?? ch.kind}</span>
              <div className="min-w-0 flex-1 space-y-0.5 font-mono text-xs break-words text-ink">
                {ch.kind === "created" ? (
                  <div>Campaign created{ch.changes[0]?.to ? `, on ${ch.changes[0].to}` : ""}</div>
                ) : (
                  ch.changes.map((f) => <div key={f.field}>{changeText(f)}</div>)
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted">No changes yet. Edits, pause, resume, stop and moves are listed here, with who made them.</div>
      )}
    </Panel>
  );
}

/** "1m 32s" / "45s". */
const duration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);
/** The day's average per visit that counted, or null. */
const perVisit = (total: number, d: CampaignDay) => (d.visitsDone ? total / d.visitsDone : null);
/** Visits that counted, out of every try. */
const successRate = (d: CampaignDay) => (d.visitsDone + d.visitTriesFailed ? Math.round((d.visitsDone / (d.visitsDone + d.visitTriesFailed)) * 100) : null);

/** Today, from the visits' own numbers: how they went, what they met, how long they stayed. */
function VisitDayTiles({ day: d, position, positionDay, target }: { day: CampaignDay | null; position: number | null; positionDay: string | null; target: number | null }) {
  const rate = d ? successRate(d) : null;
  const seconds = d ? perVisit(d.visitSeconds, d) : null;
  const pages = d ? perVisit(d.pagesRead, d) : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label="Google position"
        value={position ?? "—"}
        detail={`${target != null ? `goal ≤ ${target} · ` : ""}${positionDay ? `daily check ${positionDay}` : "not checked yet"}`}
        severity={position != null && target != null ? (position <= target ? "good" : "warning") : undefined}
      />
      <StatTile
        label="Position in visits"
        value={d?.visitPositionAvg != null ? `#${d.visitPositionAvg}` : "—"}
        detail={d?.visitPositionBest != null ? `average today · best #${d.visitPositionBest}` : "where the visits found the site today"}
      />
      <StatTile
        label="Visits that worked"
        value={rate != null ? `${rate}%` : "—"}
        detail={d ? `${d.visitsDone} counted · ${d.visitTriesFailed} tries failed today` : "no visits today yet"}
        severity={rate != null ? (rate >= 50 ? "good" : "warning") : undefined}
      />
      <StatTile label="CAPTCHAs" value={d ? `${d.captchasSolved} / ${d.captchasMet}` : "—"} detail="solved / met today" severity={d && d.captchasMet ? (d.captchasSolved >= d.captchasMet / 2 ? "good" : "warning") : undefined} />
      <StatTile label="Time on site" value={seconds != null ? duration(seconds) : "—"} detail="average per visit today" />
      <StatTile
        label="Pages per visit"
        value={pages != null ? pages.toFixed(1) : "—"}
        detail={d?.lastVisitAt ? `last visit ${new Date(d.lastVisitAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${d.lastComputer ? ` · ${d.lastComputer}` : ""}` : "average per visit today"}
      />
    </div>
  );
}

/** One row per day, from the visits' own numbers (no Search Console or GA4): what was actually done. */
function VisitDaysTable({ campaign: c, days }: { campaign: Campaign; days: CampaignDay[] }) {
  const head = [
    ["Day", ""],
    ["Visits", "done / planned"],
    ["Phone / desktop", "visits done"],
    ["Worked", "visits that counted, of every try"],
    ["CAPTCHAs", "solved / met"],
    ["Position", "daily check · in visits: average (best)"],
    ["Time on site", "average per visit"],
    ["Pages", "per visit"],
    ["Last visit", "time · computer"],
    ["Notes", ""],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-left font-mono text-xs">
        <thead className="border-b border-line text-[10px] tracking-[0.12em] text-subtle uppercase">
          <tr>
            {head.map(([h, hint]) => (
              <th key={h} className="px-3 py-2 font-medium" title={hint || undefined}>
                {h}
                {hint && <span className="block font-sans text-[9px] tracking-normal normal-case opacity-70">{hint}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...days].reverse().map((d) => {
            const planned = plannedVisits(c.day1Visits, c.dailyIncreasePct, Math.max(1, daysBetween(c.startDate, d.day) + 1));
            const rate = successRate(d);
            const seconds = perVisit(d.visitSeconds, d);
            const pages = perVisit(d.pagesRead, d);
            const dash = <span className="text-subtle">–</span>;
            return (
              <tr key={d.day} className="align-top">
                <td className="px-3 py-2 text-muted">{d.day}</td>
                <td className="px-3 py-2">
                  {d.visitsDone.toLocaleString()} <span className="text-subtle">/ {planned.toLocaleString()}</span>
                  <span className={`block text-[10px] ${d.visitsDone >= planned ? "text-status-good" : "text-subtle"}`}>{planned ? `${Math.round((d.visitsDone / planned) * 100)}% of the plan` : ""}</span>
                </td>
                <td className="px-3 py-2">
                  {d.visitsDone ? (
                    <>
                      {d.mobileVisitsDone} / {d.visitsDone - d.mobileVisitsDone}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="px-3 py-2">
                  {rate != null ? (
                    <>
                      <span className={rate >= 50 ? "text-status-good" : "text-status-warning"}>{rate}%</span>
                      <span className="block text-[10px] text-subtle">{d.visitTriesFailed} failed</span>
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="px-3 py-2">{d.captchasMet ? `${d.captchasSolved} / ${d.captchasMet}` : dash}</td>
                <td className="px-3 py-2">
                  {d.position != null ? `#${d.position}` : dash}
                  {d.visitPositionAvg != null && (
                    <span className="block text-[10px] text-subtle">
                      visits #{d.visitPositionAvg} (#{d.visitPositionBest})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{seconds != null && d.visitSeconds ? duration(seconds) : dash}</td>
                <td className="px-3 py-2">{pages != null && d.pagesRead ? pages.toFixed(1) : dash}</td>
                <td className="px-3 py-2">
                  {d.lastVisitAt ? new Date(d.lastVisitAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : dash}
                  {d.lastComputer && <span className="block text-[10px] text-subtle">{d.lastComputer}</span>}
                </td>
                <td className="px-3 py-2 font-sans text-[11px] text-subtle">{d.notes.serp ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-3 py-2 font-sans text-[11px] text-subtle">
        Visit details (failed tries, CAPTCHAs, time on site, pages, position in visits) are counted from version 1.0.2 of the app; earlier days show only the visits done.
      </p>
    </div>
  );
}

/** The page frame, with the way back to the list at the top (also while loading or on an error). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Link
        href="/ctr/campaigns"
        className="group inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface pr-3 pl-2 text-xs font-medium text-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink"
      >
        <ArrowLeft className="size-3.5 transition group-hover:-translate-x-0.5" aria-hidden />
        Back to campaigns
      </Link>
      {children}
    </div>
  );
}
