import type { Metadata } from "next";
import { Suspense } from "react";
import { VisitTest } from "@/components/visit/visit-test";

export const metadata: Metadata = {
  title: "Visit Test",
};

export default function VisitTestPage() {
  // Suspense: VisitTest reads ?url= (e.g. from Keyword Rankings) to fill in the site.
  return (
    <Suspense>
      <VisitTest />
    </Suspense>
  );
}
