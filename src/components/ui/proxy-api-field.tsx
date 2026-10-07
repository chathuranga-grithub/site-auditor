"use client";

// The proxy API link: the editable field on the Settings page.
// Paste the link once and it's saved encrypted in the database and locked ("Proxy API saved · host…a1b2");
// Change replaces it, Remove deletes it. The full link never comes back to the browser.

import { useEffect, useState } from "react";
import { KeyRound, Lock, Pencil, Trash2 } from "lucide-react";

interface Status {
  saved: boolean;
  source: "saved" | "env" | null;
  hint: string | null;
  /** Saved, but can't be decrypted (AUTH_SECRET changed): save it again. */
  unreadable?: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

const EMPTY: Status = { saved: false, source: null, hint: null };

export function ProxyApiField({ disabled = false }: { disabled?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/proxy-settings")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(EMPTY));
  }, []);

  async function call(method: "POST" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy-settings", {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await res.json()) as Status & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `Couldn't save (${res.status})`);
      setStatus(j);
      setEditing(false);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const locked = !!status?.saved && !editing;
  const save = () => value.trim() && call("POST", { proxyApiUrl: value });

  if (locked) {
    return (
      <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg bg-canvas/60 pr-1 pl-3.5 text-sm">
        <Lock className="size-4 shrink-0 text-status-good" aria-hidden />
        <span className="min-w-0 truncate font-mono text-xs text-ink" title={status?.source === "env" ? "From PROXY_API_URL in .env.local" : `Saved encrypted in the database${status?.updatedBy ? ` by ${status.updatedBy}` : ""}`}>
          Proxy API saved · {status?.hint}
        </span>
        <span className="ml-auto flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={disabled || busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <Pencil className="size-3" /> Change
          </button>
          {status?.source === "saved" && (
            <button
              type="button"
              onClick={() => call("DELETE")}
              disabled={disabled || busy}
              aria-label="Remove the saved proxy API link"
              title="Remove the saved link"
              className="inline-flex items-center rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-status-critical disabled:opacity-50"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex h-10 min-w-0 items-center gap-1 rounded-lg bg-canvas/60 pr-1">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Proxy API link</span>
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            disabled={disabled || busy}
            placeholder="Paste the proxy API link"
            title="The link that returns {status, data: {proxy: 'ip:port'}}. Saved encrypted in the database."
            className="h-10 w-full rounded-lg border border-transparent bg-transparent pr-2 pl-10 font-mono text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={disabled || busy || !value.trim()}
          className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line-strong hover:bg-surface disabled:opacity-40"
        >
          Save
        </button>
        {status?.saved && (
          <button type="button" onClick={() => setEditing(false)} disabled={busy} className="rounded-md px-2 py-1 text-xs text-muted hover:text-ink">
            Cancel
          </button>
        )}
      </div>
      {status?.unreadable && !error && <div className="mt-1 text-xs text-status-warning">A link is saved but can&apos;t be read (the app&apos;s secret key changed). Paste it again.</div>}
      {error && <div className="mt-1 text-xs text-status-critical">{error}</div>}
    </div>
  );
}
