"use client";

// This computer's name, on the Settings page: shown on the campaign pages instead of the Windows
// computer name (e.g. "QA PC 2" instead of LAPTOP-5J9TO10G). Each computer saves its own.

import { useEffect, useState } from "react";
import { Check, Loader2, Monitor } from "lucide-react";
import { buttonClass } from "@/components/ui/primitives";

interface Status {
  name: string;
  hostname: string;
  named: boolean;
  suggestion: string;
  max: number;
}

export function ComputerNameField() {
  const [status, setStatus] = useState<Status | null | undefined>(undefined);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/computer")
      .then((r) => r.json())
      .then((s: Status | null) => {
        setStatus(s);
        if (s?.named) setValue(s.name);
      })
      .catch(() => setStatus(null));
  }, []);

  if (status === undefined) return <div className="text-sm text-subtle">Loading…</div>;
  if (status === null) return <div className="text-sm text-subtle">Only the app on a computer has a computer name.</div>;

  async function save(name: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/computer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const j = (await r.json()) as Partial<Status> & { error?: string; synced?: boolean };
      if (!r.ok) throw new Error(j.error ?? `Couldn't save (${r.status}).`);
      setStatus((s) => (s ? { ...s, name: j.name!, named: !!j.named } : s));
      setValue(j.named ? j.name! : "");
      setMessage({
        ok: true,
        text: j.synced === false ? `Saved as “${j.name}”. Its campaigns show it once the database can be reached.` : `Saved: this computer is now “${j.name}” everywhere.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Monitor className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            className="h-10 w-full rounded-lg border border-line bg-surface-solid pr-3 pl-9 text-sm text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
            value={value}
            maxLength={status.max}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`e.g. ${status.suggestion}`}
            aria-label="This computer's name"
          />
        </div>
        <button type="submit" className={buttonClass.primary} disabled={busy || value.trim() === (status.named ? status.name : "")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
        </button>
        {status.named && (
          <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => void save("")} title="Show the Windows computer name again">
            Use the Windows name
          </button>
        )}
      </form>
      <p className="text-xs text-subtle">
        Shown now: <b className="font-mono text-ink">{status.name}</b>
        {status.named && (
          <>
            {" "}
            · Windows name <span className="font-mono">{status.hostname}</span>
          </>
        )}
      </p>
      {message && <p className={`text-xs ${message.ok ? "text-status-good" : "text-status-critical"}`}>{message.text}</p>}
    </div>
  );
}
