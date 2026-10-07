import type { Metadata } from "next";
import { NewCampaign } from "@/components/ctr/new-campaign";

export const metadata: Metadata = { title: "New campaign · CTR Tracker" };

export default function NewCampaignPage() {
  return <NewCampaign />;
}
