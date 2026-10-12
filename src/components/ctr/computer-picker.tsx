"use client";

// Auto CTR: which computer runs a campaign, picked from the computers the app is on (each says it's on
// every minute). Used when starting a campaign (this computer first, picked unless another one is) and
// when moving one. A computer that's off can still be picked: its campaigns start when its app does.

import { useEffect, useState } from "react";
import type { KnownComputer } from "@/lib/campaigns/types";
import { api } from "./ui";

export interface Computers {
  computers: KnownComputer[];
  /** This computer's id; null on the website. */
  me: string | null;
}

/** The computers campaigns can run on; null while loading. */
export function useComputers(): Computers | null {
  const [data, setData] = useState<Computers | null>(null);
  useEffect(() => {
    api<Computers>("/api/computers").then(setData, () => setData({ computers: [], me: null }));
  }, []);
  return data;
}

/**
 * "on", or when it was last on ("off · 3h ago"). Never heard from: its app is older than computers
 * saying they're on, so whether it's on isn't known ("not checked in").
 */
export function computerState(c: KnownComputer): string {
  if (c.online) return "on";
  if (!c.lastSeen) return "not checked in";
  const ms = Date.now() - new Date(c.lastSeen).getTime();
  const ago = ms < 3600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : ms < 86_400_000 ? `${Math.round(ms / 3600_000)}h` : `${Math.round(ms / 86_400_000)}d`;
  return `off · ${ago} ago`;
}

/** One option's text: "This PC · QA PC 1", "QA PC 2 · on · 3 campaigns". */
function label(c: KnownComputer, me: string | null): string {
  const parts = [c.id === me ? `This PC · ${c.name}` : c.name];
  if (c.id !== me) parts.push(computerState(c));
  if (c.campaigns) parts.push(`${c.campaigns} campaign${c.campaigns === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** This computer first, then the others (those on first, as the API sends them). */
export function sortedComputers({ computers, me }: Computers): KnownComputer[] {
  return [...computers].sort((a, b) => Number(b.id === me) - Number(a.id === me));
}

/**
 * A select of the computers. `value` "": none picked, shown as `placeholder` (on the website: the first
 * computer that starts takes it). `exclude`: not offered (the one a campaign runs on now, when moving it).
 */
export function ComputerSelect({
  data,
  value,
  onChange,
  exclude,
  placeholder,
  className = "",
  disabled,
  ariaLabel,
}: {
  data: Computers;
  value: string;
  onChange: (id: string) => void;
  exclude?: string | null;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const options = sortedComputers(data).filter((c) => c.id !== exclude);
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={ariaLabel}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((c) => (
        <option key={c.id} value={c.id} title={[c.hostname && `Windows name: ${c.hostname}`, c.appVersion && `app ${c.appVersion}`].filter(Boolean).join(" · ") || undefined}>
          {label(c, data.me)}
        </option>
      ))}
    </select>
  );
}
