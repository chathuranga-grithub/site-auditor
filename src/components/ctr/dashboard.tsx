"use client";

// CTR Tracker dashboard: every campaign at a glance.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { CtrSetup } from "@/lib/campaigns/types";
import { Notice, Panel, StatTile, buttonClass } from "@/components/ui/primitives";
import { CampaignTable, PageHeader, SetupNotice, api, type CampaignItem } from "./ui";

export function CtrDashboard() {
  const [data, setData] = useState<{ items: CampaignItem[]; setup: CtrSetup } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: CampaignItem[]; setup: CtrSetup }>("/api/ctr/campaigns").then(setData, (e: Error) => setError(e.message));
  }, []);

  const items = data?.items ?? [];
  const active = items.filter((i) => i.campaign.status === "active");
  const withCtr = active.filter((i) => i.summary.ctr != null);
  const onTarget = withCtr.filter((i) => i.summary.health === "good").length;
  const positions = active.map((i) => i.summary.position).filter((p): p is number => p != null);
  const clicks = active.reduce((n, i) => n + (i.summary.clicks7 ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        section="Dashboard"
        title={
          <>
            CTR <span className="text-gradient">Tracker</span>
          </>
        }
        intro="Follow keywords over time with real data: Google position, Search Console clicks and CTR, and time on page, against your goals."
        actions={
          <Link href="/ctr/new" className={buttonClass.primary}>
            <Plus className="size-4" /> New campaign
          </Link>
        }
      />
      <SetupNotice setup={data?.setup ?? null} />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active campaigns" value={data ? active.length : "—"} detail={`${items.length} in total`} />
        <StatTile label="On target" value={withCtr.length ? `${onTarget}/${withCtr.length}` : "—"} detail="CTR (and position) goals met" severity={withCtr.length ? (onTarget === withCtr.length ? "good" : "warning") : undefined} />
        <StatTile label="Average position" value={positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : "—"} detail="active campaigns, latest check" />
        <StatTile label="Clicks, last 7 days" value={withCtr.length ? clicks.toLocaleString() : "—"} detail="real clicks from Google (Search Console)" />
      </div>

      <Panel title={`Active campaigns · ${active.length}`} actions={<Link href="/ctr/campaigns" className="text-xs text-muted hover:text-ink">All campaigns →</Link>} bodyClassName="">
        {!data ? (
          <div className="px-4 py-10 text-center text-sm text-muted">Loading…</div>
        ) : active.length ? (
          <CampaignTable items={active} />
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No active campaigns.{" "}
            <Link href="/ctr/new" className="text-link hover:underline">
              Start one
            </Link>
            .
          </div>
        )}
      </Panel>
    </div>
  );
}
