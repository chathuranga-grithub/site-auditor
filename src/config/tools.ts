// Registry of tools shown in the sidebar. The first entry is the default ("/" redirects to it).
// To add a tool: create its route under src/app/<slug>/page.tsx and add an entry here.

import { ChartSpline, MousePointerClick, ScanSearch, TrendingUp, type LucideIcon } from "lucide-react";

export interface Tool {
  /** Route, e.g. "/audit". */
  href: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Submenu pages, shown under the tool while one of its pages is open. */
  children?: { href: string; name: string }[];
}

export const TOOLS: Tool[] = [
  {
    href: "/audit",
    name: "Site Audit",
    description: "Crawl a site from its sitemap and homepage. Finds orphan pages, broken internal links and redirects.",
    icon: ScanSearch,
  },
  {
    href: "/rankings",
    name: "Keyword Rankings",
    description: "Top Google results for a keyword in any country, with an on-page SEO comparison of each ranking page.",
    icon: TrendingUp,
  },
  {
    href: "/visit-test",
    name: "Visit Test",
    description: "Runs on this computer: visits every page of a company site through a Vietnam proxy, on desktop and phone, and logs what works.",
    icon: MousePointerClick,
  },
  {
    href: "/ctr",
    name: "CTR Tracker",
    description: "Follow a keyword for a site over time with real data: Google position, Search Console clicks and CTR, and time on page, against goals.",
    icon: ChartSpline,
    children: [
      { href: "/ctr", name: "Dashboard" },
      { href: "/ctr/campaigns", name: "Campaigns" },
      { href: "/ctr/new", name: "New campaign" },
    ],
  },
];
