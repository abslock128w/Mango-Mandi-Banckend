"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useQueryParam } from "@/lib/hooks/use-query-param";
import { useProduct } from "@/features/catalog/hooks/queries";
import { PageTransition } from "@/features/shell/page-transition";
import type { RipenessStage } from "@/lib/types";
import { ProductDetail, PurchaseBar, useSelection } from "./product-detail";

/** Full product page (laptops, direct links). Phones get a sticky purchase bar. */
export function ProductPage({ id }: { id: string }) {
  const scope = useQueryParam("src") ?? "page";
  const r = useQueryParam("r") as RipenessStage | null;
  const { data: product } = useProduct(id);
  const sel = useSelection(product, r);
  if (!product || !sel) return null;
  return (
    <PageTransition>
      <div className="mx-auto max-w-content px-4 pt-3 pb-40 lg:px-6 lg:pt-5 lg:pb-0">
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-12 text-muted">
          <Link href="/" className="hover:text-action">Home</Link>
          <ChevronRight aria-hidden size={14} />
          <Link href="/c/all" className="hover:text-action">Mangoes</Link>
          <ChevronRight aria-hidden size={14} />
          <span className="text-ink">{product.name}</span>
        </nav>
        <ProductDetail product={product} sel={sel} scope={scope} mode="page" />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <PurchaseBar product={product} sel={sel} scope={scope} />
      </div>
    </PageTransition>
  );
}
