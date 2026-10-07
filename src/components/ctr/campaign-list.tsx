"use client";

// Auto CTR: every saved campaign, with status filters and pause / resume / delete.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Plus, Trash2 } from "lucide-react";
import type { CampaignStatus, CtrSetup } from "@/lib/campaigns/types";
import { Notice, Panel, buttonClass } from "@/components/ui/primitives";
import { CampaignTable, PageHeader, SetupNotice, api, type CampaignItem } from "./ui";

type Filter = "all" | CampaignStatus;

export function CampaignList() {
  const [data, setData] = useState<{ items: CampaignItem[]; setup: CtrSetup } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<{ items: CampaignItem[]; setup: CtrSetup }>("/api/ctr/campaigns").then(setData, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(id: number, action: "pause" | "resume" | "delete") {
    setError(null);
    try {
      if (action === "delete") {
        if (!confirm("Delete this campaign and all its saved data?")) return;
        await api(`/api/ctr/campaigns/${id}`, { method: "DELETE" });
      } else {
        await api(`/api/ctr/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: action === "pause" ? "paused" : "active" }) });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const items = data?.items ?? [];
  const shown = filter === "all" ? items : items.filter((i) => i.campaign.status === filter);
  const count = (f: Filter) => (f === "all" ? items.length : items.filter((i) => i.campaign.status === f).length);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        section="Campaigns"
        title="Campaigns"
        intro="Every saved campaign. Open one for its charts, daily numbers and change log."
        actions={
          <Link href="/ctr/new" className={buttonClass.primary}>
            <Plus className="size-4" /> New campaign
          </Link>
        }
      />
      <SetupNotice setup={data?.setup ?? null} />
      {error && <Notice tone="error">{error}</Notice>}

      <Panel
        title={`Campaigns · ${shown.length}`}
        actions={
          <div className="flex gap-1.5" role="group" aria-label="Show">
            {(["all", "active", "paused", "finished"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-md border px-2.5 py-1 text-xs capitalize transition ${filter === f ? "border-accent/50 bg-accent/15 text-ink" : "border-line text-muted hover:text-ink"}`}
              >
                {f} <span className="font-mono text-[10px] text-subtle">{count(f)}</span>
              </button>
            ))}
          </div>
        }
        bodyClassName=""
      >
        {!data ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Loading…</div>
        ) : shown.length ? (
          <CampaignTable
            items={shown}
            actions={({ campaign: c }) => (
              <span className="inline-flex gap-1">
                {c.status === "active" && (
                  <IconButton label="Pause" onClick={() => act(c.id, "pause")}>
                    <Pause className="size-3.5" />
                  </IconButton>
                )}
                {c.status === "paused" && (
                  <IconButton label="Resume" onClick={() => act(c.id, "resume")}>
                    <Play className="size-3.5" />
                  </IconButton>
                )}
                <IconButton label="Delete" onClick={() => act(c.id, "delete")} danger>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </span>
            )}
          />
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted">No campaigns here yet.</div>
        )}
      </Panel>
    </div>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 ${danger ? "hover:text-status-critical" : "hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
