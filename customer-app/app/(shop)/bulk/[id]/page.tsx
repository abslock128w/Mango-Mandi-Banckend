import type { Metadata } from "next";
import { BulkDealView } from "@/features/bulk/components/bulk-deal-view";

export const metadata: Metadata = { title: "Bulk deal" };

/** Stock and days depend on the shopper's pincode, so the deal renders on the client. */
export default async function BulkDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BulkDealView id={id} />;
}
