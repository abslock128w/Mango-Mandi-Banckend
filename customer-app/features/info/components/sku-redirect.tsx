"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePriceList } from "@/features/catalog/hooks/queries";

/** Seeded SKU prefixes, so the common old links redirect without waiting for the price list. */
const KNOWN: Record<string, string> = { ALP: "alphonso", BAD: "badami" };

/**
 * Old shop links (/mangoes/ALP-3) to the variety page (/p/alphonso). Other SKUs
 * are looked up in the price list (GET /v1/products) in the browser; a
 * product id is lib/varieties slugify(variety).
 */
export function SkuRedirect({ sku }: { sku: string }) {
  const router = useRouter();
  const code = decodeURIComponent(sku).toUpperCase();
  const known = KNOWN[code.split("-")[0]];
  const list = usePriceList();
  useEffect(() => {
    if (known) return router.replace(`/p/${known}`);
    if (list.isPending) return;
    const product = list.data?.find((p) => p.boxes.some((b) => b.apiSku.toUpperCase() === code));
    router.replace(product ? `/p/${product.id}` : "/c/all");
  }, [known, list.isPending, list.data, code, router]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center" aria-busy="true">
      <div className="skeleton size-16 rounded-full" />
      <p className="mt-4 text-13 text-muted">Opening the mango you asked for</p>
    </main>
  );
}
