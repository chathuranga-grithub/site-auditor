// Registry of tools shown in the sidebar. The first entry is the default ("/" redirects to it).
// To add a tool: create its route under src/app/<slug>/page.tsx and add an entry here.

import { MousePointerClick, ScanSearch, TrendingUp, type LucideIcon } from "lucide-react";

export interface Tool {
  /** Route, e.g. "/audit". */
  href: string;
  name: string;
  description: string;
  icon: LucideIcon;
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
    description: "Runs on this computer: visit a company site through a Vietnam proxy, scroll and click internal pages to check it works.",
    icon: MousePointerClick,
  },
];
