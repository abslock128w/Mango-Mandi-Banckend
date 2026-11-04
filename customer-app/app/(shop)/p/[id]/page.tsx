import type { Metadata } from "next";
import { ProductPage } from "@/features/product/components/product-page";

const title = (id: string) => id.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${title(id)} mangoes` };
}

/** Products come from the live catalogue for the shopper's pincode and day, so the page renders on the client. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductPage id={id} />;
}
