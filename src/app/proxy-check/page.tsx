import type { Metadata } from "next";
import { ProxyCheck } from "@/components/proxy-check/proxy-check";

export const metadata: Metadata = {
  title: "Proxy Check",
};

export default function ProxyCheckPage() {
  return <ProxyCheck />;
}
