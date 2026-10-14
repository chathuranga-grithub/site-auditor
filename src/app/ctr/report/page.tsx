import type { Metadata } from "next";
import { CtrReport } from "@/components/ctr/report";
import { parseFilters } from "@/lib/campaigns/report-filters";

export const metadata: Metadata = { title: "Auto CTR report" };

/** The dashboard's numbers as an A4 report, for the filters in the address (?period=week&site=all&pc=all). */
export default async function CtrReportPage({ searchParams }: PageProps<"/ctr/report">) {
  return <CtrReport filters={parseFilters(await searchParams)} />;
}
