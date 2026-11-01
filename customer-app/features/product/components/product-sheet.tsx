"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/drawer";
import { useProduct } from "@/features/catalog/hooks/queries";
import type { RipenessStage } from "@/lib/types";
import { ProductDetail, PurchaseBar, useSelection } from "./product-detail";

const SNAPS = [0.72, 1];

/** Product detail as a bottom sheet (peek, full) on phones; right panel on laptops. */
export function ProductSheet() {
  const params = useSearchParams();
  const id = params.get("product");
  const scope = params.get("src") ?? "sheet";
  const r = params.get("r") as RipenessStage | null;
  // Keep the last product mounted while the sheet animates closed.
  const [lastId, setLastId] = useState(id);
  if (id && id !== lastId) setLastId(id);
  const shownId = id ?? lastId;
  const { data: product, isPending } = useProduct(shownId);
  const sel = useSelection(product, r);

  const close = () => {
    if (window.history.state?.productSheet) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    ["product", "src", "r"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, "", url);
  };

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && close()}
      title={product ? `${product.name} mango` : "Product"}
      hideTitle
      description="Product details"
      snapPoints={SNAPS}
      panelWidth={480}
      footer={product && sel ? <PurchaseBar product={product} sel={sel} /> : undefined}
    >
      {product && sel ? (
        <ProductDetail key={product.id} product={product} sel={sel} scope={scope} mode="sheet" />
      ) : !isPending ? (
        <p className="px-4 py-16 text-center text-15 font-semibold text-ink">We couldn&apos;t find that mango.</p>
      ) : (
        <div className="space-y-3 p-4" aria-busy>
          <div className="skeleton aspect-square rounded-12" />
          <div className="skeleton h-6 w-1/2 rounded-4" />
          <div className="skeleton h-4 w-3/4 rounded-4" />
        </div>
      )}
    </Sheet>
  );
}
