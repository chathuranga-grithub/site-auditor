// Registry of tools shown in the sidebar. The first entry is the default ("/" redirects to it).
// To add a tool: create its route under src/app/<slug>/page.tsx and add an entry here.

import { ScanSearch, type LucideIcon } from "lucide-react";

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
];
