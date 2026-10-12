"use client";

// Auto CTR dashboard: the overview, in the spirit of Google Analytics. One row of filters (date range,
// site) scopes everything below: the headline tiles (each against the period before), the visits per
// day against the plan, Google position by site, how the visits went (worked, CAPTCHAs, time on
// site), visits by computer, a table per site (campaigns of the same site together), every active
// campaign with its own charts, and the results of the finished and stopped ones. Numbers come from
// the campaigns' daily rows (GET /api/ctr/campaigns): no extra database reads.

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Check, CircleCheck, Files, Loader2, Monitor, ShieldCheck, Smartphone, Timer, Trophy, type LucideIcon } from "lucide-react";
import type { CampaignDay, CtrSetup } from "@/lib/campaigns/types";
import { todayInVietnam } from "@/lib/campaigns/site";
import { daysBetween } from "@/lib/campaigns/metrics";
import { buildOverview, rangeDays, rates, siteOf, type Overview, type OverviewItem, type Totals } from "@/lib/campaigns/overview";
import { Notice } from "@/components/ui/primitives";
import { BarList, ChartCard, ColumnChart, CountUp, LineChart, DESKTOP, PHONE, SERIES, Sparkline, compact, shortDay } from "./charts";
import { ComputerBadge, PageHeader, SetupNotice, StatusBadge, api, isOpen, type CampaignItem, type ThisComputer } from "./ui";

type Item = CampaignItem & { days: CampaignDay[] };
type Range = 1 | 7 | 14 | 30 | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: 1, label: "Today" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: "all", label: "All time" },
];

/** "1m 32s" / "45s". */
const duration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
/** Numbers that count up to their value when they come into view. */
const N = ({ v }: { v: number }) => <CountUp value={v} />;
const P = ({ v }: { v: number | null }) => (v == null ? <>—</> : <CountUp value={v} format={(n) => `${Math.round(n)}%`} />);
/** A position, counting up (#1.4); in the visits' searches, else the daily check. */
const Pos = ({ t }: { t: Totals }) => {
  const p = rates(t).position ?? t.checkPosition;
  return p == null ? <>—</> : <CountUp value={p} format={(n) => `#${Math.round(n * 10) / 10}`} />;
};

/** A position to show: in the visits' searches, else the daily check. */
const positionText = (t: Totals) => {
  const p = rates(t).position ?? t.checkPosition;
  return p != null ? `#${p}` : "—";
};

export function CtrDashboard() {
  const [data, setData] = useState<{ items: Item[]; setup: CtrSetup; computer: ThisComputer | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(7);
  const [site, setSite] = useState<string>("all");
  // Only the campaigns this computer runs.
  const [onlyHere, setOnlyHere] = useState(false);

  useEffect(() => {
    api<{ items: Item[]; setup: CtrSetup; computer: ThisComputer | null }>("/api/ctr/campaigns").then(setData, (e: Error) => setError(e.message));
  }, []);

  const today = todayInVietnam();
  const all = useMemo<OverviewItem[]>(() => (data?.items ?? []).map((i) => ({ campaign: i.campaign, days: i.days ?? [] })), [data]);
  // Each site keeps its color whatever the filter (by its place in the full, sorted list).
  const sites = useMemo(() => [...new Set(all.map((i) => siteOf(i.campaign)))].sort(), [all]);
  const colorOf = (s: string) => SERIES[Math.max(0, sites.indexOf(s)) % SERIES.length];
  const me = data?.computer ?? null;
  const here = (c: { computerId: string | null }) => !!me && c.computerId === me.id;
  const items = useMemo(
    () => all.filter((i) => (site === "all" || siteOf(i.campaign) === site) && (!onlyHere || (!!me && i.campaign.computerId === me.id))),
    [all, site, onlyHere, me],
  );
  const hereCount = all.filter((i) => here(i.campaign)).length;
  const days = useMemo(() => rangeDays(today, range, items.length ? items : all), [today, range, items, all]);
  const o = useMemo(() => buildOverview(items, days), [items, days]);
  const r = rates(o.total);
  const p = rates(o.previous);
  const compare = range !== "all";
  const active = o.campaigns.filter((c) => isOpen(c.item.campaign.status));
  const ended = o.campaigns.filter((c) => !isOpen(c.item.campaign.status));
  const versus = range === 1 ? "vs yesterday" : `vs the ${days.length} days before`;
  const perDayRates = o.perDay.map(rates);
  const shownSites = o.sites.slice(0, SERIES.length);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        section="Dashboard"
        title={
          <>
            Auto <span className="text-gradient">CTR</span> overview
          </>
        }
        intro="Everything the campaigns did: visits against the plan, how they went, where the sites rank, and which computer did the work."
      />
      <SetupNotice setup={data?.setup ?? null} />
      {error && <Notice tone="error">{error}</Notice>}

      {/* Filters: one row, above everything they scope. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Date range">
          {RANGES.map((x) => (
            <button
              key={String(x.value)}
              type="button"
              aria-pressed={range === x.value}
              onClick={() => setRange(x.value)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition ${range === x.value ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink"}`}
            >
              {range === x.value && <Check className="size-3" strokeWidth={3} aria-hidden />}
              {x.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Site
          <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded-lg border border-line bg-surface-solid px-2.5 py-1.5 text-xs text-ink">
            <option value="all">All sites ({sites.length})</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {me && (
          <button
            type="button"
            aria-pressed={onlyHere}
            onClick={() => setOnlyHere((v) => !v)}
            title={onlyHere ? "Show every computer's campaigns" : `Show only the campaigns this computer (${me.name}) runs`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${onlyHere ? "border-accent bg-accent text-white shadow-[0_0_16px_#8b5cf666]" : "border-accent/50 bg-accent/10 text-ink hover:bg-accent/20"}`}
          >
            <Monitor className="size-3.5" aria-hidden />
            This PC <span className="font-mono opacity-80">{me.name}</span>
            <span className={`rounded-full px-1.5 font-mono text-[10px] ${onlyHere ? "bg-white/20" : "bg-accent/20"}`}>{hereCount}</span>
            {onlyHere && <Check className="size-3" strokeWidth={3} aria-hidden />}
          </button>
        )}
        <span className="ml-auto font-mono text-[11px] text-subtle">
          {days.length > 1 ? `${shortDay(days[0])} – ${shortDay(days[days.length - 1])}` : shortDay(days[0])} · Vietnam dates
        </span>
      </div>

      {!data ? (
        <DashboardSkeleton />
      ) : !all.length ? (
        <div className="glass rounded-xl py-16 text-center text-sm text-muted">
          No campaigns yet. Create one under{" "}
          <Link href="/ctr/campaigns" className="text-link hover:underline">
            Campaigns
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-5">
          {/* Headline: the one number, then the tiles around it. */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)]">
            <div className="glass relative flex flex-col justify-between overflow-hidden rounded-2xl p-5">
              <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-accent/25 blur-3xl" aria-hidden />
              <div className="pointer-events-none absolute -bottom-20 -left-10 size-48 rounded-full bg-accent-2/15 blur-3xl" aria-hidden />
              <div className="relative flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
                <span className="grid size-6 place-items-center rounded-lg bg-gradient-accent text-white shadow-[0_0_16px_#8b5cf680]">
                  <Activity className="size-3.5" aria-hidden />
                </span>
                Visits
              </div>
              <div className="relative mt-3 flex items-end justify-between gap-3">
                <div>
                  <div className="text-5xl font-semibold tracking-tight">
                    <CountUp value={o.total.visits} />
                  </div>
                  <div className="mt-1 text-xs text-subtle">
                    of <N v={o.total.planned} /> planned · <P v={r.planPct} /> of the plan
                  </div>
                </div>
                <Sparkline values={o.perDay.map((d) => d.visits)} width={120} height={44} />
              </div>
              {compare && (
                <div className="relative">
                  <Delta now={o.total.visits} before={o.previous.visits} versus={versus} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi
                icon={CircleCheck}
                label="Visits that worked"
                value={r.successPct != null ? <CountUp value={r.successPct} format={(n) => `${Math.round(n)}%`} /> : "—"}
                detail={`${o.total.failed.toLocaleString()} tries failed`}
                now={r.successPct}
                before={compare ? p.successPct : null}
                unit="pts"
                trend={perDayRates.map((x) => x.successPct)}
              />
              <Kpi
                icon={ShieldCheck}
                label="CAPTCHAs solved"
                value={o.total.captchasMet ? (<><N v={o.total.captchasSolved} />/<N v={o.total.captchasMet} /></>) : "—"}
                detail={r.captchaSolvedPct != null ? `${r.captchaSolvedPct}% solved` : "none met"}
                now={r.captchaSolvedPct}
                before={compare ? p.captchaSolvedPct : null}
                unit="pts"
                trend={o.perDay.map((x) => x.captchasMet)}
              />
              <Kpi
                icon={Timer}
                label="Time on site"
                value={r.secondsPerVisit != null ? <CountUp value={r.secondsPerVisit} format={duration} /> : "—"}
                detail="average per visit"
                now={r.secondsPerVisit}
                before={compare ? p.secondsPerVisit : null}
                trend={perDayRates.map((x) => x.secondsPerVisit)}
              />
              <Kpi
                icon={Files}
                label="Pages per visit"
                value={r.pagesPerVisit != null ? <CountUp value={r.pagesPerVisit} format={(n) => n.toFixed(1)} /> : "—"}
                detail="average per visit"
                now={r.pagesPerVisit}
                before={compare ? p.pagesPerVisit : null}
                trend={perDayRates.map((x) => x.pagesPerVisit)}
              />
              <Kpi
                icon={Trophy}
                label="Google position"
                value={<Pos t={o.total} />}
                detail={r.position != null ? `in the visits' searches · best #${o.total.bestPosition}` : o.total.checkDay ? `daily check ${o.total.checkDay}` : "not seen yet"}
                now={r.position}
                before={compare ? p.position : null}
                lowerIsBetter
                trend={perDayRates.map((x) => x.position)}
              />
              <Kpi
                icon={Smartphone}
                label="On a phone"
                value={r.mobilePct != null ? <CountUp value={r.mobilePct} format={(n) => `${Math.round(n)}%`} /> : "—"}
                detail={`${o.total.mobile.toLocaleString()} phone · ${(o.total.visits - o.total.mobile).toLocaleString()} desktop`}
              />
              <Kpi icon={Activity} label="Active campaigns" value={<CountUp value={active.length} />} detail={`${items.length} in total · ${new Set(items.map((i) => siteOf(i.campaign))).size} site(s)`} />
              <Kpi icon={Monitor} label="Computers" value={<CountUp value={o.computers.length} />} detail="that made visits in this range" />
            </div>
          </div>

          {/* Visits per day against the plan. */}
          <ChartCard
            title="Visits per day"
            empty={!o.total.visits && !o.total.planned ? "No visits or planned visits in this range." : false}
            subtitle="Visits that counted, on a phone and on a desktop, against the visit plan"
            legend={[
              { label: "Phone", color: PHONE, kind: "bar" },
              { label: "Desktop", color: DESKTOP, kind: "bar" },
              { label: "Planned", color: "#9aa0b4", kind: "reference" },
            ]}
            table={{
              head: ["Day", "Visits", "Phone", "Desktop", "Planned", "Of plan"],
              rows: days.map((d, i) => {
                const t = o.perDay[i];
                return [d, t.visits, t.mobile, t.visits - t.mobile, t.planned, pct(perDayRates[i].planPct)];
              }),
            }}
          >
            {/* The range at a glance, above the chart. */}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(() => {
                const peak = o.perDay.reduce((best, t, i) => (t.visits > o.perDay[best].visits ? i : best), 0);
                const withVisits = o.perDay.filter((t) => t.visits > 0).length;
                return [
                  { label: "Total", value: <CountUp value={o.total.visits} />, detail: `${pct(r.planPct)} of ${o.total.planned.toLocaleString()} planned` },
                  { label: "Peak day", value: <CountUp value={o.perDay[peak]?.visits ?? 0} />, detail: o.perDay[peak]?.visits ? shortDay(days[peak]) : "—" },
                  { label: "Average per day", value: <CountUp value={withVisits ? o.total.visits / withVisits : 0} />, detail: `over ${withVisits} day${withVisits === 1 ? "" : "s"} with visits` },
                  { label: "Phone / desktop", value: (<><N v={o.total.mobile} /> / <N v={o.total.visits - o.total.mobile} /></>), detail: `${pct(r.mobilePct)} on a phone` },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-line bg-surface px-3 py-2">
                    <div className="font-mono text-[10px] tracking-wider text-subtle uppercase">{s.label}</div>
                    <div className="mt-0.5 text-lg font-semibold">{s.value}</div>
                    <div className="truncate text-[10px] text-subtle">{s.detail}</div>
                  </div>
                ));
              })()}
            </div>
            <ColumnChart
              days={days}
              height={280}
              stacks={[
                { label: "phone", color: PHONE, values: o.perDay.map((d) => d.mobile) },
                { label: "desktop", color: DESKTOP, values: o.perDay.map((d) => d.visits - d.mobile) },
              ]}
              reference={{ label: "planned", values: o.perDay.map((d) => d.planned) }}
            />
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Google position by site"
              empty={shownSites.every((s) => s.perDay.every((t) => rates(t).position == null && t.checkPosition == null)) ? "No Google position in this range yet: the daily check and the visits (app 1.0.2 and later) record it." : false}
              subtitle="Where the visits found each site on Google (else the daily ranking check); #1 is at the top"
              legend={shownSites.map((s) => ({ label: s.site, color: colorOf(s.site), kind: "line" as const }))}
              table={{
                head: ["Day", ...shownSites.map((s) => s.site)],
                rows: days.map((d, i) => [d, ...shownSites.map((s) => positionText(s.perDay[i]))]),
              }}
            >
              <LineChart days={days} invert series={shownSites.map((s) => ({ label: s.site, color: colorOf(s.site), values: s.perDay.map((t) => rates(t).position ?? t.checkPosition) }))} />
            </ChartCard>

            <ChartCard
              title="Visits that worked"
              empty={!o.total.visits && !o.total.failed ? "No visits or tries in this range yet." : false}
              subtitle="Visits that counted, of every try (a try fails on an unsolved CAPTCHA, the site not found, a proxy failing…)"
              table={{
                head: ["Day", "Worked", "Counted", "Failed tries"],
                rows: days.map((d, i) => [d, pct(perDayRates[i].successPct), o.perDay[i].visits, o.perDay[i].failed]),
              }}
            >
              <LineChart days={days} min={0} max={100} format={(n) => `${n}%`} series={[{ label: "worked", color: SERIES[0], values: perDayRates.map((x) => x.successPct) }]} />
            </ChartCard>

            <ChartCard
              title="CAPTCHAs per day"
              empty={!o.total.captchasMet ? "No CAPTCHAs met in this range (counted from app 1.0.2)." : false}
              subtitle="Google CAPTCHAs the visits met: solved and not solved"
              legend={[
                { label: "Solved", color: SERIES[0], kind: "bar" },
                { label: "Not solved", color: SERIES[1], kind: "bar" },
              ]}
              table={{ head: ["Day", "Met", "Solved", "Not solved"], rows: days.map((d, i) => [d, o.perDay[i].captchasMet, o.perDay[i].captchasSolved, o.perDay[i].captchasMet - o.perDay[i].captchasSolved]) }}
            >
              <ColumnChart
                days={days}
                stacks={[
                  { label: "solved", color: SERIES[0], values: o.perDay.map((d) => d.captchasSolved) },
                  { label: "not solved", color: SERIES[1], values: o.perDay.map((d) => d.captchasMet - d.captchasSolved) },
                ]}
              />
            </ChartCard>

            <ChartCard
              title="Time on site"
              empty={!o.total.detailedVisits ? "No time on site in this range yet (counted from app 1.0.2)." : false}
              subtitle="Average time each visit stayed on the site"
              table={{
                head: ["Day", "Time on site", "Pages per visit"],
                rows: days.map((d, i) => [d, perDayRates[i].secondsPerVisit != null ? duration(perDayRates[i].secondsPerVisit!) : "–", perDayRates[i].pagesPerVisit?.toFixed(1) ?? "–"]),
              }}
            >
              <LineChart days={days} format={duration} series={[{ label: "time on site", color: SERIES[0], values: perDayRates.map((x) => (x.secondsPerVisit != null ? Math.round(x.secondsPerVisit) : null)) }]} />
            </ChartCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* Sites: campaigns of the same site together. */}
            <section className="glass min-w-0 overflow-hidden rounded-xl">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">Sites</h2>
                <p className="mt-0.5 text-xs text-subtle">Campaigns of the same site added together, for this range. Click a site to show only it.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
                    <tr>
                      {["Site", "Campaigns", "Visits", "Of plan", "Worked", "Position", "Time on site", "Visits per day"].map((h) => (
                        <th key={h} className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {o.sites.map((s) => {
                      const x = rates(s.total);
                      const running = s.campaigns.filter((c) => isOpen(c.campaign.status)).length;
                      return (
                        <tr key={s.site} className="hover:bg-surface-2">
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-2">
                              <span className="h-0.5 w-3 rounded-full" style={{ background: colorOf(s.site) }} aria-hidden />
                              <button type="button" onClick={() => setSite(site === s.site ? "all" : s.site)} className="font-mono text-link hover:underline" title={site === s.site ? "Show all sites" : "Show only this site"}>
                                {s.site}
                              </button>
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums">
                            {running} <span className="text-subtle">active / {s.campaigns.length}</span>
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums"><N v={s.total.visits} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums"><P v={x.planPct} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums"><P v={x.successPct} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums"><Pos t={s.total} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums">{x.secondsPerVisit != null ? duration(x.secondsPerVisit) : "—"}</td>
                          <td className="px-3 py-1">
                            <Sparkline values={s.perDay.map((d) => d.visits)} width={90} height={24} color={colorOf(s.site)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <ChartCard title="Visits by computer" subtitle="Which PC made the visits in this range" table={{ head: ["Computer", "Visits", "Worked"], rows: o.computers.map((c) => [c.name, c.total.visits, pct(rates(c.total).successPct)]) }}>
              <BarList
                rows={o.computers.map((c) => ({
                  label: (
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      {c.name}
                      {me?.name === c.name && <ThisPcTag />}
                    </span>
                  ),
                  value: c.total.visits,
                  highlight: me?.name === c.name,
                  detail: rates(c.total).successPct != null ? `${rates(c.total).successPct}% worked` : undefined,
                }))}
              />
            </ChartCard>
          </div>

          {/* Every active campaign, with its own charts. */}
          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-sm font-semibold">Active campaigns · {active.length}</h2>
                <p className="mt-0.5 text-xs text-subtle">Running or paused, for this range. Open one for its full numbers and live console.</p>
              </div>
              <Link href="/ctr/campaigns" className="text-xs text-muted hover:text-ink">
                All campaigns →
              </Link>
            </div>
            {active.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {active.map((c) => (
                  <CampaignCard key={c.item.campaign.id} c={c} days={days} today={today} me={data.computer} siteColor={colorOf(siteOf(c.item.campaign))} />
                ))}
              </div>
            ) : (
              <div className="glass rounded-xl py-8 text-center text-sm text-muted">No active campaigns{site !== "all" ? " for this site" : ""}.</div>
            )}
          </section>

          {/* Finished and stopped: what each one achieved over its whole run. */}
          <section className="glass min-w-0 overflow-hidden rounded-xl">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Finished and stopped campaigns · {ended.length}</h2>
              <p className="mt-0.5 text-xs text-subtle">Each one&apos;s whole run, whatever the range above</p>
            </div>
            {ended.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-xs">
                  <thead className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
                    <tr>
                      {["Keyword · site", "Status", "Ran", "Visits", "Of plan", "Worked", "Position", "Time on site", "Computer"].map((h) => (
                        <th key={h} className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ended.map(({ item, allTime }) => {
                      const cpn = item.campaign;
                      const x = rates(allTime);
                      const lastDay = item.days.filter((d) => d.visitsDone).map((d) => d.day).sort().at(-1);
                      return (
                        <tr key={cpn.id} className="align-top hover:bg-surface-2">
                          <td className="max-w-0 px-3 py-2">
                            <Link href={`/ctr/campaigns/${cpn.id}`} className="block font-medium break-words text-ink hover:underline">
                              {cpn.keyword}
                            </Link>
                            <div className="truncate font-mono text-[11px] text-link">{siteOf(cpn)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={cpn.status} />
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted">
                            {cpn.startDate} → {cpn.status === "stopped" && lastDay ? lastDay : cpn.endDate}
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums">
                            <N v={allTime.visits} /> <span className="text-subtle">/ <N v={allTime.planned} /></span>
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums"><P v={x.planPct} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums"><P v={x.successPct} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums"><Pos t={allTime} /></td>
                          <td className="px-3 py-2 font-mono tabular-nums">{x.secondsPerVisit != null ? duration(x.secondsPerVisit) : "—"}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted">
                            <span className="inline-flex items-center gap-1.5">
                              {cpn.computerName ?? "—"}
                              {here(cpn) && <ThisPcTag />}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted">None yet.</div>
            )}
          </section>
          <p className="text-[11px] text-subtle">
            Failed tries, CAPTCHAs, time on site, pages and position in visits are counted from desktop app 1.0.2; earlier days only have the visits done and the daily ranking check.
          </p>
        </div>
      )}
    </div>
  );
}

/** Change against the period before: an arrow and words carry the direction (never color alone). */
function changeOf(now: number, before: number, unit?: "pts") {
  const diff = unit === "pts" || before === 0 ? now - before : ((now - before) / before) * 100;
  return { diff, up: diff > 0, none: Math.abs(diff) < 0.05 };
}

function Delta({ now, before, versus }: { now: number; before: number; versus: string }) {
  const { diff, up, none } = changeOf(now, before);
  if (none) return <div className="mt-2 text-[11px] text-subtle">No change {versus}</div>;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="mt-2 flex items-center gap-1 text-[11px]">
      <Icon className={`size-3.5 ${up ? "text-status-good" : "text-status-critical"}`} aria-hidden />
      <span className="font-medium text-ink">
        {up ? "Up" : "Down"} {before === 0 ? `+${compact(diff)}` : `${Math.abs(Math.round(diff))}%`}
      </span>
      <span className="text-subtle">{versus}</span>
    </div>
  );
}

function Kpi({
  icon: Icon0,
  label,
  value,
  detail,
  now,
  before,
  unit,
  lowerIsBetter,
  trend,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  detail?: string;
  now?: number | null;
  before?: number | null;
  unit?: "pts";
  lowerIsBetter?: boolean;
  trend?: (number | null)[];
}) {
  const change = now != null && before != null ? changeOf(now, before, unit) : null;
  const good = change ? (lowerIsBetter ? !change.up : change.up) : false;
  const Icon = change?.up ? ArrowUpRight : ArrowDownRight;
  const amount = change ? (unit === "pts" ? `${Math.abs(Math.round(change.diff))} pts` : lowerIsBetter ? `${Math.abs(Math.round((now! - before!) * 10) / 10)}` : `${Math.abs(Math.round(change.diff))}%`) : "";
  return (
    <div className="glass group/kpi relative min-w-0 overflow-hidden rounded-2xl px-4 py-3 transition hover:border-white/15">
      <div className="pointer-events-none absolute -top-10 -right-8 size-24 rounded-full bg-accent/10 opacity-0 blur-2xl transition-opacity group-hover/kpi:opacity-100" aria-hidden />
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
          <Icon0 className="size-3" aria-hidden />
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {trend && <Sparkline values={trend} width={64} height={24} />}
      </div>
      {detail && <div className="mt-0.5 truncate text-[11px] text-subtle">{detail}</div>}
      {change &&
        (change.none ? (
          <div className="mt-1 text-[10px] text-subtle">no change</div>
        ) : (
          <div className="mt-1 flex items-center gap-1 text-[10px]">
            <Icon className={`size-3 ${good ? "text-status-good" : "text-status-critical"}`} aria-hidden />
            <span className="text-muted">
              {change.up ? "up" : "down"} {amount}
            </span>
          </div>
        ))}
    </div>
  );
}

/** One active campaign: who runs it, where it is in its plan, and its visits and position for the range. */
function CampaignCard({ c, days, today, me, siteColor }: { c: Overview["campaigns"][number]; days: string[]; today: string; me: ThisComputer | null; siteColor: string }) {
  const cpn = c.item.campaign;
  const x = rates(c.total);
  const day = Math.min(cpn.durationDays, Math.max(1, daysBetween(cpn.startDate, today) + 1));
  const todayRow = c.item.days.find((d) => d.day === today);
  const todayPlanned = c.perDay.at(-1)?.planned ?? 0;
  const mine = !!me && cpn.computerId === me.id;
  return (
    <Link
      href={`/ctr/campaigns/${cpn.id}`}
      className={`glass group relative block min-w-0 overflow-hidden rounded-2xl px-4 pb-4 transition ${mine ? "pt-8 " : "pt-4 "}${mine ? "border-accent/60! shadow-[0_0_0_1px_#8b5cf640,0_12px_40px_-12px_#8b5cf680] hover:border-accent!" : "hover:border-white/15"}`}
    >
      {mine && (
        <>
          <div className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-accent/20 blur-3xl" aria-hidden />
          <div className="absolute top-0 left-4 rounded-b-md bg-accent px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-white uppercase shadow-[0_4px_12px_#8b5cf680]">Runs on this PC</div>
        </>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium break-words text-ink group-hover:underline">{cpn.keyword}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-link">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: siteColor }} aria-hidden />
            {siteOf(cpn)}
          </div>
        </div>
        <StatusBadge status={cpn.status} />
      </div>
      <div className="mt-2">
        <ComputerBadge campaign={cpn} me={me} />
      </div>
      <div className="mt-3">
        <div className="flex justify-between font-mono text-[10px] text-subtle">
          <span>
            day {day} of {cpn.durationDays}
          </span>
          <span>
            today {todayRow?.visitsDone ?? 0} / {todayPlanned.toLocaleString()}
          </span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-surface-2">
          <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (day / cpn.durationDays) * 100)}%`, background: SERIES[0] }} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Mini label="Visits" value={<N v={c.total.visits} />} />
        <Mini label="Of plan" value={<P v={x.planPct} />} />
        <Mini label="Worked" value={<P v={x.successPct} />} />
        <Mini label="Position" value={<Pos t={c.total} />} />
      </div>
      <div className="mt-3">
        <div className="mb-1 font-mono text-[10px] text-subtle">Visits per day · {days.length > 1 ? `${shortDay(days[0])} – ${shortDay(days[days.length - 1])}` : "today"}</div>
        <Sparkline values={c.perDay.map((d) => d.visits)} width={260} height={36} color={siteColor} />
      </div>
    </Link>
  );
}

/**
 * While the numbers load (the database can take a moment to wake up): the dashboard's shape, softly
 * shimmering, so the page builds in place instead of showing a blank "Loading…".
 */
function DashboardSkeleton() {
  const block = "skeleton rounded-2xl border border-line";
  return (
    <div className="relative space-y-5" aria-busy="true" aria-label="Loading the dashboard">
      {/* The loader, over the outline of what's coming. */}
      <div className="pointer-events-none absolute inset-x-0 top-40 z-10 flex justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0f1118]/85 px-5 py-3 shadow-[0_12px_40px_-12px_#8b5cf680] backdrop-blur-md">
          <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
          <div>
            <div className="text-sm font-medium text-ink">Loading the latest numbers…</div>
            <div className="text-[11px] text-subtle">Campaigns, visits and charts</div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,3fr)]">
        <div className={`${block} h-[180px]`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`${block} h-[84px]`} style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      </div>
      <div className={`${block} h-[420px]`} />
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${block} h-[280px]`} style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}

/** "This PC": marks what this computer runs, wherever a computer is named. */
function ThisPcTag() {
  return <span className="rounded-full bg-accent px-1.5 py-px font-sans text-[9px] font-semibold tracking-wide text-white uppercase">This PC</span>;
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface px-1 py-1.5">
      <div className="font-mono text-sm font-semibold text-ink">{value}</div>
      <div className="text-[10px] text-subtle">{label}</div>
    </div>
  );
}
