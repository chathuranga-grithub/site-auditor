import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/ctr/campaign-detail";

export const metadata: Metadata = { title: "Campaign · CTR Tracker" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <CampaignDetail id={id} />;
}
