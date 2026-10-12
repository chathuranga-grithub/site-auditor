import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EditCampaign } from "@/components/ctr/new-campaign";

export const metadata: Metadata = { title: "Edit campaign · Auto CTR" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <EditCampaign id={id} />;
}
