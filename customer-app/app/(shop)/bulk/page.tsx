import type { Metadata } from "next";
import { BulkView } from "@/features/bulk/components/bulk-view";

export const metadata: Metadata = {
  title: "Bulk deals",
  description: "Mangoes for offices, events and big families. Order more boxes and pay less per box. Free delivery, GST included.",
};

/** Deals depend on the shopper's pincode, so the list renders on the client. */
export default function BulkPage() {
  return <BulkView />;
}
