"use client";
import { BlurImage } from "@/components/ui/blur-image";
import Link from "next/link";
import { RevealOnce } from "@/components/ui/reveal-once";
import { productHref, useOpenProduct } from "@/features/product/open";
import { cn } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * Category-tile grid: every variety, the Mixed Box last. Tiles fade and rise the first time they
 * appear (RevealOnce, 30 ms apart), press to .97, and the photo grows 4% on hover (pointer devices only).
 */
export function VarietyGrid({ title, products }: { title: string; products: Product[] | undefined }) {
  const open = useOpenProduct();
  return (
    <section aria-labelledby="vg-h" className="px-4 pt-5 lg:px-6">
      <h2 id="vg-h" className="font-display text-19 font-extrabold text-ink">
        {title}
      </h2>
      <ul className="mt-3 grid grid-cols-4 gap-x-3 gap-y-3 sm:grid-cols-6 lg:grid-cols-8">
        {/* Placeholder tiles hold the grid's height until the catalogue arrives (the rails below don't jump). */}
        {!products &&
          Array.from({ length: 16 }, (_, i) => (
            <li key={i} aria-hidden className="flex flex-col items-center gap-2">
              <span className="skeleton block aspect-square w-full rounded-12" />
              <span className="skeleton h-3.5 w-3/4 rounded-4" />
            </li>
          ))}
        {products?.map((p, i) => (
          <RevealOnce as="li" key={p.id} id={`tile-${p.id}`} index={i}>
            <Link href={productHref(p.id, "tile")} onClick={(e) => open(e, p.id, "tile")} className="press group flex flex-col items-center gap-2">
              <span className={cn("relative block aspect-square w-full overflow-hidden rounded-12 bg-brand-soft", !p.variety.inSeason && "opacity-60")}>
                <BlurImage src={p.variety.photos[0]} alt="" fill sizes="(min-width: 1024px) 130px, 22vw" data-settle className="photo-lift object-cover transition-transform duration-(--dur-l) ease-standard group-hover:scale-[1.04]" />
                {p.variety.contents && <span className="absolute top-1 left-1 rounded-4 bg-ribbon px-1 text-9 font-bold text-white uppercase">Mix</span>}
                {!p.variety.inSeason && <span className="absolute inset-x-1 bottom-1 rounded-4 bg-ink/75 px-1 text-center text-9 font-bold text-white uppercase">Sold out</span>}
              </span>
              <span className="line-clamp-2 text-center text-12 leading-tight font-semibold text-ink">{p.name}</span>
            </Link>
          </RevealOnce>
        ))}
      </ul>
    </section>
  );
}
