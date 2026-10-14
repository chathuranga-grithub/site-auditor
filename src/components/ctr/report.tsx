"use client";

// Auto CTR report: the dashboard's numbers for one set of filters (period, site, computer), laid out as
// A4 pages in light, print-ready styles: a summary with the change against the period before, key
// findings in plain words, visits per day against the target, tries and CAPTCHAs per day, why tries
// failed, each campaign's results, devices, computers, sites, places and a day-by-day table. Charts are
// plain SVG (no animation), so the PDF is drawn exactly as shown. GET /api/ctr/report makes the PDF from
// this page (headless Chrome); where that isn't possible (the website), the browser's own "Save as PDF".
// The page says it's ready (data-report-ready) once its numbers are in.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import type { CampaignDay } from "@/lib/campaigns/types";
import { todayInVietnam } from "@/lib/campaigns/site";
import { buildOverview, campaignIssues, hasActivity, periodDays, rates, reasonList, siteOf } from "@/lib/campaigns/overview";
import { PERIOD_LABELS, reportUrl, type ReportFilters } from "@/lib/campaigns/report-filters";
import { Logo } from "@/components/shell/logo";
import { api, type CampaignItem, type ThisComputer } from "./ui";
import { VietnamMap } from "./vietnam-map";

type Item = CampaignItem & { days: CampaignDay[] };

const PHONE = "#3987e5";
const DESKTOP = "#199e70";
const TARGET = "#94a3b8";
const FAILED = "#e05252";
const CAPTCHA = "#c98500";
const ACCENT = "#7c3aed";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
/** CAPTCHAs per try (a try can meet several). */
const perTry = (n: number, tries: number) => (tries ? (n / tries).toFixed(1) : "—");
const day = (d: string, year = false) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const duration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);

export function CtrReport({ filters }: { filters: ReportFilters }) {
  const [data, setData] = useState<{ items: Item[]; computer: ThisComputer | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generated] = useState(() => new Date());

  useEffect(() => {
    api<{ items: Item[]; computer: ThisComputer | null }>("/api/ctr/campaigns").then(setData, (e: Error) => setError(e.message));
  }, []);

  const today = todayInVietnam();
  const report = useMemo(() => {
    if (!data) return null;
    const all = data.items.map((i) => ({ campaign: i.campaign, days: i.days ?? [] }));
    const items = all.filter((i) => (filters.site === "all" || siteOf(i.campaign) === filters.site) && (filters.pc === "all" || i.campaign.computerId === filters.pc));
    const { days, before } = periodDays(today, filters.period, items.length ? items : all);
    const o = buildOverview(items, days, before ?? undefined);
    const pcName = filters.pc === "all" ? "All computers" : (all.find((i) => i.campaign.computerId === filters.pc)?.campaign.computerName ?? (data.computer?.id === filters.pc ? data.computer.name : "One computer"));
    return { o, days, compare: before != null, pcName, campaigns: o.campaigns.filter(hasActivity) };
  }, [data, filters, today]);

  // The PDF from the app (headless Chrome); where it can't make one (the website), the browser's own.
  const download = async () => {
    setSaving(true);
    try {
      const res = await fetch(reportUrl(filters, true));
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "auto-ctr-report.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      window.print();
    } finally {
      setSaving(false);
    }
  };

  const range = report ? (report.days.length > 1 ? `${day(report.days[0])} – ${day(report.days.at(-1)!, true)}` : day(report.days[0], true)) : "";

  return (
    <div className="report-root min-h-screen bg-slate-200/70 py-8 text-slate-800 print:bg-white print:py-0" data-report-ready={report ? "1" : undefined}>
      {/* On screen only: what this is, and the download. */}
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-3 px-1 print:hidden">
        <a href="/ctr" className="text-sm text-slate-600 hover:text-slate-900">
          ← Back to the dashboard
        </a>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Printer className="size-4" aria-hidden /> Print
          </button>
          <button type="button" disabled={!report || saving} onClick={download} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-violet-700 disabled:opacity-60">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {saving ? "Making the PDF…" : "Download PDF"}
          </button>
        </div>
      </div>

      <article className="mx-auto w-[210mm] max-w-full bg-white px-[12mm] py-[12mm] shadow-xl print:w-auto print:p-0 print:shadow-none">
        {error && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {!report && !error && <p className="py-24 text-center text-sm text-slate-500">Loading the numbers…</p>}
        {report && (
          <Body
            o={report.o}
            days={report.days}
            compare={report.compare}
            campaigns={report.campaigns}
            today={today}
            title={PERIOD_LABELS[filters.period]}
            range={range}
            site={filters.site === "all" ? "All sites" : filters.site}
            pc={report.pcName}
            generated={generated}
          />
        )}
      </article>
    </div>
  );
}

type O = ReturnType<typeof buildOverview>;

function Body({ o, days, compare, campaigns, today, title, range, site, pc, generated }: { o: O; days: string[]; compare: boolean; campaigns: O["campaigns"]; today: string; title: string; range: string; site: string; pc: string; generated: Date }) {
  const t = o.total;
  const r = rates(t);
  const p = rates(o.previous);
  const tries = t.visits + t.failed;
  const unsolved = t.captchasMet - t.captchasSolved;
  const reasons = reasonList(t);
  const withIssues = campaigns.map((c) => ({ c, issues: campaignIssues(c, days, today) }));
  const attention = withIssues.filter((x) => x.issues.some((i) => i.bad));
  const versus = (now: number | null, before: number | null, unit: "%" | "pts" = "%", lowerIsBetter = false) => {
    // Nothing before (e.g. the campaigns started this period): no change to show.
    if (!compare || now == null || before == null || (unit === "%" && !before)) return null;
    const diff = unit === "pts" ? now - before : ((now - before) / before) * 100;
    if (Math.abs(diff) < 0.5) return { text: "no change", good: null };
    const up = diff > 0;
    return { text: `${up ? "▲" : "▼"} ${Math.abs(Math.round(diff))}${unit === "pts" ? " pts" : "%"}`, good: lowerIsBetter ? !up : up };
  };

  // The charts and the day table start at the period's first day with a target or anything done (a long
  // period that began before the campaigns would otherwise be mostly empty days).
  const from = Math.max(0, o.perDay.findIndex((d) => d.planned || d.visits || d.failed || d.captchasMet));
  const shown = days.slice(from);
  const perDay = o.perDay.slice(from);

  // Key findings, in plain words.
  const findings: ReactNode[] = [];
  findings.push(
    <>
      <b>{fmt(t.visits)}</b> of <b>{fmt(t.planned)}</b> target visits finished (<b>{pct(r.planPct)}</b>)
      {compare && o.previous.visits > 0 && <>, against {fmt(o.previous.visits)} in the period before</>}.
    </>,
  );
  if (tries)
    findings.push(
      <>
        <b>{fmt(t.failed)}</b> of {fmt(tries)} tries failed ({share(t.failed, tries)}%)
        {reasons[0] && reasons[0].key !== "unknown" && (
          <>
            ; the main reason: <b>{reasons[0].label}</b> ({fmt(reasons[0].n)}, {share(reasons[0].n, t.failed)}% of failures)
          </>
        )}
        .
      </>,
    );
  if (t.captchasMet)
    findings.push(
      <>
        Google asked for <b>{fmt(t.captchasMet)}</b> CAPTCHAs ({perTry(t.captchasMet, tries)} per try): <b>{fmt(t.captchasSolved)}</b> solved, <b>{fmt(unsolved)}</b> not ({pct(r.captchaSolvedPct)} solved).
      </>,
    );
  if (t.visits) findings.push(<>Visits on a phone: <b>{pct(r.mobilePct)}</b> ({fmt(t.mobile)}), on a desktop: {fmt(t.visits - t.mobile)}.</>);
  findings.push(
    attention.length ? (
      <>
        <b>{attention.length}</b> of {campaigns.length} campaigns need a look: {attention.slice(0, 4).map((x) => x.c.item.campaign.keyword).join(", ")}
        {attention.length > 4 ? ` and ${attention.length - 4} more` : ""} (see Campaign results).
      </>
    ) : (
      <>All {campaigns.length} campaigns are on track.</>
    ),
  );

  return (
    <div className="space-y-7 text-[11px] leading-relaxed">
      {/* Title */}
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-700 via-violet-600 to-indigo-600 px-7 py-6 text-white">
        <div className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -bottom-24 left-1/3 size-56 rounded-full bg-white/5" aria-hidden />
        <div className="relative flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-violet-100 uppercase">
              <Logo className="size-6" /> SEO Toolkit · Auto CTR
            </div>
            <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-tight">Campaign performance report</h1>
            <p className="mt-1 text-[13px] text-violet-100">
              {title} · {range}
            </p>
          </div>
          <dl className="shrink-0 space-y-1 text-right text-[10px] text-violet-100">
            <div>
              <dt className="inline opacity-75">Site: </dt>
              <dd className="inline font-medium text-white">{site}</dd>
            </div>
            <div>
              <dt className="inline opacity-75">Computer: </dt>
              <dd className="inline font-medium text-white">{pc}</dd>
            </div>
            <div>
              <dt className="inline opacity-75">Campaigns: </dt>
              <dd className="inline font-medium text-white">{campaigns.length}</dd>
            </div>
            <div className="pt-1 opacity-75">
              Made {generated.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })} (Vietnam)
            </div>
          </dl>
        </div>
      </header>

      {/* Summary */}
      <Section title="Summary" note={compare ? "Changes are against the same days of the period before." : undefined}>
        <div className="grid grid-cols-4 gap-2.5">
          <Kpi label="Target visits" value={fmt(t.planned)} detail={`${days.length} day${days.length === 1 ? "" : "s"}`} />
          <Kpi label="Finished" value={fmt(t.visits)} detail={`${pct(r.planPct)} of target`} change={versus(t.visits, o.previous.visits)} tone="good" />
          <Kpi label="Failed tries" value={fmt(t.failed)} detail={`of ${fmt(tries)} tries`} change={versus(t.failed, o.previous.failed, "%", true)} tone={t.failed > t.visits ? "bad" : undefined} />
          <Kpi label="Visits that worked" value={pct(r.successPct)} detail="finished, of every try" change={versus(r.successPct, p.successPct, "pts")} />
          <Kpi label="CAPTCHAs met" value={fmt(t.captchasMet)} detail={tries ? `${perTry(t.captchasMet, tries)} per try` : "—"} change={versus(t.captchasMet, o.previous.captchasMet, "%", true)} />
          <Kpi label="CAPTCHAs solved" value={pct(r.captchaSolvedPct)} detail={`${fmt(t.captchasSolved)} solved · ${fmt(unsolved)} not`} change={versus(r.captchaSolvedPct, p.captchaSolvedPct, "pts")} tone={unsolved > t.captchasSolved ? "bad" : undefined} />
          <Kpi label="Phone / desktop" value={`${pct(r.mobilePct)}`} detail={`${fmt(t.mobile)} phone · ${fmt(t.visits - t.mobile)} desktop`} />
          <Kpi
            label="Time on site"
            value={r.secondsPerVisit != null ? duration(r.secondsPerVisit) : "—"}
            detail={r.position != null ? `Google position #${r.position}` : r.pagesPerVisit != null ? `${r.pagesPerVisit.toFixed(1)} pages per visit` : "per visit"}
          />
        </div>
        <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-violet-700 uppercase">Key findings</div>
          <ul className="list-disc space-y-1 pl-4 text-slate-700 marker:text-violet-400">
            {findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Visits per day */}
      <Section title="Visits per day" note="Finished visits on a phone and on a desktop, against the target (line)." avoidBreak>
        <Legend items={[{ label: "Phone", color: PHONE }, { label: "Desktop", color: DESKTOP }, { label: "Target", color: TARGET, line: true }]} />
        <Columns days={shown} stacks={[{ color: PHONE, values: perDay.map((d) => d.mobile) }, { color: DESKTOP, values: perDay.map((d) => d.visits - d.mobile) }]} line={{ color: TARGET, values: perDay.map((d) => d.planned) }} />
      </Section>

      {/* Tries and CAPTCHAs per day */}
      <Section title="Tries and CAPTCHAs per day" note="Every try: finished or failed; and the CAPTCHAs Google asked for (line)." avoidBreak>
        <Legend items={[{ label: "Finished", color: DESKTOP }, { label: "Failed", color: FAILED }, { label: "CAPTCHAs met", color: CAPTCHA, line: true }]} />
        <Columns days={shown} stacks={[{ color: DESKTOP, values: perDay.map((d) => d.visits) }, { color: FAILED, values: perDay.map((d) => d.failed) }]} line={{ color: CAPTCHA, values: perDay.map((d) => d.captchasMet) }} />
      </Section>

      {/* Why tries failed + devices */}
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6 break-inside-avoid">
        <Section title="Why tries failed" note={`${fmt(t.failed)} tries didn't count (reasons saved from app 1.0.17).`}>
          {reasons.length ? (
            <ul className="space-y-2.5">
              {reasons.map((x) => (
                <li key={x.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-800">{x.label}</span>
                    <span className="font-mono tabular-nums">
                      {fmt(x.n)} <span className="text-slate-400">· {share(x.n, t.failed)}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full" style={{ width: `${Math.max(2, share(x.n, reasons[0].n))}%`, background: x.key === "unknown" ? TARGET : FAILED }} />
                  </div>
                  <div className="mt-0.5 text-[9.5px] text-slate-500">{x.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No failed tries in this period.</Empty>
          )}
        </Section>
        <Section title="Devices">
          {t.visits ? (
            <div className="flex items-center gap-5">
              <Donut parts={[{ value: t.mobile, color: PHONE }, { value: t.visits - t.mobile, color: DESKTOP }]} center={pct(r.mobilePct)} sub="on a phone" />
              <ul className="space-y-2">
                <li>
                  <Dot color={PHONE} /> Phone <b className="ml-1 font-mono">{fmt(t.mobile)}</b>
                </li>
                <li>
                  <Dot color={DESKTOP} /> Desktop <b className="ml-1 font-mono">{fmt(t.visits - t.mobile)}</b>
                </li>
              </ul>
            </div>
          ) : (
            <Empty>No finished visits in this period.</Empty>
          )}
        </Section>
      </div>

      {/* Campaign results */}
      <Section title="Campaign results" note="Each campaign in this period, most target first.">
        <Table
          head={["Campaign", "Target", "Finished", "Failed", "CAPTCHAs", "Phone / desktop", "Worked", "Check"]}
          align={["left", "right", "right", "right", "right", "right", "right", "left"]}
          rows={[...withIssues]
            .sort((a, b) => b.c.total.planned - a.c.total.planned)
            .map(({ c, issues }) => {
              const x = c.total;
              const cpn = c.item.campaign;
              const top = reasonList(x)[0];
              return [
                <div key="c" className="max-w-[46mm]">
                  <div className="font-semibold break-words text-slate-900">{cpn.keyword}</div>
                  <div className="text-[9px] text-slate-500">
                    {cpn.mode === "search" ? "Search only" : siteOf(cpn)} · {cpn.status} · {cpn.computerName ?? "no PC"}
                  </div>
                </div>,
                fmt(x.planned),
                <div key="f">
                  <b>{fmt(x.visits)}</b>
                  <div className="text-[9px] text-slate-500">{pct(rates(x).planPct)}</div>
                </div>,
                <div key="x">
                  <span className={x.failed > x.visits ? "font-semibold text-red-600" : ""}>{fmt(x.failed)}</span>
                  {top && <div className="text-[9px] whitespace-nowrap text-slate-500">{top.label}</div>}
                </div>,
                <div key="k">
                  {fmt(x.captchasMet)}
                  {x.captchasMet > 0 && <div className="text-[9px] text-slate-500">{fmt(x.captchasMet - x.captchasSolved)} not solved</div>}
                </div>,
                `${fmt(x.mobile)} / ${fmt(x.visits - x.mobile)}`,
                pct(rates(x).successPct),
                issues.length ? (
                  <ul key="i" className="space-y-0.5">
                    {issues.map((i) => (
                      <li key={i.text} className={i.bad ? "text-red-600" : "text-slate-500"}>
                        {i.bad ? "⚠ " : ""}
                        {i.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span key="ok" className="text-emerald-600">✓ On track</span>
                ),
              ];
            })}
          foot={["Total", fmt(t.planned), `${fmt(t.visits)} · ${pct(r.planPct)}`, fmt(t.failed), fmt(t.captchasMet), `${fmt(t.mobile)} / ${fmt(t.visits - t.mobile)}`, pct(r.successPct), ""]}
        />
      </Section>

      {/* Computers, sites */}
      <div className="grid grid-cols-2 gap-6 break-inside-avoid">
        <Section title="Computers" note="Which PC made the visits.">
          {o.computers.length ? (
            <Table
              head={["Computer", "Finished", "Failed", "Worked"]}
              align={["left", "right", "right", "right"]}
              rows={o.computers.map((c) => [<b key="n">{c.name}</b>, fmt(c.total.visits), fmt(c.total.failed), pct(rates(c.total).successPct)])}
            />
          ) : (
            <Empty>No visits in this period.</Empty>
          )}
        </Section>
        <Section title="Sites" note="Campaigns of the same site together.">
          <Table
            head={["Site", "Finished", "Of target", "Position"]}
            align={["left", "right", "right", "right"]}
            rows={o.sites.map((s) => {
              const x = rates(s.total);
              const pos = x.position ?? s.total.checkPosition;
              return [<span key="s" className="break-all">{s.site}</span>, fmt(s.total.visits), pct(x.planPct), pos != null ? `#${pos}` : "—"];
            })}
          />
        </Section>
      </div>

      {/* Places */}
      {o.places.length > 0 && (
        <Section title="Where the visits came from" note={`The city of each visit's proxy IP: ${o.places.length} place${o.places.length === 1 ? "" : "s"}, the top 12 listed.`} avoidBreak>
          <div className="flex items-start gap-8">
            <VietnamMap
              light
              places={o.places.filter((pl) => pl.lat != null && pl.lon != null).map((pl) => ({ key: pl.label, label: pl.label, lat: pl.lat!, lon: pl.lon!, visits: pl.visits }))}
              className="h-[88mm] shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              {o.places.slice(0, 12).map((pl, i) => (
                <div key={pl.label}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate">
                      <span className="mr-1.5 inline-block w-4 text-right font-mono text-slate-400">{i + 1}</span>
                      {pl.label}
                    </span>
                    <span className="font-mono tabular-nums">
                      {fmt(pl.visits)} <span className="text-slate-400">· {share(pl.visits, t.visits)}%</span>
                    </span>
                  </div>
                  <div className="mt-0.5 ml-5.5 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, share(pl.visits, o.places[0].visits))}%`, background: ACCENT }} />
                  </div>
                </div>
              ))}
              {o.places.length > 12 && <p className="pt-1 text-[9.5px] text-slate-500">and {o.places.length - 12} more places</p>}
            </div>
          </div>
        </Section>
      )}

      {/* Day by day */}
      <Section title="Day by day" avoidBreak={shown.length <= 14} breakBefore={shown.length > 14}>
        <Table
          head={["Day", "Target", "Finished", "Of target", "Failed", "Worked", "CAPTCHAs", "Solved", "Phone", "Desktop"]}
          align={["left", "right", "right", "right", "right", "right", "right", "right", "right", "right"]}
          rows={shown.map((d, i) => {
            const x = perDay[i];
            const y = rates(x);
            return [day(d, true), fmt(x.planned), fmt(x.visits), pct(y.planPct), fmt(x.failed), pct(y.successPct), fmt(x.captchasMet), fmt(x.captchasSolved), fmt(x.mobile), fmt(x.visits - x.mobile)];
          })}
          foot={["Total", fmt(t.planned), fmt(t.visits), pct(r.planPct), fmt(t.failed), pct(r.successPct), fmt(t.captchasMet), fmt(t.captchasSolved), fmt(t.mobile), fmt(t.visits - t.mobile)]}
        />
        {/* With the last table, so it never ends up alone on a page. */}
        <p className="mt-4 border-t border-slate-200 pt-3 text-[9px] break-inside-avoid text-slate-400">
          Numbers are the campaigns&apos; daily totals (Vietnam dates)
          {from > 0 ? `; the charts and this table start on ${day(shown[0])}, the first day with a target or visits` : ""}. Failed tries, CAPTCHAs and time on site are counted
          from desktop app 1.0.2; reasons for failed tries from 1.0.17 (earlier ones show as &quot;Not recorded&quot;). Today&apos;s target counts in full; the Check column compares
          today against the part of the day gone.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, note, children, avoidBreak, breakBefore }: { title: string; note?: string; children: ReactNode; avoidBreak?: boolean; breakBefore?: boolean }) {
  return (
    <section className={`${avoidBreak ? "break-inside-avoid" : ""} ${breakBefore ? "break-before-page" : ""}`}>
      <div className="mb-2.5 flex items-baseline gap-3 border-b border-slate-200 pb-1.5">
        <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">
          <span className="mr-2 inline-block h-3 w-1 rounded-full bg-violet-600 align-[-1px]" aria-hidden />
          {title}
        </h2>
        {note && <p className="text-[10px] text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, detail, change, tone }: { label: string; value: string; detail?: string; change?: { text: string; good: boolean | null } | null; tone?: "good" | "bad" }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone === "bad" ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-slate-50/70"}`}>
      <div className="text-[9px] font-semibold tracking-[0.12em] text-slate-500 uppercase">{label}</div>
      <div className={`mt-0.5 text-[20px] leading-tight font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : "text-slate-900"}`}>{value}</div>
      {detail && <div className="truncate text-[9.5px] text-slate-500">{detail}</div>}
      {change && <div className={`mt-0.5 text-[9.5px] font-medium ${change.good == null ? "text-slate-400" : change.good ? "text-emerald-600" : "text-red-600"}`}>{change.text} vs before</div>}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="mb-1.5 flex gap-4 text-[9.5px] text-slate-600">
      {items.map((x) => (
        <span key={x.label} className="inline-flex items-center gap-1.5">
          {x.line ? <span className="inline-block h-0.5 w-3.5" style={{ background: x.color }} /> : <span className="inline-block size-2.5 rounded-sm" style={{ background: x.color }} />}
          {x.label}
        </span>
      ))}
    </div>
  );
}

const Dot = ({ color }: { color: string }) => <span className="mr-1 inline-block size-2.5 rounded-full align-[-1px]" style={{ background: color }} />;
const Empty = ({ children }: { children: ReactNode }) => <p className="py-4 text-center text-slate-400">{children}</p>;

/** "Nice" steps for an axis up to `max`: 4 lines. */
function axis(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/** Stacked columns per day, with an optional line on top (e.g. the target): plain SVG, drawn as is. */
function Columns({ days, stacks, line }: { days: string[]; stacks: { color: string; values: number[] }[]; line?: { color: string; values: number[] } }) {
  const W = 690;
  const H = 190;
  const left = 40;
  const bottom = 20;
  const top = 8;
  const totals = days.map((_, i) => stacks.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const ticks = axis(Math.max(1, ...totals, ...(line?.values ?? [])));
  const max = ticks.at(-1)!;
  const plotW = W - left - 6;
  const plotH = H - top - bottom;
  const slot = plotW / days.length;
  const bar = Math.max(2, Math.min(36, slot * 0.62));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(days.length / 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={left - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#64748b">
            {v >= 10_000 ? `${Math.round(v / 1000)}K` : fmt(v)}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        let acc = 0;
        const x = left + i * slot + (slot - bar) / 2;
        return (
          <g key={d}>
            {stacks.map((s, k) => {
              const v = s.values[i] ?? 0;
              const y0 = y(acc);
              acc += v;
              const h = y0 - y(acc);
              return v > 0 ? <rect key={k} x={x} y={y(acc)} width={bar} height={Math.max(0.8, h)} rx={k === stacks.length - 1 ? 2 : 0} fill={s.color} /> : null;
            })}
            {i % labelEvery === 0 && (
              <text x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#64748b">
                {day(d)}
              </text>
            )}
          </g>
        );
      })}
      {line && (
        <polyline
          points={line.values.map((v, i) => `${left + i * slot + slot / 2},${y(v)}`).join(" ")}
          fill="none"
          stroke={line.color}
          strokeWidth={1.8}
          strokeDasharray={line.color === TARGET ? "4 3" : undefined}
          strokeLinejoin="round"
        />
      )}
      {line && days.length <= 31 && line.values.map((v, i) => <circle key={i} cx={left + i * slot + slot / 2} cy={y(v)} r={2} fill={line.color} />)}
    </svg>
  );
}

function Donut({ parts, center, sub }: { parts: { value: number; color: string }[]; center: string; sub: string }) {
  const total = parts.reduce((s, x) => s + x.value, 0) || 1;
  const R = 42;
  const C = 2 * Math.PI * R;
  // Each part's length around the ring, and where it starts (after the parts before it).
  const lens = parts.map((x) => (x.value / total) * C);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((s, l) => s + l, 0));
  return (
    <svg viewBox="0 0 110 110" className="size-28 shrink-0" role="img">
      <circle cx={55} cy={55} r={R} fill="none" stroke="#f1f5f9" strokeWidth={14} />
      {parts.map((x, i) => (
        <circle key={i} cx={55} cy={55} r={R} fill="none" stroke={x.color} strokeWidth={14} strokeDasharray={`${lens[i]} ${C - lens[i]}`} strokeDashoffset={-starts[i]} transform="rotate(-90 55 55)" />
      ))}
      <text x={55} y={55} textAnchor="middle" fontSize={17} fontWeight={600} fill="#0f172a">
        {center}
      </text>
      <text x={55} y={69} textAnchor="middle" fontSize={8.5} fill="#64748b">
        {sub}
      </text>
    </svg>
  );
}

function Table({ head, rows, foot, align }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; align: ("left" | "right")[] }) {
  const cls = (i: number) => (align[i] === "right" ? "text-right tabular-nums" : "text-left");
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="border-b-2 border-slate-300 text-[8.5px] tracking-[0.1em] text-slate-500 uppercase">
          {head.map((h, i) => (
            <th key={h} className={`px-1.5 py-1.5 font-semibold ${cls(i)}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="break-inside-avoid border-b border-slate-100 align-top even:bg-slate-50/70">
            {row.map((cell, i) => (
              <td key={i} className={`px-1.5 py-1.5 ${cls(i)}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
            {foot.map((cell, i) => (
              <td key={i} className={`px-1.5 py-1.5 whitespace-nowrap ${cls(i)}`}>
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

