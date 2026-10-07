"use client";

// Auto CTR: the new-campaign form. Target (site, keyword) is all a campaign uses for now.
// Tracking (duration, data sources) and Goals (CTR, position, click growth, time on page) are kept
// for later but hidden (SHOW_LATER); they aren't sent, so the server uses its defaults.
// Laid out to fit one screen: the sections are rows of fields on the left, and a summary of what
// will be tracked, with the Start button, stays on the right.

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarRange, Crosshair, Globe, Loader2, Play, Target } from "lucide-react";
import { DEFAULT_DURATION_DAYS, MAX_DURATION_DAYS, expectedCtr, type CtrSetup } from "@/lib/campaigns/types";
import { Notice } from "@/components/ui/primitives";
import { PageHeader, SetupNotice, api } from "./ui";

/** Tracking and Goals: hidden until campaigns use them again. */
const SHOW_LATER = false;

const input =
  "h-9 w-full rounded-lg border border-line bg-canvas/60 px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function NewCampaign() {
  const router = useRouter();
  const [setup, setSetup] = useState<CtrSetup | null>(null);
  const [form, setForm] = useState({
    siteUrl: "",
    keyword: "",
    durationDays: String(DEFAULT_DURATION_DAYS),
    gscProperty: "",
    ga4Property: "",
    targetCtr: "5",
    targetPosition: "3",
    weeklyGrowthPct: "10",
    targetEngagementSec: "60",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ setup: CtrSetup }>("/api/ctr/campaigns").then((d) => setSetup(d.setup), () => {});
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const typical = expectedCtr(Number(form.targetPosition) || null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ campaign: { id: number } }>("/api/ctr/campaigns", { method: "POST", body: JSON.stringify({ siteUrl: form.siteUrl, keyword: form.keyword }) });
      router.push(`/ctr/campaigns/${res.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader section="New campaign" title="New campaign" intro="Pick a keyword to follow for one of our sites." />
      <SetupNotice setup={setup} />

      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="glass divide-y divide-line rounded-xl">
          <Section icon={<Globe className="size-4" />} title="Target" text="The site and the keyword to follow in Google Vietnam.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Website URL">
                <input className={input} value={form.siteUrl} onChange={set("siteUrl")} placeholder="https://example.vn" required />
              </Field>
              <Field label="Keyword">
                <input className={input} value={form.keyword} onChange={set("keyword")} placeholder="thiết kế website" required />
              </Field>
            </div>
          </Section>

          {SHOW_LATER && (
            <>
              <Section icon={<CalendarRange className="size-4" />} title="Tracking" text="How long to follow it, and where the real numbers come from." later>
                <div className="grid gap-3 md:grid-cols-[8rem_1fr_1fr]">
                  <Field label="Duration (days)" hint={`1 – ${MAX_DURATION_DAYS}, checked daily`}>
                    <input className={input} type="number" min={1} max={MAX_DURATION_DAYS} value={form.durationDays} onChange={set("durationDays")} required />
                  </Field>
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

        <Summary form={form} busy={busy} error={error} />
      </form>
    </div>
  );
}

/** What will be tracked, kept in view with the Start button. */
function Summary({ form, busy, error }: { form: Record<string, string>; busy: boolean; error: string | null }) {
  const site = form.siteUrl.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const rows: [string, ReactNode][] = [
    ["Keyword", form.keyword.trim() || <span className="text-subtle">not set</span>],
    ["Site", site || <span className="text-subtle">not set</span>],
  ];
  return (
    // Same height as the form beside it: details at the top, Start at the bottom.
    <aside className="glass flex flex-col rounded-xl p-4 sm:p-5">
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
          disabled={busy}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-accent text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:-translate-y-px disabled:opacity-70"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5 fill-current" />}
          {busy ? "Starting…" : "Start tracking"}
        </button>
        <p className="mt-2 text-center text-[11px] text-subtle">The first check runs right away, then every day at 08:00.</p>
      </div>
    </aside>
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

function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block truncate text-[11px] text-subtle" title={hint}>{hint}</span>}
    </label>
  );
}
