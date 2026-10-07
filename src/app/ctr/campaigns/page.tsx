import type { Metadata } from "next";
import { CampaignList } from "@/components/ctr/campaign-list";

export const metadata: Metadata = { title: "Campaigns · CTR Tracker" };

export default function CampaignsPage() {
  return <CampaignList />;
}
