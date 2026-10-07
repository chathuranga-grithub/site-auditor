"use client";

// Auto CTR: one campaign. Its visit to the site through the proxy runs on the server while the
// campaign is active (src/lib/campaigns/visits.ts); this page shows its console and results, the same
// live. Then goals vs real numbers, daily charts, change log, daily data.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { summarize } from "@/lib/campaigns/metrics";
import { todayInVietnam } from "@/lib/campaigns/site";
import type { Campaign, CampaignDay, CampaignNote } from "@/lib/campaigns/types";
import { Notice, Panel, StatTile, buttonClass } from "@/components/ui/primitives";
import { VisitRunView, useVisitRun } from "@/components/visit/visit-run";
import { CONFIRM, CampaignConfirm, isOpen, HealthBadge, LineChart, PageHeader, Progress, StatusBadge, api } from "./ui";

const HEARTBEAT_MS = 5 * 60_000;

interface Heartbeat {
  status: Campaign["status"];
  canRunVisits: boolean;
  visit: { running: boolean; startedAt: number; pages: number; lastEventAt: number | null } | null;
  at: number;
}

/** One line for the browser console, e.g. "up · active · visit running 12m, 37 pages, last line 4s ago". */
function heartbeatText(h: Heartbeat): string {
  const ago = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`);
  if (h.status !== "active") return `campaign is ${h.status}`;
  if (!h.canRunVisits) return "up · active · visits don't run here (not on a computer)";
  if (!h.visit) return "up · active · no visit since the app started";
  const v = h.visit;
  const last = v.lastEventAt ? `, last line ${ago(h.at - v.lastEventAt)} ago` : "";
  return v.running
    ? `up · active · visit running ${ago(h.at - v.startedAt)}, ${v.pages} pages${last}`
    : `up · active · visit finished, ${v.pages} pages${last}`;
}

interface Detail {
  campaign: Campaign;
  days: CampaignDay[];
  notes: CampaignNote[];
}

export function CampaignDetail({ id }: { id: number }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  // Answer of the last "Check ranking": Google position now (null = not in the top 10).
  const [ranking, setRanking] = useState<{ position: number | null } | null>(null);
  const [note, setNote] = useState("");
  // Waiting for "yes" in the popup.
  const [confirming, setConfirming] = useState<keyof typeof CONFIRM | null>(null);

  const visit = useVisitRun();
  const { follow } = visit;

  const load = useCallback(() => api<Detail>(`/api/ctr/campaigns/${id}`).then(setData, (e: Error) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  // The campaign's visit console: what has happened so far, then live while it runs.
  useEffect(() => follow(id), [follow, id]);

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
  if (!data) return <Shell><div className="py-16 text-center text-sm text-muted">Loading…</div></Shell>;

  const { campaign: c, days, notes } = data;
  const s = summarize(c, days, todayInVietnam());
  // The full campaign period on the x axis, so charts show progress through it.
  const range = dayRange(c.startDate, days.length ? days[days.length - 1].day > c.endDate ? days[days.length - 1].day : c.endDate : c.endDate, days);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const series = (f: (d: CampaignDay) => number | null) => range.map((day) => ({ day, value: byDay.has(day) ? f(byDay.get(day)!) : null }));

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await run("note", () => api(`/api/ctr/campaigns/${id}/notes`, { method: "POST", body: JSON.stringify({ text: note }) }));
    setNote("");
  }

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
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            {isOpen(c.status) && (
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
                      follow(id);
                    });
                  }
                }}
              >
                {c.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {c.status === "active" ? "Pause" : "Resume"}
              </button>
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
        <span className="text-xs text-subtle">{s.daysLeft} day(s) left · Search Console and GA4 numbers arrive about 3 days late</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Google position" value={s.position ?? "—"} detail={c.targetPosition != null ? `goal ≤ ${c.targetPosition}` : s.positionDay ?? "not checked yet"} severity={s.position != null && c.targetPosition != null ? (s.position <= c.targetPosition ? "good" : "warning") : undefined} />
        <StatTile label="CTR (7 days)" value={s.ctr != null ? `${s.ctr}%` : "—"} detail={`goal ${c.targetCtr}%${s.expected != null ? ` · typical ${s.expected}%` : ""}`} severity={s.ctr != null ? (s.ctr >= c.targetCtr ? "good" : "warning") : undefined} />
        <StatTile label="Clicks (7 days)" value={s.clicks7 ?? "—"} detail={s.growthPct != null ? `${s.growthPct > 0 ? "+" : ""}${s.growthPct}% vs last week${c.weeklyGrowthPct != null ? ` · goal +${c.weeklyGrowthPct}%` : ""}` : "growth after 2 weeks of data"} severity={s.growthPct != null && c.weeklyGrowthPct != null ? (s.growthPct >= c.weeklyGrowthPct ? "good" : "warning") : undefined} />
        <StatTile label="Impressions (7 days)" value={s.impressions7?.toLocaleString() ?? "—"} detail="times shown in Google" />
        <StatTile label="Mobile clicks" value={s.mobileShare != null ? `${s.mobileShare}%` : "—"} detail="phones and tablets" />
        <StatTile label="Time on page" value={s.engagementSec != null ? `${s.engagementSec}s` : "—"} detail={c.targetEngagementSec != null ? `goal ${c.targetEngagementSec}s` : "Google Analytics"} severity={s.engagementSec != null && c.targetEngagementSec != null ? (s.engagementSec >= c.targetEngagementSec ? "good" : "warning") : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Google position (lower is better)" bodyClassName="p-3">
          <LineChart label="Google position by day" points={series((d) => d.position)} goal={c.targetPosition} invert />
        </Panel>
        <Panel title="CTR % (Search Console)" bodyClassName="p-3">
          <LineChart label="CTR by day" points={series((d) => d.ctr)} goal={c.targetCtr} unit="%" />
        </Panel>
        <Panel title="Clicks per day" bodyClassName="p-3">
          <LineChart label="Clicks by day" points={series((d) => d.clicks)} />
        </Panel>
        <Panel title="Impressions per day" bodyClassName="p-3">
          <LineChart label="Impressions by day" points={series((d) => d.impressions)} />
        </Panel>
      </div>

      <Panel title={`Change log · ${notes.length}`} bodyClassName="p-4 space-y-3">
        <p className="text-xs text-muted">Write down what you changed (new title, faster page, more content), so the charts show what helped.</p>
        <form onSubmit={addNote} className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. New title and meta description"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-canvas/60 px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent/60"
          />
          <button type="submit" disabled={!note.trim() || !!busy} className={buttonClass.secondary}>
            Add
          </button>
        </form>
        {notes.length > 0 && (
          <ul className="divide-y divide-line">
            {[...notes].reverse().map((n) => (
              <li key={n.id} className="flex gap-3 py-2 text-sm">
                <span className="font-mono text-xs text-subtle tabular-nums">{n.day}</span>
                <span className="text-ink">{n.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Daily numbers · ${days.length}`} bodyClassName="">
        {days.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left font-mono text-xs">
              <thead className="border-b border-line text-[10px] tracking-[0.12em] text-subtle uppercase">
                <tr>
                  {["Day", "Position", "Impressions", "Clicks", "CTR", "Mobile / desktop clicks", "Time on page", "Notes"].map((h) => (
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

    </Shell>
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

/** Every day from start to end (inclusive), plus any saved days outside it. */
function dayRange(start: string, end: string, days: CampaignDay[]): string[] {
  const out: string[] = [];
  const first = days.length && days[0].day < start ? days[0].day : start;
  for (let d = new Date(`${first}T00:00:00Z`); d.toISOString().slice(0, 10) <= end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
