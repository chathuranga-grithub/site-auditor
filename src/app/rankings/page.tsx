import type { Metadata } from "next";
import { KeywordRankings } from "@/components/rankings/keyword-rankings";

export const metadata: Metadata = {
  title: "Keyword Rankings",
};

export default function RankingsPage() {
  return <KeywordRankings />;
}
