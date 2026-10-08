"use client";

// The proxy API links: the editable list on the Settings page. Paste one link or many (one per line)
// and they're saved encrypted in the database and shown locked ("#1 host…a1b2"). Add links appends to
// the list, Replace all swaps it, the bin removes one link. The full links never come back to the browser.

import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";

interface Status {
  saved: boolean;
  source: "saved" | "env" | null;
  hints: string[];
  /** Saved, but can't be decrypted (AUTH_SECRET changed): save them again. */
  unreadable?: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

const EMPTY: Status = { saved: false, source: null, hints: [] };

/** Links in the pasted text, the way the server splits them (src/lib/proxy-settings.ts). */
const countLinks = (text: string) => new Set(text.split(/[\s,]+/).filter(Boolean)).size;

export function ProxyApiField({ disabled = false }: { disabled?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  /** Pasting links: added to the list, or replacing it. */
  const [mode, setMode] = useState<"add" | "replace" | null>(null);
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/proxy-settings")
      .then((r) => r.json())
      .then((j: Status) => setStatus({ ...EMPTY, ...j }))
      .catch(() => setStatus(EMPTY));
  }, []);

  async function call(method: "POST" | "DELETE", { body, index }: { body?: object; index?: number } = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy-settings${index !== undefined ? `?index=${index}` : ""}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await res.json()) as Status & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `Couldn't save (${res.status})`);
      setStatus(j);
      setMode(null);
      setValue("");
      setShown(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hints = status?.hints ?? [];
  const editing = mode ?? (status && !status.saved ? "replace" : null);
  const pasted = countLinks(value);
  const save = () => pasted > 0 && call("POST", { body: { proxyApiUrls: value, mode: editing } });
  const fromEnv = status?.source === "env";
  const button = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50";

  return (
    <div className="min-w-0 space-y-2">
      {status?.saved && (
        <div className="overflow-hidden rounded-lg bg-canvas/60">
          <div className="flex items-center gap-2 px-3.5 py-2 text-xs text-muted">
            <Lock className="size-3.5 shrink-0 text-status-good" aria-hidden />
            <span className="min-w-0 truncate">
              {hints.length} proxy API link{hints.length === 1 ? "" : "s"} {fromEnv ? "from PROXY_API_URL in .env.local" : "saved, encrypted"}
              {!fromEnv && status.updatedBy ? ` · by ${status.updatedBy}` : ""}
            </span>
            {!editing && (
              <span className="ml-auto flex shrink-0 gap-0.5">
                <button type="button" onClick={() => setMode("add")} disabled={disabled || busy} className={button}>
                  <Plus className="size-3" /> Add links
                </button>
                <button type="button" onClick={() => setMode("replace")} disabled={disabled || busy} className={button}>
                  <RefreshCw className="size-3" /> Replace all
                </button>
              </span>
            )}
          </div>
          <ol className="divide-y divide-line border-t border-line">
            {hints.map((h, i) => (
              <li key={`${i}-${h}`} className="flex h-9 min-w-0 items-center gap-2 pr-1 pl-3.5">
                <span className="w-6 shrink-0 font-mono text-[11px] text-subtle">#{i + 1}</span>
                <span className="min-w-0 truncate font-mono text-xs text-ink">{h}</span>
                {!fromEnv && (
                  <button
                    type="button"
                    onClick={() => call("DELETE", { index: i })}
                    disabled={disabled || busy}
                    aria-label={`Remove proxy API link ${i + 1}`}
                    title="Remove this link"
                    className="ml-auto inline-flex items-center rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-status-critical disabled:opacity-50"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {editing && (
        <div className="space-y-1.5">
          <label className="block">
            <span className="sr-only">Proxy API links, one per line</span>
            <textarea
              autoComplete="off"
              spellCheck={false}
              rows={Math.min(10, Math.max(3, value.split("\n").length))}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={disabled || busy}
              placeholder={editing === "add" ? "Paste more proxy API links, one per line" : "Paste one proxy API link, or several (one per line)"}
              title="Each link returns {status, data: {proxy: 'ip:port'}}. Saved encrypted in the database."
              className={`w-full resize-y rounded-lg border border-transparent bg-canvas/60 px-3.5 py-2.5 font-mono text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm ${shown ? "" : "[-webkit-text-security:disc]"}`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-auto text-xs text-subtle">
              {pasted ? `${pasted} link${pasted === 1 ? "" : "s"}` : "No links yet"}
              {editing === "replace" && status?.saved && !fromEnv ? " · replaces the saved list" : ""}
            </span>
            <button type="button" onClick={() => setShown((s) => !s)} disabled={!value} className={button}>
              {shown ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {shown ? "Hide" : "Show"}
            </button>
            {status?.saved && (
              <button type="button" onClick={() => (setMode(null), setValue(""), setError(null))} disabled={busy} className={button}>
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={disabled || busy || !pasted}
              className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line-strong hover:bg-surface disabled:opacity-40"
            >
              {editing === "add" ? "Add" : "Save"}
            </button>
          </div>
        </div>
      )}

      {!fromEnv && status?.saved && hints.length > 1 && !editing && (
        <button type="button" onClick={() => call("DELETE")} disabled={disabled || busy} className={`${button} hover:text-status-critical`}>
          <Trash2 className="size-3" /> Remove all
        </button>
      )}
      {status?.unreadable && !error && <div className="text-xs text-status-warning">Links are saved but can&apos;t be read (the app&apos;s secret key changed). Paste them again.</div>}
      {error && <div className="text-xs text-status-critical">{error}</div>}
    </div>
  );
}
