"use client";

// Proxy Check (local only): tests the rotating residential proxy service over a time period.
// Each time the provider gives a new IP, it checks where it really is (Vietnam?), the network
// (residential or datacenter), whether it connects, and how fast it is. It never visits our sites.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Play, Square, Timer } from "lucide-react";
import { CHECK_MINUTES, type CheckMinutes, type ProxyCheckResult } from "@/lib/proxy-check-types";
import { Notice, Panel, StatTile, buttonClass } from "@/components/ui/primitives";

/** Retry after an error (seconds). */
const ERROR_RETRY = 30;

export function ProxyCheck() {
  const [proxyApi, setProxyApi] = useState("");
  const [minutes, setMinutes] = useState<CheckMinutes>(30);
  const [env, setEnv] = useState<{ local: boolean; savedProxyApi: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<ProxyCheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState(0);
  const [nextAt, setNextAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/proxy-check")
      .then((r) => r.json())
      .then(setEnv)
      .catch(() => setEnv({ local: true, savedProxyApi: false }));
  }, []);

  // Clock for "time left" and "next IP in".
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const end = Date.now() + minutes * 60_000;
    setResults([]);
    setError(null);
    setEndsAt(end);
    setNow(Date.now());
    setRunning(true);

    try {
      while (!controller.signal.aborted && Date.now() < end) {
        setChecking(true);
        const res = await fetch("/api/proxy-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proxyApiUrl: proxyApi }),
          signal: controller.signal,
        });
        setChecking(false);
        const r = (await res.json()) as ProxyCheckResult & { error?: string };
        if (!res.ok) throw new Error(r.error ?? `Request failed (${res.status})`);
        setResults((list) => [...list, r]);

        // Follow the provider's rotation: wait until it says the next IP is ready.
        const waitSec = r.kind === "wait" ? (r.waitSec ?? 60) + 2 : r.kind === "ip" ? (r.nextChangeSec ?? 180) + 3 : ERROR_RETRY;
        const next = Math.min(Date.now() + waitSec * 1000, end);
        setNextAt(next);
        await sleep(next - Date.now(), controller.signal);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
      setRunning(false);
      setNextAt(0);
      abortRef.current = null;
    }
  }

  const notLocal = env && !env.local;
  const left = running ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const nextIn = running && !checking && nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header>
        <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools / Proxy Check</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Proxy <span className="text-gradient">Check</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Tests the rotating residential proxy over a time period: each new IP&apos;s location, network, connection and speed. It doesn&apos;t visit our sites.
        </p>
      </header>

      {notLocal && <Notice tone="warning">Proxy Check only works when the app runs on a computer (<code>npm run dev</code>), not on the live site.</Notice>}

      <form onSubmit={handleStart} className="glass grid gap-2 rounded-xl p-2 lg:grid-cols-[1fr_auto_auto]">
        <label className="relative block">
          <span className="sr-only">Proxy API link</span>
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="password"
            autoComplete="off"
            value={proxyApi}
            onChange={(e) => setProxyApi(e.target.value)}
            disabled={running}
            required={!env?.savedProxyApi}
            placeholder={env?.savedProxyApi ? "Proxy API: using the saved link" : "Proxy API link"}
            className="h-10 w-full rounded-lg border border-transparent bg-canvas/60 pr-3 pl-10 font-mono text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
          />
        </label>
        <div className="flex h-10 rounded-lg bg-canvas/60 p-1" role="radiogroup" aria-label="Test length">
          {CHECK_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={minutes === m}
              onClick={() => setMinutes(m)}
              disabled={running}
              className={`flex-1 rounded-md px-3 text-xs font-medium whitespace-nowrap transition ${minutes === m ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink"}`}
            >
              {m === 60 ? "1 hour" : `${m} min`}
            </button>
          ))}
        </div>
        {running ? (
          // Separate keys: otherwise React reuses one <button>, and the click that stops the run
          // lands on the "start" (submit) button it turns into, starting a new run.
          <button key="stop" type="button" onClick={() => abortRef.current?.abort()} className={buttonClass.danger}>
            <Square className="size-3.5 fill-current" />
            Stop
          </button>
        ) : (
          <button key="start" type="submit" disabled={!!notLocal} className={buttonClass.primary}>
            <Play className="size-3.5 fill-current" />
            Start check
          </button>
        )}
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      {(running || results.length > 0) && (
        <>
          <Summary results={results} />
          <Panel
            title={`Checks · ${results.length}`}
            actions={
              <span className="inline-flex items-center gap-3 font-mono text-xs text-muted">
                {running && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Timer className="size-3.5" />
                      {checking ? "checking…" : `next IP in ${clock(nextIn)}`}
                    </span>
                    <span>{clock(left)} left</span>
                  </>
                )}
                {!running && results.length > 0 && <CopySummary results={results} />}
              </span>
            }
            bodyClassName=""
          >
            <ResultsTable results={results} />
          </Panel>
        </>
      )}
    </div>
  );
}

function Summary({ results }: { results: ProxyCheckResult[] }) {
  const s = summarize(results);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatTile label="IPs received" value={s.ips} detail={`${s.unique} unique · ${s.repeats} repeat${s.repeats === 1 ? "" : "s"}`} severity={s.ips ? (s.repeats ? "warning" : "good") : undefined} />
      <StatTile label="In Vietnam" value={s.working ? `${s.vn}/${s.working}` : "—"} detail="working IPs" severity={s.working ? (s.vn === s.working ? "good" : "serious") : undefined} />
      <StatTile label="Residential" value={s.working ? `${s.residential}/${s.working}` : "—"} detail={s.datacenter ? `${s.datacenter} datacenter` : "home / mobile ISPs"} severity={s.working ? (s.datacenter ? "warning" : "good") : undefined} />
      <StatTile label="Speed" value={s.avgPing != null ? ms(s.avgPing) : "—"} detail={s.maxPing != null ? `slowest ${ms(s.maxPing)}` : "average round trip"} />
      <StatTile label="Failures" value={s.failures} detail={`${s.waits} wait message${s.waits === 1 ? "" : "s"}`} severity={results.length ? (s.failures ? "serious" : "good") : undefined} />
      <StatTile label="Rotation" value={s.rotationMin != null ? `${s.rotationMin.toFixed(1)} min` : "—"} detail="average time per new IP" />
    </div>
  );
}

function ResultsTable({ results }: { results: ProxyCheckResult[] }) {
  if (!results.length) return <div className="px-4 py-10 text-center text-sm text-muted">Getting the first proxy…</div>;
  const seen = new Set<string>();
  const rows = results.map((r) => {
    const repeat = !!r.ip && seen.has(r.ip);
    if (r.ip) seen.add(r.ip);
    return { r, repeat };
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left font-mono text-xs">
        <thead className="border-b border-line text-[10px] tracking-[0.12em] text-subtle uppercase">
          <tr>
            {["#", "Time", "Result", "Exit IP", "Location", "Network / ISP", "Speed", "Proxy", "Notes"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows
            .map(({ r, repeat }, i) => (
              <tr key={i} className="align-top hover:bg-white/5">
                <td className="px-3 py-2 text-subtle tabular-nums">{i + 1}</td>
                <td className="px-3 py-2 text-muted tabular-nums">{new Date(r.at).toLocaleTimeString("en-GB", { hour12: false })}</td>
                <td className="px-3 py-2">
                  {r.kind === "wait" ? (
                    <span className="text-muted">wait {r.waitSec}s</span>
                  ) : r.kind === "error" || !r.connected ? (
                    <span className="text-status-critical">✕ failed</span>
                  ) : (
                    <span className="text-status-good">✓ new IP</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink">{r.ip ?? "–"}</td>
                <td className={`px-3 py-2 ${r.countryCode && r.countryCode !== "VN" ? "text-status-critical" : "text-muted"}`}>
                  {r.country ? `${r.country}${r.city ? `, ${r.city}` : ""}` : "–"}
                </td>
                <td className="px-3 py-2">
                  {r.network && <span className={r.network === "residential" ? "text-status-good" : r.network === "datacenter" ? "text-status-warning" : "text-subtle"}>{r.network}</span>}
                  {r.org && <span className="block text-subtle">{r.org}</span>}
                </td>
                <td className={`px-3 py-2 tabular-nums ${(r.pingMs ?? 0) > 3000 ? "text-status-warning" : "text-muted"}`}>
                  {r.pingMs != null ? ms(r.pingMs) : "–"}
                  {r.lookupMs != null && <span className="block text-subtle">lookup {ms(r.lookupMs)}</span>}
                </td>
                <td className="px-3 py-2 text-subtle">{r.address ?? "–"}</td>
                <td className="px-3 py-2">
                  {repeat && <span className="block text-status-warning">repeat IP</span>}
                  {r.error && <span className="block text-status-critical">{r.error}</span>}
                </td>
              </tr>
            ))
            .reverse()}
        </tbody>
      </table>
    </div>
  );
}

function summarize(results: ProxyCheckResult[]) {
  const ipRows = results.filter((r) => r.kind === "ip");
  const withIp = ipRows.filter((r) => r.ip);
  const unique = new Set(withIp.map((r) => r.ip)).size;
  const working = ipRows.filter((r) => r.connected);
  const pings = working.map((r) => r.pingMs).filter((v): v is number => v != null);
  // Average time between checks that brought a different IP than the one before.
  const changes: number[] = [];
  let prev: ProxyCheckResult | null = null;
  for (const r of withIp) {
    if (prev && prev.ip !== r.ip) changes.push(Date.parse(r.at) - Date.parse(prev.at));
    prev = r;
  }
  return {
    ips: withIp.length,
    unique,
    repeats: withIp.length - unique,
    working: working.length,
    vn: working.filter((r) => r.countryCode === "VN").length,
    residential: working.filter((r) => r.network === "residential").length,
    datacenter: working.filter((r) => r.network === "datacenter").length,
    avgPing: pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null,
    maxPing: pings.length ? Math.max(...pings) : null,
    failures: results.filter((r) => r.kind === "error").length + ipRows.filter((r) => !r.connected).length,
    waits: results.filter((r) => r.kind === "wait").length,
    rotationMin: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length / 60_000 : null,
  };
}

function CopySummary({ results }: { results: ProxyCheckResult[] }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const s = summarize(results);
    const lines = [
      `Proxy check: ${results.length} checks, ${new Date(results[0].at).toLocaleString("en-GB")} to ${new Date(results[results.length - 1].at).toLocaleTimeString("en-GB")}`,
      `IPs: ${s.ips} (${s.unique} unique, ${s.repeats} repeat${s.repeats === 1 ? "" : "s"}) · In Vietnam: ${s.vn}/${s.working} · Residential: ${s.residential}/${s.working}${s.datacenter ? ` (${s.datacenter} datacenter)` : ""}`,
      `Speed: avg ${s.avgPing != null ? ms(s.avgPing) : "-"}, slowest ${s.maxPing != null ? ms(s.maxPing) : "-"} · Failures: ${s.failures} · Waits: ${s.waits} · Rotation: ${s.rotationMin != null ? `${s.rotationMin.toFixed(1)} min` : "-"}`,
      "",
      ...results.map((r) =>
        [
          new Date(r.at).toLocaleTimeString("en-GB", { hour12: false }),
          r.kind === "wait" ? `wait ${r.waitSec}s` : r.kind === "error" || !r.connected ? "FAILED" : "OK",
          r.ip ?? "",
          r.country ? `${r.country}${r.city ? `/${r.city}` : ""}` : "",
          r.network ?? "",
          r.org ?? "",
          r.pingMs != null ? ms(r.pingMs) : "",
          r.error ?? "",
        ]
          .filter(Boolean)
          .join("  "),
      ),
    ];
    await navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">
      {copied ? <Check className="size-3.5 text-status-good" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy summary"}
    </button>
  );
}

function sleep(msTotal: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (msTotal <= 0 || signal.aborted) return resolve();
    const t = setTimeout(resolve, msTotal);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

function ms(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
