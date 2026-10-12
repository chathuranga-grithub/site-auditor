"use client";

// Auto CTR: the new-campaign form. Target (site, keyword) and Visit plan (duration, day 1 visits,
// daily increase, compounded; concurrency: visits at the same time, up to the proxy API links saved in
// Settings, and starting at that max) are sent. Tracking (data sources) and Goals (CTR, position, click growth,
// time on page) are kept for later but hidden (SHOW_LATER); they aren't sent, so the server uses its defaults.
// Behavior: mobile traffic (% of each day's visits on a phone, the rest on a desktop, mixed at random)
// and dwell time (min and max seconds each visit stays on the site) are sent; CTR is a form field only.
// Computer: the one that runs it, this one unless another is picked (on the website: the first one
// that's on); another computer starts it within a minute.
// Laid out to fit one screen: the sections are rows of fields on the left, and a summary of what
// will be tracked, with the Start button, stays on the right.
// `editing`: the same form, to edit a campaign: filled in with its settings; the summary lists what
// changes (kept in its change history once saved); the duration can't end before today.

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowLeft, CalendarRange, Crosshair, Globe, History, Loader2, Monitor, Play, Save, Target, TrendingUp } from "lucide-react";
import { daysBetween } from "@/lib/campaigns/metrics";
import { todayInVietnam } from "@/lib/campaigns/site";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_DAILY_INCREASE_PCT,
  DEFAULT_DAY1_VISITS,
  DEFAULT_DURATION_DAYS,
  DEFAULT_MAX_DWELL_SEC,
  DEFAULT_MIN_DWELL_SEC,
  DEFAULT_MOBILE_PCT,
  MAX_DAILY_INCREASE_PCT,
  MAX_DAY1_VISITS,
  MAX_DURATION_DAYS,
  MAX_DWELL_SEC,
  expectedCtr,
  mobileVisits,
  plannedVisits,
  plannedVisitsTotal,
  endDateOf,
  type Campaign,
  type CtrSetup,
  type FieldChange,
} from "@/lib/campaigns/types";
import { Notice } from "@/components/ui/primitives";
import { Loader } from "@/components/ui/loader";
import { PageHeader, SetupNotice, api, changeText } from "./ui";
import { ComputerSelect, computerState, useComputers, type Computers } from "./computer-picker";

/** Tracking and Goals: hidden until campaigns use them again. */
const SHOW_LATER = false;

const input =
  "h-9 w-full rounded-lg border border-line bg-canvas/60 px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

/** The edit page: loads the campaign, then the form filled in with it. A stopped campaign can't be changed. */
export function EditCampaign({ id }: { id: number }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ campaign: Campaign }>(`/api/ctr/campaigns/${id}`).then(
      (d) => setCampaign(d.campaign),
      (e: Error) => setError(e.message),
    );
  }, [id]);
  const shell = (body: ReactNode) => (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <BackButton campaignId={id} />
      {body}
    </div>
  );
  if (error) return shell(<Notice tone="error">{error}</Notice>);
  if (!campaign) return shell(<Loader title="Loading the campaign…" className="py-16" />);
  if (campaign.status === "stopped") return shell(<Notice tone="warning">This campaign has been stopped for good, so it can&apos;t be changed.</Notice>);
  return <NewCampaign editing={campaign} />;
}

/**
 * Editing: back to the page it was opened from (the campaign list, or the campaign's page). Opened on
 * its own (a new tab, a link): to the campaign's page.
 */
function BackButton({ campaignId }: { campaignId: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(`/ctr/campaigns/${campaignId}`))}
      className="group inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface pr-3 pl-2 text-xs font-medium text-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-ink"
    >
      <ArrowLeft className="size-3.5 transition group-hover:-translate-x-0.5" aria-hidden />
      Back
    </button>
  );
}

/** The form's fields for a campaign being edited (its settings), or a new one (the defaults). */
function initialForm(c?: Campaign) {
  return {
    siteUrl: c?.siteUrl ?? "",
    keyword: c?.keyword ?? "",
    durationDays: String(c?.durationDays ?? DEFAULT_DURATION_DAYS),
    day1Visits: String(c?.day1Visits ?? DEFAULT_DAY1_VISITS),
    dailyIncreasePct: String(c?.dailyIncreasePct ?? DEFAULT_DAILY_INCREASE_PCT),
    concurrency: String(c?.concurrency ?? DEFAULT_CONCURRENCY),
    gscProperty: "",
    ga4Property: "",
    targetCtr: "80",
    behaviorCtr: "80",
    mobilePct: String(c?.mobilePct ?? DEFAULT_MOBILE_PCT),
    minDwellSec: String(c?.minDwellSec ?? DEFAULT_MIN_DWELL_SEC),
    maxDwellSec: String(c?.maxDwellSec ?? DEFAULT_MAX_DWELL_SEC),
    targetPosition: "3",
    weeklyGrowthPct: "10",
    targetEngagementSec: "60",
  };
}

/** The fields the form sends (new campaign, or edit). */
const SENT = ["siteUrl", "keyword", "durationDays", "day1Visits", "dailyIncreasePct", "concurrency", "minDwellSec", "maxDwellSec", "mobilePct"] as const;

export function NewCampaign({ editing }: { editing?: Campaign } = {}) {
  const router = useRouter();
  const [setup, setSetup] = useState<CtrSetup | null>(null);
  const [form, setForm] = useState(() => initialForm(editing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const computers = useComputers();
  // The computer that runs it: the one picked, else the one it runs on (editing), else this one (or
  // the first one on); null while loading.
  const [picked, setComputerId] = useState<string | null>(null);
  const computerId = picked ?? (computers ? (editing?.computerId ?? computers.me ?? computers.computers.find((c) => c.online)?.id ?? "") : null);
  const runsOn = computers && computerId ? computers.computers.find((c) => c.id === computerId) ?? null : null;
  const changes = editing ? formChanges(editing, form, computerId, runsOn?.name ?? null) : [];

  useEffect(() => {
    api<{ setup: CtrSetup }>("/api/ctr/campaigns").then(
      (d) => {
        setSetup(d.setup);
        // New campaign: concurrency starts at the max, one visit per proxy link saved in Settings (unless already changed).
        if (!editing) setForm((f) => (f.concurrency === String(DEFAULT_CONCURRENCY) ? { ...f, concurrency: String(Math.max(1, d.setup.proxyApis)) } : f));
      },
      () => {},
    );
  }, [editing]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const typical = expectedCtr(Number(form.targetPosition) || null);
  // Each visit at the same time uses its own proxy API link (Settings). None saved yet: 1. Editing: what it has stays allowed.
  const maxConcurrency = Math.max(1, setup?.proxyApis ?? 1, editing?.concurrency ?? 1);
  // Editing: today is day `minDays` of the campaign, so it can't be shorter.
  const minDays = editing ? Math.max(1, daysBetween(editing.startDate, todayInVietnam()) + 1) : 1;
  // Never above the max (or below 1): a bigger number typed or pasted becomes the max. Empty while typing.
  const setConcurrency = (e: { target: { value: string } }) => {
    const raw = e.target.value.trim();
    const n = Math.trunc(Number(raw));
    setForm((f) => ({ ...f, concurrency: raw === "" || !Number.isFinite(n) ? "" : String(Math.min(maxConcurrency, Math.max(1, n))) }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = Object.fromEntries(SENT.map((k) => [k, form[k]]));
      const res = editing
        ? await api<{ campaign: { id: number } }>(`/api/ctr/campaigns/${editing.id}`, { method: "PATCH", body: JSON.stringify({ edit: fields, computerId: computerId || undefined }) })
        : await api<{ campaign: { id: number } }>("/api/ctr/campaigns", { method: "POST", body: JSON.stringify({ ...fields, computerId: computerId || undefined }) });
      // The visit through the proxy has started on the server; the campaign page shows its console.
      router.push(`/ctr/campaigns/${res.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      {editing && <BackButton campaignId={editing.id} />}
      {editing ? (
        <PageHeader
          section="Edit campaign"
          title={`Edit: ${editing.keyword}`}
          intro={`Started ${editing.startDate}, ends ${editing.endDate}. Every change is kept in the campaign's history, with who made it.`}
        />
      ) : (
        <PageHeader section="New campaign" title="New campaign" intro="Pick a keyword to follow for one of our sites." />
      )}
      <SetupNotice setup={setup} />

      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="glass divide-y divide-line rounded-xl">
          <Section icon={<Globe className="size-4" />} title="Target" text="The site and the keyword to follow in Google Vietnam, and the PC that runs it.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Website URL">
                <input className={input} value={form.siteUrl} onChange={set("siteUrl")} placeholder="https://example.vn" required />
              </Field>
              <Field label="Keyword">
                <input className={input} value={form.keyword} onChange={set("keyword")} placeholder="thiết kế website" required />
              </Field>
              <Field label="Run on" icon={<Monitor className="size-3" aria-hidden />} hint={computerHint(computers, computerId, editing?.computerId)}>
                {computers && computerId != null ? (
                  <ComputerSelect
                    data={computers}
                    value={computerId}
                    onChange={setComputerId}
                    className={input}
                    placeholder={computers.me ? undefined : "The first PC that's on"}
                  />
                ) : (
                  <select className={input} disabled>
                    <option>Loading the computers…</option>
                  </select>
                )}
              </Field>
            </div>
          </Section>

          <Section icon={<TrendingUp className="size-4" />} title="Visit plan" text="Configure how visits compound over the campaign duration.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Duration (days)" hint={editing ? durationHint(editing, form.durationDays, minDays) : `1 – ${MAX_DURATION_DAYS}, checked daily`}>
                <input className={input} type="number" min={minDays} max={MAX_DURATION_DAYS} value={form.durationDays} onChange={set("durationDays")} required />
              </Field>
              <Field label="Day 1 Visits" hint={`1 – ${MAX_DAY1_VISITS} visits on the first day`}>
                <input className={input} type="number" min={1} max={MAX_DAY1_VISITS} value={form.day1Visits} onChange={set("day1Visits")} required />
              </Field>
              <Field label="Daily Increase %" hint="Added to the day before, compounded">
                <input className={input} type="number" min={0} max={MAX_DAILY_INCREASE_PCT} step={0.1} value={form.dailyIncreasePct} onChange={set("dailyIncreasePct")} required />
              </Field>
              <Field
                label="Concurrency"
                hint={`Max concurrency: ${maxConcurrency}`}
              >
                <span className="relative block">
                  <input className={`${input} pr-14`} type="number" inputMode="numeric" min={1} max={maxConcurrency} step={1} value={form.concurrency} onChange={setConcurrency} required />
                  <span className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 font-mono text-xs text-subtle">/ {maxConcurrency}</span>
                </span>
              </Field>
            </div>
            <EstimatedVisits plan={visitPlan(form)} />
          </Section>

          <Section icon={<Activity className="size-4" />} title="Behavior" text="CTR, phone share and time on page.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="CTR %" hint="0.1 – 100%">
                <input className={input} type="number" min={0.1} max={100} step={0.1} value={form.behaviorCtr} onChange={set("behaviorCtr")} />
              </Field>
              <Field label={`Mobile Traffic · ${form.mobilePct}%`} hint={`Desktop ${100 - Number(form.mobilePct)}%`}>
                <input className="h-9 w-full cursor-pointer accent-accent" type="range" min={0} max={100} step={5} value={form.mobilePct} onChange={set("mobilePct")} />
              </Field>
              <Field label="Min Dwell Time (s)" hint={`1 – ${MAX_DWELL_SEC}s on the site per visit`}>
                <input className={input} type="number" min={1} max={MAX_DWELL_SEC} step={1} value={form.minDwellSec} onChange={set("minDwellSec")} required />
              </Field>
              <Field label="Max Dwell Time (s)" hint={Number(form.maxDwellSec) < Number(form.minDwellSec) ? "Must be at least the min" : "Each visit: random, min to max"}>
                <input className={input} type="number" min={Number(form.minDwellSec) || 1} max={MAX_DWELL_SEC} step={1} value={form.maxDwellSec} onChange={set("maxDwellSec")} required />
              </Field>
            </div>
          </Section>

          {SHOW_LATER && (
            <>
              <Section icon={<CalendarRange className="size-4" />} title="Tracking" text="Where the real numbers come from." later>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Search Console property" hint='"sc-domain:example.vn" or "https://example.vn/"'>
                    <input className={input} value={form.gscProperty} onChange={set("gscProperty")} placeholder="sc-domain:example.vn" />
                  </Field>
                  <Field label="GA4 property ID (optional)" hint="Numbers only: GA4 → Admin → Property details">
                    <input className={input} value={form.ga4Property} onChange={set("ga4Property")} placeholder="123456789" inputMode="numeric" />
                  </Field>
                </div>
              </Section>

              <Section icon={<Crosshair className="size-4" />} title="Goals" text="What success looks like. Compared every day with the real numbers." later>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label="Target CTR %" hint={typical != null ? `Typical at position ${form.targetPosition}: ~${typical}%` : "1 – 100%"}>
                    <input className={input} type="number" min={0.1} max={100} step={0.1} value={form.targetCtr} onChange={set("targetCtr")} required />
                  </Field>
                  <Field label="Target position" hint="1 = top result">
                    <input className={input} type="number" min={1} max={100} value={form.targetPosition} onChange={set("targetPosition")} />
                  </Field>
                  <Field label="Weekly click growth %" hint="Real clicks, week over week">
                    <input className={input} type="number" min={0} max={1000} value={form.weeklyGrowthPct} onChange={set("weeklyGrowthPct")} />
                  </Field>
                  <Field label="Time on page (s)" hint="From Google Analytics, on the page that ranks">
                    <input className={input} type="number" min={1} max={3600} value={form.targetEngagementSec} onChange={set("targetEngagementSec")} />
                  </Field>
                </div>
              </Section>
            </>
          )}
        </div>

        <Summary
          form={form}
          busy={busy}
          error={error}
          runsOn={runsOn ? (runsOn.id === computers?.me ? "This PC" : runsOn.name) : computers && computerId === "" ? "First PC on" : null}
          remote={!!runsOn && runsOn.id !== computers?.me}
          changes={editing ? changes : null}
        />
      </form>
    </div>
  );
}

/** Editing, under Duration: the end date it gives, and the shortest it can be (today is that day). */
function durationHint(c: Campaign, value: string, minDays: number): string {
  const days = Number(value);
  if (!Number.isInteger(days) || days < minDays || days > MAX_DURATION_DAYS) return `${minDays} – ${MAX_DURATION_DAYS}: today is day ${minDays}`;
  const end = endDateOf(c.startDate, days);
  return days === c.durationDays ? `Ends ${end}` : `Ends ${end} (was ${c.endDate})`;
}

/** Editing: what the form changes, field by field (as the change history will show it). */
function formChanges(c: Campaign, form: Record<string, string>, computerId: string | null, computerName: string | null): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of SENT) {
    const from = c[k];
    const raw = form[k].trim();
    const to = typeof from === "number" ? (raw === "" ? NaN : Number(raw)) : raw.replace(/\/$/, "");
    if (typeof from === "number" ? to !== from : to !== String(from).replace(/\/$/, "")) out.push({ field: k, from, to: Number.isNaN(to) ? null : to });
  }
  if (computerId && computerId !== c.computerId) out.push({ field: "computer", from: c.computerName, to: computerName });
  return out;
}

/** Under "Run on": what happens with the computer picked. `current`: editing, the one it runs on now. */
function computerHint(computers: Computers | null, id: string | null, current?: string | null): string {
  if (!computers || id == null) return "";
  const pc = computers.computers.find((c) => c.id === id);
  if (!pc) return computers.computers.length ? "No PC picked: the first one with the app on takes it" : "No PC has the app on yet: the first one that does takes it";
  if (current !== undefined && pc.id === current) return "Runs there now: pick another to move it";
  if (pc.id === computers.me) return "This PC (the default): pick another to run it there";
  if (pc.online) return `${pc.name} is on: it starts there within a minute`;
  if (!pc.lastSeen) return `${pc.name} hasn't checked in (older app?): it starts there once its app is running`;
  return `${pc.name} is off (last on ${computerState(pc).replace("off · ", "")}): it starts when the app runs there again`;
}

/**
 * What will be tracked, kept in view with the Start button. Editing (`changes` not null): first what
 * the edit changes, and the button saves them.
 */
function Summary({
  form,
  busy,
  error,
  runsOn,
  remote,
  changes,
}: {
  form: Record<string, string>;
  busy: boolean;
  error: string | null;
  runsOn: string | null;
  remote: boolean;
  changes: FieldChange[] | null;
}) {
  const site = form.siteUrl.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const rows: [string, ReactNode][] = [
    ["Keyword", form.keyword.trim() || <span className="text-subtle">not set</span>],
    ["Site", site || <span className="text-subtle">not set</span>],
    ["Runs on", runsOn ?? <span className="text-subtle">…</span>],
    ...visitPlanRows(form),
  ];
  const editing = changes !== null;
  return (
    // Same height as the form beside it: details at the top, Start at the bottom.
    <aside className="glass flex flex-col rounded-xl p-4 sm:p-5">
      {editing && (
        <div className="mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <History className="size-4 text-accent-2" aria-hidden /> Changes
          </div>
          {changes.length ? (
            <ul className="mt-2 space-y-1 text-xs text-ink">
              {changes.map((ch) => (
                <li key={ch.field} className="rounded-md bg-accent/10 px-2 py-1 font-mono break-words">
                  {changeText(ch)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-subtle">Nothing changed yet.</p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Target className="size-4 text-accent-2" aria-hidden /> Summary
      </div>
      <dl className="mt-3 divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-2">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto pt-4">
        {error && (
          <Notice tone="error" className="mb-3">
            {error}
          </Notice>
        )}
        <button
          type="submit"
          disabled={busy || (editing && !changes.length)}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-accent text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:-translate-y-px disabled:opacity-70"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : editing ? <Save className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
          {editing ? (busy ? "Saving…" : "Save changes") : busy ? "Starting…" : "Start Campaign"}
        </button>
        <p className="mt-2 text-center text-[11px] text-subtle">
          {editing
            ? `Kept in the change history. ${remote ? `${runsOn} uses them within a minute.` : "Its visit starts again with them."}`
            : remote
              ? `The visit through the proxy starts on ${runsOn} within a minute.`
              : "The visit through the proxy starts right away."}
        </p>
      </div>
    </aside>
  );
}

/** The visit plan in the Summary: day 1, the last day and the estimated total. */
function visitPlanRows(form: Record<string, string>): [string, ReactNode][] {
  const plan = visitPlan(form);
  if (!plan) return [["Visits", <span key="v" className="text-subtle">check the visit plan</span>]];
  return [
    ["Duration", `${plan.days} day${plan.days === 1 ? "" : "s"}`],
    ["Concurrency", `${plan.concurrency} at a time`],
    ["Day 1 devices", `${mobileVisits(plan.day1, plan.mobilePct)} phone · ${plan.day1 - mobileVisits(plan.day1, plan.mobilePct)} desktop`],
    ["Dwell time", dwellRange(form)],
    ["Day 1", `${plan.day1.toLocaleString()} visits`],
    [`Day ${plan.days}`, `${plan.lastDay.toLocaleString()} visits`],
    ["Estimated total visits", <span key="t" className="font-semibold">{plan.total.toLocaleString()}</span>],
  ];
}

/** "30 – 120s" (or "60s" when min = max); a note while the fields are invalid. */
function dwellRange(form: Record<string, string>): ReactNode {
  const min = Number(form.minDwellSec);
  const max = Number(form.maxDwellSec);
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_DWELL_SEC;
  if (!ok(min) || !ok(max) || max < min) return <span className="text-subtle">check the dwell time</span>;
  return min === max ? `${min}s per visit` : `${min} – ${max}s per visit`;
}

/** The visit plan from the form, or null while a field is invalid. */
function visitPlan(form: Record<string, string>) {
  const days = Number(form.durationDays);
  const day1 = Number(form.day1Visits);
  const pct = form.dailyIncreasePct.trim() === "" ? NaN : Number(form.dailyIncreasePct);
  const concurrency = Number(form.concurrency);
  const valid = Number.isInteger(days) && days >= 1 && days <= MAX_DURATION_DAYS && Number.isInteger(day1) && day1 >= 1 && day1 <= MAX_DAY1_VISITS;
  if (!valid || !(pct >= 0 && pct <= MAX_DAILY_INCREASE_PCT) || !(Number.isInteger(concurrency) && concurrency >= 1)) return null;
  return { days, day1, concurrency, mobilePct: Number(form.mobilePct), lastDay: plannedVisits(day1, pct, days), total: plannedVisitsTotal(day1, pct, days) };
}

/** Under the Visit plan fields: the estimated total, from day 1 to the last day. */
function EstimatedVisits({ plan }: { plan: ReturnType<typeof visitPlan> }) {
  return (
    <p className="mt-3 rounded-lg bg-canvas/60 px-3 py-2 text-xs text-muted">
      {plan ? (
        <>
          Estimated total visits: <b className="font-mono text-sm text-ink">{plan.total.toLocaleString()}</b> over {plan.days} day{plan.days === 1 ? "" : "s"} ·{" "}
          {plan.day1.toLocaleString()} on day 1 → {plan.lastDay.toLocaleString()} on day {plan.days}
        </>
      ) : (
        "Fill in the visit plan to see the estimated total visits."
      )}
    </p>
  );
}

/** `later`: shown but switched off, and not sent with the form. */
function Section({ icon, title, text, later = false, children }: { icon: ReactNode; title: string; text: string; later?: boolean; children: ReactNode }) {
  return (
    <section className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-md bg-surface-2 text-accent-2 ring-1 ring-line">{icon}</span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {later && <span className="rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide text-subtle uppercase ring-1 ring-line-strong">Coming later</span>}
        <span className="hidden truncate text-xs text-subtle sm:inline">· {text}</span>
      </div>
      {later ? (
        <fieldset disabled className="opacity-50">
          {children}
        </fieldset>
      ) : (
        children
      )}
    </section>
  );
}

function Field({ label, icon, hint, className = "", children }: { label: string; icon?: ReactNode; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
        {icon}
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block truncate text-[11px] text-subtle" title={hint}>{hint}</span>}
    </label>
  );
}
