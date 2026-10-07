// Registry of tools shown in the sidebar, grouped. "/" redirects to Site Audit (next.config.ts).
// To add a tool: create its route under src/app/<slug>/page.tsx, add an entry here and give it a
// permission id in src/lib/auth/permissions.ts.

import {
  ChartColumnIncreasing,
  CirclePlus,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  ScanSearch,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { ToolId } from "@/lib/auth/permissions";

export interface ToolPage {
  href: string;
  name: string;
  icon: LucideIcon;
}

export interface Tool {
  /** Permission id: which accounts may see and use the tool (src/lib/auth/permissions.ts). */
  id: ToolId;
  /** Route, e.g. "/audit". */
  href: string;
  name: string;
  description: string;
  icon: LucideIcon;
  group: ToolGroup;
  /** Small tag next to the name, e.g. "Local" for tools that only run on a computer. */
  badge?: string;
  /** Submenu pages, shown under the tool while one of its pages is open. */
  children?: ToolPage[];
}

export const TOOL_GROUPS = ["Site health", "Search & growth"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const TOOLS: Tool[] = [
  {
    id: "audit",
    href: "/audit",
    name: "Site Audit",
    description: "Crawl a site from its sitemap and homepage. Finds orphan pages, broken internal links and redirects.",
    icon: ScanSearch,
    group: "Site health",
  },
  {
    id: "visit",
    href: "/visit-test",
    name: "Visit Test",
    description: "Runs on this computer: visits every page of a company site through a Vietnam proxy, on desktop and phone, and logs what works.",
    icon: MonitorSmartphone,
    group: "Site health",
    badge: "Local",
  },
  {
    id: "rankings",
    href: "/rankings",
    name: "Keyword Rankings",
    description: "Top Google results for a keyword in Vietnam, with an on-page SEO comparison of each ranking page.",
    icon: ChartColumnIncreasing,
    group: "Search & growth",
  },
  {
    id: "ctr",
    href: "/ctr",
    name: "Auto CTR",
    description: "Follow a keyword for a site over time with real data: Google position, Search Console clicks and CTR, and time on page, against goals.",
    icon: Target,
    group: "Search & growth",
    children: [
      { href: "/ctr", name: "Dashboard", icon: LayoutDashboard },
      { href: "/ctr/campaigns", name: "Campaigns", icon: ListChecks },
      { href: "/ctr/new", name: "New campaign", icon: CirclePlus },
    ],
  },
];
