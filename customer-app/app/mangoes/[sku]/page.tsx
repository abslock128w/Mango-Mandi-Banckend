import type { Metadata } from "next";
import { SkuRedirect } from "@/features/info/components/sku-redirect";

export const metadata: Metadata = { title: "Mangoes" };

/** Old shop product links (/mangoes/ALP-3) go to the variety page. */
export default async function Page({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  return <SkuRedirect sku={sku} />;
}
