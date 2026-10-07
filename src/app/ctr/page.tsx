import type { Metadata } from "next";
import { CtrDashboard } from "@/components/ctr/dashboard";

export const metadata: Metadata = { title: "Auto CTR" };

export default function CtrPage() {
  return <CtrDashboard />;
}
