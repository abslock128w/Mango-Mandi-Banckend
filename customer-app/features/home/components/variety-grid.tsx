"use client";
import Image from "next/image";
import Link from "next/link";
import { productHref, useOpenProduct } from "@/features/product/open";
import { cn } from "@/lib/format";
import { riseDelay } from "@/lib/motion";
import type { Product } from "@/lib/types";

/** Category-tile grid: every variety, the Mixed Box last. */
export function VarietyGrid({ title, products }: { title: string; products: Product[] }) {
  const open = useOpenProduct();
  return (
    <section aria-labelledby="vg-h" className="px-4 pt-5 lg:px-6">
      <h2 id="vg-h" className="font-display text-19 font-extrabold text-ink">
        {title}
      </h2>
      <ul className="mt-3 grid grid-cols-4 gap-x-2.5 gap-y-3 sm:grid-cols-6 lg:grid-cols-8">
        {products.map((p, i) => (
          <li key={p.id} className="animate-rise" style={{ animationDelay: `${riseDelay(i)}s` }}>
            <Link href={productHref(p.id, "tile")} onClick={(e) => open(e, p.id, "tile")} className="press group flex flex-col items-center gap-1.5">
              <span className={cn("relative block aspect-square w-full overflow-hidden rounded-12 bg-brand-soft", !p.variety.inSeason && "opacity-60")}>
                <Image src={p.variety.photos[0]} alt="" fill sizes="(min-width: 1024px) 130px, 22vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
                {p.variety.contents && <span className="absolute top-1 left-1 rounded-4 bg-ribbon px-1 text-9 font-bold text-white uppercase">Mix</span>}
                {!p.variety.inSeason && <span className="absolute inset-x-1 bottom-1 rounded-4 bg-ink/75 px-1 text-center text-9 font-bold text-white uppercase">Sold out</span>}
              </span>
              <span className="line-clamp-2 text-center text-12 leading-tight font-semibold text-ink">{p.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
