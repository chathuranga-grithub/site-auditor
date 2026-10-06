"use client";

// Results table (one row per ranking page) and the detail panel for the selected page.

import { CircleCheck, CircleX, ExternalLink, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { AnalysisState, PageSeo, SerpResult } from "@/lib/rankings-types";
import { SEO_CHECKS, checksPassed, isAnalyzable } from "@/lib/rankings-checks";
import { friendlyError } from "@/lib/report";

export type { AnalysisState };

export function RankTable({
  results,
  analysis,
  selected,
  onSelect,
}: {
  results: SerpResult[];
  analysis: Record<string, AnalysisState>;
  selected: number | null;
  onSelect: (position: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-line bg-surface font-mono text-[10px] tracking-[0.14em] text-subtle uppercase">
          <tr>
            <th className="w-12 px-4 py-2.5 font-medium">#</th>
            <th className="px-4 py-2.5 font-medium">Page</th>
            <th className="w-20 px-3 py-2.5 text-right font-medium">Words</th>
            <th className="w-20 px-3 py-2.5 text-right font-medium">Speed</th>
            <th className="w-20 px-3 py-2.5 text-right font-medium">Title</th>
            <th className="w-24 px-3 py-2.5 text-right font-medium">Desc.</th>
            <th className="w-14 px-3 py-2.5 text-right font-medium">H1</th>
            <th className="w-28 px-3 py-2.5 font-medium">Checks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {results.map((r) => {
            const a = analysis[r.url];
            const page = isAnalyzable(a as PageSeo) ? (a as PageSeo) : null;
            const isSel = selected === r.position;
            return (
              <tr
                key={r.position}
                onClick={() => onSelect(r.position)}
                className={`cursor-pointer transition-colors hover:bg-surface-2 ${isSel ? "bg-accent/10 ring-1 ring-accent/40 ring-inset" : ""}`}
              >
                <td className="px-4 py-2.5 align-top font-mono text-sm font-semibold text-ink tabular-nums">{r.position}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="font-mono text-xs text-ink">{r.domain}</div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted">{r.title}</div>
                </td>
                {page ? (
                  <>
                    <Num>{page.wordCount.toLocaleString()}</Num>
                    <Num>{formatMs(page.durationMs)}</Num>
                    <Num warn={!SEO_CHECKS[0].pass(page)}>{page.title?.length ?? "—"}</Num>
                    <Num warn={!SEO_CHECKS[1].pass(page)}>{page.description?.length ?? "—"}</Num>
                    <Num warn={!SEO_CHECKS[2].pass(page)}>{page.h1Count}</Num>
                    <td className="px-3 py-2.5 align-top">
                      <ScorePill passed={checksPassed(page)} total={SEO_CHECKS.length} />
                    </td>
                  </>
                ) : (
                  <td colSpan={6} className="px-3 py-2.5 align-top text-xs text-muted">
                    {a === "pending" || a === undefined ? (
                      <span className="inline-flex items-center gap-1.5 text-accent-2">
                        <Loader2 className="size-3.5 animate-spin" /> Analysing page…
                      </span>
                    ) : (
                      <span className="text-status-warning">{unavailableReason(a)}</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RankDetail({
  result,
  state,
  onClose,
}: {
  result: SerpResult;
  state: AnalysisState | undefined;
  onClose: () => void;
}) {
  const page = isAnalyzable(state as PageSeo) ? (state as PageSeo) : null;

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.18em] text-subtle uppercase">Position #{result.position}</div>
          <h3 className="mt-1 text-lg font-semibold break-words text-ink">{result.title}</h3>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex max-w-full items-center gap-1 font-mono text-xs break-all text-link hover:underline"
          >
            {result.url}
            <ExternalLink className="size-3 shrink-0" />
          </a>
          {result.snippet && <p className="mt-2 text-sm text-muted">{result.snippet}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      {!page ? (
        <p className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-sm text-amber-100">
          {state === "pending" || state === undefined ? "Still analysing this page…" : unavailableReason(state)}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <h4 className="mb-2 font-mono text-[10px] tracking-[0.18em] text-subtle uppercase">
              SEO checks · {checksPassed(page)}/{SEO_CHECKS.length} passed
            </h4>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {SEO_CHECKS.map((c) => {
                const ok = c.pass(page);
                return (
                  <li key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    {ok ? (
                      <CircleCheck className="size-4 shrink-0 text-status-good" aria-label="Pass" />
                    ) : (
                      <CircleX className="size-4 shrink-0 text-status-serious" aria-label="Fail" />
                    )}
                    <span className="text-ink">{c.label}</span>
                    <span className="hidden text-xs text-subtle sm:inline">({c.rule})</span>
                    <span className="ml-auto truncate font-mono text-xs text-muted" title={c.value(page)}>
                      {c.value(page)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] tracking-[0.18em] text-subtle uppercase">Page details</h4>
            <dl className="divide-y divide-line rounded-lg border border-line text-sm">
              <Fact label="Title" value={page.title ?? "—"} />
              <Fact label="Meta description" value={page.description ?? "—"} />
              <Fact label="H1" value={page.h1 ?? "—"} />
              <Fact label="Words / H2s" value={`${page.wordCount.toLocaleString()} words · ${page.h2Count} H2`} />
              <Fact label="Response / size" value={`${formatMs(page.durationMs)} · ${formatBytes(page.bytes)}`} />
              <Fact label="Links" value={`${page.internalLinks} internal · ${page.externalLinks} external`} />
              <Fact label="Language" value={page.lang ?? "not set"} />
              <Fact label="Schema types" value={page.schemaTypes.join(", ") || "none"} />
              <Fact label="Canonical" value={page.canonical ?? "missing"} mono />
              {page.redirected && <Fact label="Redirects to" value={page.finalUrl} mono />}
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`min-w-0 text-xs break-words text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function Num({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <td className={`px-3 py-2.5 text-right align-top font-mono text-xs tabular-nums ${warn ? "text-status-warning" : "text-ink"}`}>
      {children}
    </td>
  );
}

function ScorePill({ passed, total }: { passed: number; total: number }) {
  const ratio = passed / total;
  const tone = ratio >= 0.8 ? "bg-status-good" : ratio >= 0.5 ? "bg-status-warning" : "bg-status-serious";
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs text-ink tabular-nums">
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </span>
      {passed}/{total}
    </span>
  );
}

export function unavailableReason(state: AnalysisState): string {
  if (state === "pending") return "Analysing…";
  if ("failed" in state) return `Couldn't analyse: ${friendlyError(state.failed)}`;
  if (state.blocked) return "Blocked by bot protection (e.g. Cloudflare), so the page couldn't be analysed.";
  if (state.error) return `Couldn't load the page: ${friendlyError(state.error)}`;
  return `The page returned HTTP ${state.status}.`;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatBytes(b: number): string {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}
