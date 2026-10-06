// Residential (home / mobile ISP) or datacenter (hosting / cloud) network, guessed from the ISP name
// an IP lookup returns, e.g. "AS7552 Viettel Group" → residential, "AS16509 Amazon.com" → datacenter.

export type NetworkType = "residential" | "datacenter" | "unknown";

export function networkType(org: string | null): NetworkType {
  if (!org) return "unknown";
  if (/\bidc\b|hosting|host|cloud|data ?cent|server|colo|amazon|aws|google|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|contabo|alibaba|tencent|leaseweb|m247|datacamp|cdn/i.test(org)) return "datacenter";
  if (/viettel|vnpt|fpt|mobifone|vinaphone|vietnamobile|cmc|sctv|netnam|hanoi telecom|saigon postel|spt|gtel|telecom|mobile|broadband|cable/i.test(org)) return "residential";
  return "unknown";
}
