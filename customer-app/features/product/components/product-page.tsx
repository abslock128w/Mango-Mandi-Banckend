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
  const { data: product, isPending } = useProduct(id);
  const sel = useSelection(product, r);
  if (!product || !sel) return isPending ? <ProductPageSkeleton /> : <ProductMissing />;
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
        <PurchaseBar product={product} sel={sel} />
      </div>
    </PageTransition>
  );
}

/** Holds the page's height while the catalogue loads, so the footer doesn't flash up top. */
function ProductPageSkeleton() {
  return (
    <div aria-busy className="mx-auto min-h-dvh max-w-content px-4 pt-3 pb-40 lg:px-6 lg:pt-5 lg:pb-0">
      <div className="skeleton mb-3 h-4 w-40 rounded-4" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:gap-10">
        <div className="skeleton aspect-square rounded-12" />
        <div className="space-y-3">
          <div className="skeleton h-4 w-1/2 rounded-4" />
          <div className="skeleton h-7 w-3/4 rounded-4" />
          <div className="skeleton h-4 w-2/3 rounded-4" />
          <div className="skeleton h-40 rounded-12" />
          <div className="skeleton h-20 rounded-12" />
        </div>
      </div>
    </div>
  );
}

function ProductMissing() {
  return (
    <div className="mx-auto flex max-w-content flex-col items-center px-6 py-20 text-center">
      <h1 className="text-19 font-bold text-ink">We couldn&apos;t find that mango</h1>
      <p className="mt-1 max-w-xs text-13 text-muted">The link may be old, or the variety may be out of season.</p>
      <Link href="/c/all" className="press mt-6 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
        Browse mangoes
      </Link>
    </div>
  );
}
