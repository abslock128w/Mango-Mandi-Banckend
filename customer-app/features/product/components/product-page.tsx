"use client";
import { OutsidePage } from "@/components/ui/outside-page";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { CatalogueError } from "@/features/catalog/components/catalogue-error";
import { useProduct } from "@/features/catalog/hooks/queries";
import type { RipenessStage } from "@/lib/types";
import { varietyForSlug } from "@/lib/varieties";
import { ProductDetail, PurchaseBar, useSelection } from "./product-detail";

/** Full product page (laptops, direct links). Phones get a sticky purchase bar. */
export function ProductPage({ id }: { id: string }) {
  // useSearchParams, not window.location: on a client navigation the URL changes only after this
  // first render, and the photo and name morph need the card's scope (src) in that render.
  const params = useSearchParams();
  const scope = params.get("src") ?? "page";
  const r = params.get("r") as RipenessStage | null;
  const { data: product, isPending, isError, refetch } = useProduct(id);
  const sel = useSelection(product, r);
  if (isError) return <CatalogueError onRetry={refetch} className="mx-auto mt-6 max-w-[480px]" />;
  if (!product || !sel) return isPending ? <ProductPageSkeleton id={id} stage={r} /> : <ProductMissing />;
  return (
    <>
      <div className="mx-auto max-w-content px-4 pt-3 pb-40 lg:px-6 lg:pt-5 lg:pb-0">
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-12 text-muted">
          <Link href="/" className="tap hover:text-action">Home</Link>
          <ChevronRight aria-hidden size={14} />
          <Link href="/c/all" className="tap hover:text-action">Mangoes</Link>
          <ChevronRight aria-hidden size={14} />
          <span className="text-ink">{product.name}</span>
        </nav>
        <ProductDetail product={product} sel={sel} scope={scope} mode="page" />
      </div>
      <OutsidePage>
        <div className="glass glass-strong fixed inset-x-0 bottom-0 z-30 rounded-none border-x-0 border-b-0 border-t border-t-hairline pb-[env(safe-area-inset-bottom)] lg:hidden">
          <PurchaseBar product={product} sel={sel} />
        </div>
      </OutsidePage>
    </>
  );
}

/** Holds the page's height while the catalogue loads, so the footer doesn't flash up top. */
/**
 * While the catalogue loads. A known variety's photo is drawn straight away (it is the page's
 * largest paint, and the same file and sizes as the loaded page, so it is fetched once).
 */
function ProductPageSkeleton({ id, stage }: { id: string; stage: RipenessStage | null }) {
  const variety = varietyForSlug(id);
  const photo = variety ? variety.stagePhotos[stage ?? "RIPE"] : null;
  return (
    <div aria-busy className="mx-auto min-h-dvh max-w-content px-4 pt-3 pb-40 lg:px-6 lg:pt-5 lg:pb-0">
      <div className="skeleton mb-3 h-4 w-40 rounded-4" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:gap-10">
        {photo ? (
          <div className="relative aspect-square overflow-hidden rounded-12 bg-surface">
            <Image src={photo} alt="" fill preload fetchPriority="high" loading="eager" sizes="(min-width: 1024px) 520px, 100vw" className="object-cover" />
          </div>
        ) : (
          <div className="skeleton aspect-square rounded-12" />
        )}
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
