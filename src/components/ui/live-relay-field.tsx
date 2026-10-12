"use client";

// The live console relay's address, on the Settings page (saved for every computer), and the key to
// give the relay (its RELAY_SECRET). See relay/README.md.

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Radio } from "lucide-react";
import { buttonClass } from "@/components/ui/primitives";

interface Status {
  url: string | null;
  fromEnv: boolean;
  secret: string;
}

export function LiveRelayField() {
  const [status, setStatus] = useState<Status | null | undefined>(undefined);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/live-relay")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Status | null) => {
        setStatus(s);
        setValue(s?.url ?? "");
      })
      .catch(() => setStatus(null));
  }, []);

  if (status === undefined) return <div className="text-sm text-subtle">Loading…</div>;
  if (status === null) return <div className="text-sm text-subtle">Couldn&apos;t load the relay settings (is the database connected?).</div>;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/live-relay", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value }) });
      const j = (await r.json()) as { url?: string | null; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Couldn't save (${r.status}).`);
      setStatus((s) => (s ? { ...s, url: j.url ?? null } : s));
      setValue(j.url ?? "");
      setMessage({ ok: true, text: j.url ? "Saved: every computer uses it from its next minute check." : "Removed: live consoles of other PCs can't be watched." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Radio className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            className="h-10 w-full rounded-lg border border-line bg-surface-solid pr-3 pl-9 font-mono text-sm text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none disabled:opacity-60"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="wss://site-auditor-relay.onrender.com"
            aria-label="The relay's address"
            disabled={status.fromEnv}
          />
        </div>
        <button type="submit" className={buttonClass.primary} disabled={busy || status.fromEnv || value.trim() === (status.url ?? "")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
        </button>
      </form>
      {status.fromEnv && <p className="text-xs text-subtle">Set by LIVE_RELAY_URL on this computer.</p>}
      <div>
        <div className="mb-1 text-xs font-medium text-muted">The relay&apos;s RELAY_SECRET (add it to the relay&apos;s environment)</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">{status.secret}</code>
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() =>
              void navigator.clipboard.writeText(status.secret).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {message && <p className={`text-xs ${message.ok ? "text-status-good" : "text-status-critical"}`}>{message.text}</p>}
    </div>
  );
}
