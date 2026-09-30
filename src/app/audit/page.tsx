import type { Metadata } from "next";
import { SiteAudit } from "@/components/audit/site-audit";

export const metadata: Metadata = {
  title: "Site Audit",
};

export default function AuditPage() {
  return <SiteAudit />;
}
