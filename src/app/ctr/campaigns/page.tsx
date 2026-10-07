import type { Metadata } from "next";
import { CampaignList } from "@/components/ctr/campaign-list";

export const metadata: Metadata = { title: "Campaigns · Auto CTR" };

export default function CampaignsPage() {
  return <CampaignList />;
}
