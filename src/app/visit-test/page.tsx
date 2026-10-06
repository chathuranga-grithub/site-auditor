import type { Metadata } from "next";
import { VisitTest } from "@/components/visit/visit-test";

export const metadata: Metadata = {
  title: "Visit Test",
};

export default function VisitTestPage() {
  return <VisitTest />;
}
