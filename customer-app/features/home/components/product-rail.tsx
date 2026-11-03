"use client";
import Link from "next/link";
import { ProductCard, ProductCardSkeleton } from "@/features/catalog/components/product-card";
import { useProducts } from "@/features/catalog/hooks/queries";
import { WhenVisible } from "@/components/ui/when-visible";
import type { RipenessStage } from "@/lib/types";

/** A shelf of variety cards shown at one ripeness; in-stock varieties first. */
export function ProductRail({ id, title, why, stage, href }: { id: string; title: string; /** One quiet line under the title: why this shelf, in muted ink. */ why?: string; stage?: RipenessStage; href: string }) {
  return (
    <section aria-labelledby={`${id}-h`} className="pt-8 lg:pt-6">
      <div className="flex items-center justify-between gap-3 px-4 lg:px-6">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="font-display text-19 font-extrabold text-ink">
            {title}
          </h2>
          {why && <p className="mt-0.5 truncate text-12 text-muted">{why}</p>}
        </div>
        <Link href={href} className="press flex h-11 shrink-0 items-center text-15 font-semibold whitespace-nowrap text-deep">
          see all <span className="sr-only">{title}</span>
        </Link>
      </div>
      <WhenVisible placeholder={<RailSkeleton />}>
        <RailCards id={id} stage={stage} />
      </WhenVisible>
    </section>
  );
}

function RailSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden px-4 pt-3 pb-1 lg:gap-3 lg:px-6" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <ProductCardSkeleton key={i} fixed />
      ))}
    </div>
  );
}

function RailCards({ id, stage }: { id: string; stage?: RipenessStage }) {
  const { data, isError } = useProducts();
  // The home page shows one notice for the catalogue; a rail stays empty rather than loading forever.
  if (isError) return null;
  if (!data) return <RailSkeleton />;
  const inStock = (pid: string) => data.find((p) => p.id === pid)!.skus.some((s) => (!stage || s.ripeness === stage) && s.stock > 0);
  const list = [...data].sort((a, b) => Number(inStock(b.id)) - Number(inStock(a.id)));
  return (
    // Cards snap to the page gutter, and both ends fade so a card leaving the edge doesn't clip hard.
    <div data-reveal-group className="rail-snap rail-fade no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 pb-1 lg:gap-3 lg:px-6">
      {list.slice(0, 10).map((p, i) => (
        <ProductCard key={p.id} product={p} ripeness={stage} scope={`rail-${id}`} index={i} fixed />
      ))}
    </div>
  );
}
