"use client";

// Keyword Rankings tool: pick a country and keyword, get the top Google results
// (/api/serp), then analyse each ranking page's on-page SEO (/api/analyze) and show
// a graphical comparison report.

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Download, ExternalLink, Globe, Loader2, Search } from "lucide-react";
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  ENABLED_COUNTRIES,
  POPULAR_COUNTRIES,
  findCountry,
  googleSearchUrl,
  localLanguage,
  type LanguageChoice,
} from "@/lib/countries";
import { downloadRankingsExcel } from "@/lib/excel-report";
import { RESULT_COUNTS, type ApiError, type PageSeo, type ResultCount, type SerpResponse } from "@/lib/rankings-types";
import { SEO_CHECKS, checksPassed, isAnalyzable, median } from "@/lib/rankings-checks";
import { Notice, Panel, StatTile, Tag, buttonClass } from "@/components/ui/primitives";
import { CheckCoverage, PositionBars } from "./rank-charts";
import { RankDetail, RankTable, formatMs, type AnalysisState } from "./rank-results";

const ANALYZE_CONCURRENCY = 5;

export function KeywordRankings() {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState<ResultCount>(10);
  const [language, setLanguage] = useState<LanguageChoice>("local");
  const local = localLanguage(country);
  const hasLocalLanguage = local.hl !== "en";
  const [phase, setPhase] = useState<"idle" | "searching" | "analyzing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SerpResponse | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, AnalysisState>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const runRef = useRef(0);

  const busy = phase === "searching" || phase === "analyzing";
  const enabled = COUNTRIES.filter((c) => ENABLED_COUNTRIES.includes(c.code));
  const popular = POPULAR_COUNTRIES.filter((c) => ENABLED_COUNTRIES.includes(c)).map((c) => findCountry(c)!);
  const singleCountry = enabled.length === 1;

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const q = keyword.trim();
    if (!q) {
      setError("Enter a keyword to search for.");
      return;
    }

    const run = ++runRef.current;
    setPhase("searching");
    setError(null);
    setData(null);
    setAnalysis({});
    setSelected(null);

    let serp: SerpResponse;
    try {
      const res = await fetch("/api/serp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: q, country, count, language: hasLocalLanguage ? language : "local" }),
      });
      const body = (await res.json().catch(() => ({ error: `Search failed (${res.status})` }))) as SerpResponse | ApiError;
      if ("error" in body) throw new Error(body.error);
      serp = body;
    } catch (err) {
      if (run !== runRef.current) return;
      setError(err instanceof Error ? err.message : "Search failed. Please try again.");
      setPhase("idle");
      return;
    }
    if (run !== runRef.current) return;

    setData(serp);
    if (serp.results.length === 0) {
      setPhase("done");
      return;
    }
    setPhase("analyzing");
    setAnalysis(Object.fromEntries(serp.results.map((r) => [r.url, "pending" as const])));

    let next = 0;
    const worker = async () => {
      while (next < serp.results.length) {
        const r = serp.results[next++];
        const state = await analyze(r.url);
        if (run !== runRef.current) return;
        setAnalysis((prev) => ({ ...prev, [r.url]: state }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(ANALYZE_CONCURRENCY, serp.results.length) }, worker));
    if (run === runRef.current) setPhase("done");
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-subtle uppercase">Tools / Keyword Rankings</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Keyword <span className="text-gradient">Rankings</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            See who ranks on Google for a keyword in a country, and compare their on-page SEO.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>Google results</Tag>
          <Tag>top {RESULT_COUNTS.join(" / ")}</Tag>
          <Tag>1–2 searches</Tag>
        </div>
      </header>

      <form onSubmit={handleSearch} className="glass grid gap-2 rounded-xl p-2 md:grid-cols-[13rem_1fr_auto_auto_auto]">
        {singleCountry ? (
          <div
            className="flex h-10 items-center gap-2 rounded-lg bg-canvas/60 px-3 text-sm text-ink"
            title="More countries can be added later"
          >
            <Globe className="size-4 text-subtle" aria-hidden />
            {enabled[0].name}
          </div>
        ) : (
          <label className="block">
            <span className="sr-only">Country</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={busy}
              className="h-10 w-full rounded-lg border border-transparent bg-canvas/60 px-3 text-sm text-ink outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            >
              <optgroup label="Popular">
                {popular.map((c) => (
                  <option key={`p-${c.code}`} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All countries">
                {enabled.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        )}

        <label className="relative block">
          <span className="sr-only">Keyword</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            disabled={busy}
            maxLength={120}
            placeholder='Keyword, e.g. "iphone"'
            className="h-10 w-full rounded-lg border border-transparent bg-canvas/60 pr-3 pl-10 text-base text-ink outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60 sm:text-sm"
          />
        </label>

        {hasLocalLanguage ? (
          <div className="flex h-10 rounded-lg bg-canvas/60 p-1" role="radiogroup" aria-label="Search language">
            {(["local", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={language === l}
                onClick={() => setLanguage(l)}
                disabled={busy}
                title={l === "local" ? `Search the way most people in ${findCountry(country)?.name} do` : "Search in English"}
                className={`flex-1 rounded-md px-3 text-xs font-medium whitespace-nowrap transition ${
                  language === l ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink"
                }`}
              >
                {l === "local" ? local.name : "English"}
              </button>
            ))}
          </div>
        ) : (
          <div className="hidden md:block" aria-hidden />
        )}

        <div className="flex h-10 rounded-lg bg-canvas/60 p-1" role="radiogroup" aria-label="Number of results">
          {RESULT_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={count === n}
              onClick={() => setCount(n)}
              disabled={busy}
              className={`flex-1 rounded-md px-3 text-xs font-medium whitespace-nowrap transition ${
                count === n ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink"
              }`}
            >
              Top {n}
            </button>
          ))}
        </div>

        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {phase === "searching" ? "Searching…" : phase === "analyzing" ? "Analysing…" : "Search"}
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      {phase === "searching" && (
        <Panel bodyClassName="flex items-center gap-3 p-5 text-sm text-muted">
          <Loader2 className="size-4 animate-spin text-accent-2" />
          Searching Google for &ldquo;{keyword.trim()}&rdquo; as a user in {findCountry(country)?.name}
          {hasLocalLanguage && ` (${language === "local" ? local.name : "English"})`}…
        </Panel>
      )}

      {data && <Report data={data} analysis={analysis} phase={phase} selected={selected} onSelect={setSelected} />}
    </div>
  );
}

function Report({
  data,
  analysis,
  phase,
  selected,
  onSelect,
}: {
  data: SerpResponse;
  analysis: Record<string, AnalysisState>;
  phase: string;
  selected: number | null;
  onSelect: (p: number | null) => void;
}) {
  const countryName = findCountry(data.country)?.name ?? data.country;
  const pages = useMemo(
    () => data.results.map((r) => analysis[r.url]).filter((a): a is PageSeo => isAnalyzable(a as PageSeo)),
    [data, analysis],
  );
  const done = data.results.filter((r) => analysis[r.url] && analysis[r.url] !== "pending").length;
  const pct = (n: number) => (pages.length ? `${Math.round((n / pages.length) * 100)}%` : "—");
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

  const avgWords = avg(pages.map((p) => p.wordCount));
  const medSpeed = median(pages.map((p) => p.durationMs));
  const avgChecks = pages.length ? pages.reduce((s, p) => s + checksPassed(p), 0) / pages.length : null;

  const series = (pick: (p: PageSeo) => number) =>
    data.results.map((r) => {
      const a = analysis[r.url];
      return { position: r.position, domain: r.domain, value: isAnalyzable(a as PageSeo) ? pick(a as PageSeo) : null };
    });

  const selectedResult = data.results.find((r) => r.position === selected) ?? null;

  if (data.results.length === 0) {
    return (
      <Notice tone="info">
        Google returned no results for &ldquo;{data.keyword}&rdquo; in {countryName}. Try a different keyword or country.
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            {phase === "analyzing" ? (
              <Loader2 className="size-3.5 animate-spin text-accent-2" />
            ) : (
              <span className="size-1.5 rounded-full bg-status-good" aria-hidden />
            )}
            <span className="text-ink">
              {phase === "analyzing" ? `Analysing ${done}/${data.results.length}` : "Completed"}
            </span>
          </span>
          <span>
            Top {data.results.length} for <span className="text-ink">&ldquo;{data.keyword}&rdquo;</span> as a user in{" "}
            <span className="text-ink">{countryName}</span> · <span className="text-ink">{data.languageName}</span>
          </span>
          <a
            href={googleSearchUrl(data.keyword, data.country, data.language)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-link hover:underline"
            title="Opens the same search on Google. Your own location can still change what you see."
          >
            Check on Google <ExternalLink className="size-3" />
          </a>
          <span>{new Date(data.searchedAt).toLocaleString()}</span>
        </div>
        {phase === "done" && <ReportActions data={data} analysis={analysis} />}
      </div>

      {(data.searchesUsed > 1 || data.results.length < data.requested) && (
        <Notice tone="info">
          {data.results.length < data.requested
            ? `Google only returned ${data.results.length} normal results for this keyword (the rest of the page is videos, maps, shopping or similar).`
            : "Google's first page had fewer than " + data.requested + " normal results, so page 2 was used to complete the list (2 searches)."}
        </Notice>
      )}
      {phase === "done" && pages.length < data.results.length && (
        <Notice tone="warning">
          {data.results.length - pages.length} of {data.results.length} pages couldn&apos;t be analysed (for example, the site blocks
          automated visitors or didn&apos;t respond). They still count in the ranking; their rows show the reason.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Results"
          value={data.results.length}
          detail={
            phase === "analyzing"
              ? `${pages.length} analysed so far`
              : pages.length < data.results.length
                ? `${pages.length} analysed · ${data.results.length - pages.length} couldn't be read`
                : `all ${pages.length} analysed`
          }
        />
        <StatTile label="Avg. words" value={avgWords === null ? "—" : avgWords.toLocaleString()} detail="per page" />
        <StatTile label="Median speed" value={medSpeed === null ? "—" : formatMs(medSpeed)} detail="server response" />
        <StatTile label="HTTPS" value={pct(pages.filter((p) => p.https).length)} detail="of pages" />
        <StatTile label="Schema" value={pct(pages.filter((p) => p.schemaTypes.length > 0).length)} detail="use structured data" />
        <StatTile
          label="Avg. checks"
          value={avgChecks === null ? "—" : `${avgChecks.toFixed(1)}/${SEO_CHECKS.length}`}
          detail="SEO checks passed"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Word count by position" bodyClassName="p-4 pt-5">
          <PositionBars
            data={series((p) => p.wordCount)}
            format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`)}
            formatExact={(v) => `${Math.round(v).toLocaleString()} words`}
            caption="Words of visible text on each ranking page."
          />
        </Panel>
        <Panel title="Response time by position" bodyClassName="p-4 pt-5">
          <PositionBars
            data={series((p) => p.durationMs)}
            format={(v) => formatMs(Math.round(v))}
            caption="How long each page took to load from our server (lower is better)."
          />
        </Panel>
      </div>

      <Panel title={`SEO checklist · top ${data.results.length}`} bodyClassName="p-4">
        <CheckCoverage
          items={SEO_CHECKS.map((c) => ({
            label: c.label,
            rule: c.rule,
            passed: pages.filter((p) => c.pass(p)).length,
            total: pages.length,
          }))}
        />
        <p className="mt-3 text-xs text-subtle">How many of the analysed ranking pages pass each on-page check.</p>
      </Panel>

      <Panel
        title="Ranking pages"
        actions={
          <span className="text-xs text-subtle">
            <span className="text-status-warning">Amber</span> = outside the recommended range · Click a row for details
          </span>
        }
      >
        <RankTable results={data.results} analysis={analysis} selected={selected} onSelect={(p) => onSelect(p === selected ? null : p)} />
        {selectedResult && (
          <div className="border-t border-line">
            <RankDetail result={selectedResult} state={analysis[selectedResult.url]} onClose={() => onSelect(null)} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function ReportActions({ data, analysis }: { data: SerpResponse; analysis: Record<string, AnalysisState> }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildSummary(data, analysis));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  async function download() {
    setBusy(true);
    try {
      await downloadRankingsExcel(data, analysis);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      <button type="button" onClick={copy} className={buttonClass.secondary}>
        {copied === "ok" ? <Check className="size-3.5 text-status-good" /> : <Copy className="size-3.5" />}
        {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy summary"}
      </button>
      <button type="button" onClick={download} disabled={busy} className={buttonClass.secondary}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        Excel
      </button>
    </div>
  );
}

function buildSummary(data: SerpResponse, analysis: Record<string, AnalysisState>): string {
  const country = findCountry(data.country)?.name ?? data.country;
  const lines = [`Google top ${data.results.length} for "${data.keyword}" in ${country} (${data.languageName})`, new Date(data.searchedAt).toLocaleString("en-GB"), ""];
  for (const r of data.results) {
    const a = analysis[r.url];
    const p = isAnalyzable(a as PageSeo) ? (a as PageSeo) : null;
    lines.push(
      `#${r.position} ${r.domain}`,
      `   ${r.url}`,
      p
        ? `   ${p.wordCount.toLocaleString()} words · ${formatMs(p.durationMs)} · checks ${checksPassed(p)}/${SEO_CHECKS.length}`
        : "   (page couldn't be analysed)",
    );
  }
  return lines.join("\n");
}

async function analyze(url: string): Promise<AnalysisState> {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = (await res.json().catch(() => ({ error: `Analysis failed (${res.status})` }))) as PageSeo | ApiError;
    return "status" in body ? body : { failed: body.error };
  } catch (err) {
    return { failed: err instanceof Error ? err.message : "Analysis failed" };
  }
}
