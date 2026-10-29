"use client";
import Link from "next/link";
import { ProductCard, ProductCardSkeleton } from "@/features/catalog/components/product-card";
import { useProducts } from "@/features/catalog/hooks/queries";
import { WhenVisible } from "@/components/ui/when-visible";
import type { RipenessStage } from "@/lib/types";

/** A shelf of variety cards shown at one ripeness; in-stock varieties first. */
export function ProductRail({ id, title, stage, href }: { id: string; title: string; stage?: RipenessStage; href: string }) {
  return (
    <section aria-labelledby={`${id}-h`} className="pt-6">
      <div className="flex items-center justify-between px-4 lg:px-6">
        <h2 id={`${id}-h`} className="font-display text-19 font-extrabold text-ink">
          {title}
        </h2>
        <Link href={href} className="flex h-11 items-center text-15 font-semibold text-deep">
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
  const { data } = useProducts();
  if (!data) return <RailSkeleton />;
  const inStock = (pid: string) => data.find((p) => p.id === pid)!.skus.some((s) => (!stage || s.ripeness === stage) && s.stock > 0);
  const list = [...data].sort((a, b) => Number(inStock(b.id)) - Number(inStock(a.id)));
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 pb-1 lg:gap-3 lg:px-6">
      {list.slice(0, 10).map((p, i) => (
        <ProductCard key={p.id} product={p} ripeness={stage} scope={`rail-${id}`} index={i} fixed />
      ))}
    </div>
  );
}
