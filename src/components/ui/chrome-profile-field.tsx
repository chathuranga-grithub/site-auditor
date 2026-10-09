"use client";

// The Chrome profile: the picker on the Settings page. Lists this computer's Chrome profiles by name;
// Save stores it for the app (behind the scenes, a copy in the app's own folder: Chrome won't let the
// app use it in place), and Save (on the saved one) saves it again after the profile was changed in Chrome. Open opens the
// saved one in Chrome to sign in (sign-ins don't carry over from Chrome's own profile) or add extensions.
// None = fresh profiles. Each computer saves its own (src/lib/local-settings.ts). The words on screen are
// "save", "update" and "open" only.

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Trash2, UserRound } from "lucide-react";

interface Status {
  profiles: { name: string; folder: string; account: { name: string | null; email: string } | null }[];
  selected: string | null;
  dir: string | null;
  source: "saved" | "env" | null;
  copiedAt: string | null;
  open: boolean;
}

const EMPTY: Status = { profiles: [], selected: null, dir: null, source: null, copiedAt: null, open: false };

export function ChromeProfileField() {
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/browser-settings")
        .then((r) => r.json())
        .then((j: Status) => {
          setStatus({ ...EMPTY, ...j });
          setChoice((c) => (c && c !== j.selected ? c : (j.selected ?? "")));
        })
        .catch(() => setStatus((s) => s ?? EMPTY));
    void load();
    // Back from the Chrome window opened with Open: show whether it's still open.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
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
            className="h-8 w-full min-w-40 rounded-md border border-transparent bg-transparent px-1 text-sm text-ink outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 [&_option]:bg-surface-solid [&_option]:text-ink"
          >
            <option value="">None: a fresh profile each time</option>
            {profiles.map((p) => (
              <option key={p.folder} value={p.name}>
                {/* Signed-in profiles: the account too, as Chrome's menu shows it. */}
                {!p.account ? p.name : p.name === p.account.name || p.name === p.account.email ? `${p.name} (${p.account.email})` : `${p.name} — ${p.account.name ?? p.account.email}`}
              </option>
            ))}
          </select>
        </label>
        {busy && <Loader2 className="size-4 animate-spin text-accent-2" aria-label="Saving" />}
        {changed && (
          <button
            type="button"
            onClick={() => (choice ? call("POST", { name: choice }) : call("DELETE"))}
            disabled={busy}
            className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line-strong hover:bg-surface disabled:opacity-40"
          >
            Save
          </button>
        )}
        {!changed && status?.selected && (
          <>
            {status.dir && (
              <button type="button" onClick={() => call("POST", { open: true })} disabled={busy || status.open} className={button} title="Open it in Chrome to sign in to sites or add extensions (extensions saved from Chrome then need adding again there)">
                <ExternalLink className="size-3" /> Open
              </button>
            )}
            <button type="button" onClick={() => call("POST", { name: status.selected, update: true })} disabled={busy || status.open} className={button} title="Save it again from Chrome (replaces extensions and sign-ins added with Open)">
              <RefreshCw className="size-3" /> Save
            </button>
            <button type="button" onClick={() => call("DELETE")} disabled={busy} aria-label="Stop using a Chrome profile" title="Back to fresh profiles" className={`${button} hover:text-status-critical`}>
              <Trash2 className="size-3" />
            </button>
          </>
        )}
      </div>
      <div className="text-xs text-subtle">
        {status?.selected && status.dir && status.open ? (
          <>
            Open in Chrome: sign in or add extensions, then close that Chrome window. Visits and ranking checks pick it up after.
          </>
        ) : status?.selected && status.dir ? (
          <>
            <span title={status.dir}>
              This computer uses <b className="text-muted">{status.selected}</b>
              {status.copiedAt ? ` (saved ${new Date(status.copiedAt).toLocaleString()})` : ""}. Click{" "}
              <b className="text-muted">Open</b> to sign in to sites.
            </span>
          </>
        ) : status?.selected ? (
          <>
            <b className="text-muted">{status.selected}</b> was saved on this computer, but its copy is gone, so no profile is used here (a fresh one each time). Click{" "}
            <b className="text-muted">Save</b> to save it here.
          </>
        ) : status?.source === "env" && status.dir ? (
          <>
            From CHROME_PROFILE_DIR in .env.local: <span className="font-mono break-all">{status.dir}</span>
          </>
        ) : status && !profiles.length ? (
          "No Chrome profiles found on this computer."
        ) : (
          "Pick one of this computer's Chrome profiles and save. Quit Chrome first."
        )}
      </div>
      {error && <div className="text-xs text-status-critical">{error}</div>}
    </div>
  );
}
