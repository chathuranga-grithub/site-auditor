"use client";

// Realtime updates for this computer, on the Settings page: whether it shares what its campaigns are
// doing (their latest console lines and recent visits) with pages open on other computers or at home,
// in the "I'm on" it writes every minute (src/lib/campaigns/live-snapshot.ts). Off unless turned on:
// each computer has its own, so only the ones you want to follow add to the database's traffic.

import { useEffect, useState } from "react";
import { Loader2, Radio } from "lucide-react";

export function RealtimeUpdatesField() {
  const [on, setOn] = useState<boolean | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/computer")
      .then((r) => r.json())
      .then((s: { realtime?: boolean } | null) => setOn(s ? !!s.realtime : null))
      .catch(() => setOn(null));
  }, []);

  if (on === undefined) return <div className="text-sm text-subtle">Loading…</div>;
  if (on === null) return null; // the website: no computer

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/computer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ realtime: !on }) });
      const j = (await r.json()) as { realtime?: boolean; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Couldn't save (${r.status}).`);
      setOn(!!j.realtime);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-xl">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Radio className="size-4 text-accent-2" aria-hidden /> Realtime updates
        </div>
        <p className="mt-1 text-xs text-muted">
          Lets you follow this PC&apos;s campaigns from another computer or from home: their console and realtime panel, updated every
          minute. It goes in the &ldquo;I&apos;m on&rdquo; this PC already saves each minute (no extra writes, a few KB, replaced each time).
          Off: nothing extra is saved, and pages elsewhere only show the daily numbers.
        </p>
        {error && <p className="mt-1 text-xs text-status-critical">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Realtime updates"
        disabled={busy}
        onClick={() => void toggle()}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60 ${on ? "bg-accent" : "bg-surface-2 ring-1 ring-line-strong"}`}
      >
        <span className={`inline-block size-5 rounded-full bg-white shadow transition ${on ? "translate-x-5.5" : "translate-x-0.5"}`} />
        {busy && <Loader2 className="absolute -right-6 size-4 animate-spin text-subtle" aria-hidden />}
      </button>
    </div>
  );
}
