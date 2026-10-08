"use client";

// The Chrome profile: the picker on the Settings page. Lists this computer's Chrome profiles by name;
// picking one copies it into the app's own folder (Chrome won't let the app use it in place), and
// "Copy again" refreshes that copy after the profile was changed in Chrome. None = fresh profiles.

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2, UserRound } from "lucide-react";

interface Status {
  profiles: { name: string; folder: string }[];
  selected: string | null;
  dir: string | null;
  source: "saved" | "env" | null;
  copiedAt: string | null;
}

const EMPTY: Status = { profiles: [], selected: null, dir: null, source: null, copiedAt: null };

export function ChromeProfileField() {
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/browser-settings")
      .then((r) => r.json())
      .then((j: Status) => {
        setStatus({ ...EMPTY, ...j });
        setChoice(j.selected ?? "");
      })
      .catch(() => setStatus(EMPTY));
  }, []);

  async function call(method: "POST" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/browser-settings", {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await res.json()) as Status & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `Couldn't save (${res.status})`);
      setStatus({ ...EMPTY, ...j });
      setChoice(j.selected ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const button = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50";
  const changed = choice !== (status?.selected ?? "");
  const profiles = status?.profiles ?? [];

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-1 rounded-lg bg-canvas/60 py-1 pr-1 pl-3">
        <UserRound className="size-4 shrink-0 text-subtle" aria-hidden />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Chrome profile</span>
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={busy || !profiles.length}
            className="h-8 w-full min-w-40 rounded-md border border-transparent bg-transparent px-1 text-sm text-ink outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
          >
            <option value="">None: a fresh profile each time</option>
            {profiles.map((p) => (
              <option key={p.folder} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {busy && <Loader2 className="size-4 animate-spin text-accent-2" aria-label="Copying" />}
        {changed && (
          <button
            type="button"
            onClick={() => (choice ? call("POST", { name: choice }) : call("DELETE"))}
            disabled={busy}
            className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line-strong hover:bg-surface disabled:opacity-40"
          >
            {choice ? "Use this profile" : "Save"}
          </button>
        )}
        {!changed && status?.selected && (
          <>
            <button type="button" onClick={() => call("POST", { name: status.selected })} disabled={busy} className={button} title="Copy the profile from Chrome again (after changing it there)">
              <RefreshCw className="size-3" /> Copy again
            </button>
            <button type="button" onClick={() => call("DELETE")} disabled={busy} aria-label="Stop using a Chrome profile" title="Back to fresh profiles" className={`${button} hover:text-status-critical`}>
              <Trash2 className="size-3" />
            </button>
          </>
        )}
      </div>
      <div className="text-xs text-subtle">
        {status?.selected && status.dir ? (
          <>
            Using a copy of <b className="text-muted">{status.selected}</b>
            {status.copiedAt ? `, copied ${new Date(status.copiedAt).toLocaleString()}` : ""}: <span className="font-mono break-all">{status.dir}</span>
          </>
        ) : status?.selected ? (
          <>
            <b className="text-muted">{status.selected}</b> isn&apos;t copied on this computer, so no profile is used here (a fresh one each time). Use{" "}
            <b className="text-muted">Copy again</b> to copy it here.
          </>
        ) : status?.source === "env" && status.dir ? (
          <>
            From CHROME_PROFILE_DIR in .env.local: <span className="font-mono break-all">{status.dir}</span>
          </>
        ) : status && !profiles.length ? (
          "No Chrome profiles found on this computer."
        ) : (
          "Pick one of this computer's Chrome profiles. Quit Chrome first, so everything copies."
        )}
      </div>
      {error && <div className="text-xs text-status-critical">{error}</div>}
    </div>
  );
}
