"use client";

// CTR Tracker: the new-campaign form. Target (site, keyword), Tracking (duration, data sources),
// Goals (CTR, position, click growth, time on page). Everything after Target is measured or a goal.

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { MAX_DURATION_DAYS, expectedCtr, type CtrSetup } from "@/lib/campaigns/types";
import { Notice, buttonClass } from "@/components/ui/primitives";
import { PageHeader, SetupNotice, api } from "./ui";

const input =
  "h-10 w-full rounded-lg border border-line bg-canvas/60 px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function NewCampaign() {
  const router = useRouter();
  const [setup, setSetup] = useState<CtrSetup | null>(null);
  const [form, setForm] = useState({
    siteUrl: "",
    keyword: "",
    pageUrl: "",
    durationDays: "30",
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
      const res = await api<{ campaign: { id: number } }>("/api/ctr/campaigns", { method: "POST", body: JSON.stringify(form) });
      router.push(`/ctr/campaigns/${res.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader section="New campaign" title="New campaign" intro="Pick a keyword to follow for one of our sites, and set the goals. Results are measured from real visitors every day." />
      <SetupNotice setup={setup} />

      <form onSubmit={submit} className="space-y-4">
        <Card title="Target" text="The site and the keyword to follow in Google Vietnam.">
          <Field label="Website URL">
            <input className={input} value={form.siteUrl} onChange={set("siteUrl")} placeholder="https://example.vn" required />
          </Field>
          <Field label="Keyword">
            <input className={input} value={form.keyword} onChange={set("keyword")} placeholder="thiết kế website" required />
          </Field>
          <Field label="Page URL (optional)" hint="The page that should rank. Needed for time on page." wide>
            <input className={input} value={form.pageUrl} onChange={set("pageUrl")} placeholder="https://example.vn/thiet-ke-website" />
          </Field>
        </Card>

        <Card title="Tracking" text="How long to follow it, and where the real numbers come from.">
          <Field label="Duration (days)" hint={`1 – ${MAX_DURATION_DAYS} days, checked once a day`}>
            <input className={input} type="number" min={1} max={MAX_DURATION_DAYS} value={form.durationDays} onChange={set("durationDays")} required />
          </Field>
          <Field label="Search Console property" hint='e.g. "sc-domain:example.vn" or "https://example.vn/"'>
            <input className={input} value={form.gscProperty} onChange={set("gscProperty")} placeholder="sc-domain:example.vn" />
          </Field>
          <Field label="GA4 property ID (optional)" hint="Numbers only: GA4 → Admin → Property details">
            <input className={input} value={form.ga4Property} onChange={set("ga4Property")} placeholder="123456789" inputMode="numeric" />
          </Field>
        </Card>

        <Card title="Goals" text="What success looks like. Compared every day with the real numbers.">
          <Field label="Target CTR %" hint={typical != null ? `Typical at position ${form.targetPosition}: about ${typical}%` : "1 – 100%"}>
            <input className={input} type="number" min={0.1} max={100} step={0.1} value={form.targetCtr} onChange={set("targetCtr")} required />
          </Field>
          <Field label="Target position" hint="1 = top result">
            <input className={input} type="number" min={1} max={100} value={form.targetPosition} onChange={set("targetPosition")} />
          </Field>
          <Field label="Weekly click growth %" hint="Real clicks, week over week">
            <input className={input} type="number" min={0} max={1000} value={form.weeklyGrowthPct} onChange={set("weeklyGrowthPct")} />
          </Field>
          <Field label="Target time on page (s)" hint="From Google Analytics">
            <input className={input} type="number" min={1} max={3600} value={form.targetEngagementSec} onChange={set("targetEngagementSec")} />
          </Field>
        </Card>

        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" disabled={busy} className={`${buttonClass.primary} w-full justify-center`}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Saving and running the first check…" : "Start tracking"}
        </button>
      </form>
    </div>
  );
}

function Card({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section className="glass rounded-xl p-4 sm:p-5">
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-sm text-muted">{text}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}
