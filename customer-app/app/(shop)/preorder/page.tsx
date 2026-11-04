import type { Metadata } from "next";
import { PreorderView } from "@/features/preorder/components/preorder-view";

export const metadata: Metadata = {
  title: "Book ahead for the season",
  description: "Book a box of mangoes for a week of the new season at today's price. The season starts in the first week of March.",
};

export default function PreorderPage() {
  return <PreorderView />;
}
