"use client";
import Image from "next/image";
import Link from "next/link";
import * as m from "motion/react-m";
import { Clock } from "lucide-react";
import { useState, ViewTransition } from "react";
import { AddButton } from "@/features/cart/components/add-button";
import { NotifyButton } from "./notify-button";
import { RipenessChip } from "./ripeness-chip";
import { BoxToggle } from "./box-toggle";
import { productHref, useOpenProduct } from "@/features/product/open";
import { useNextSlot } from "../hooks/queries";
import { cn, dayName, ripenessLabel, rupees } from "@/lib/format";
import { riseDelay } from "@/lib/motion";
import { defaultSize, defaultStage, productImage, skuFor } from "@/lib/catalog";
import type { BoxSize, Product, RipenessStage, Sku } from "@/lib/types";

export interface ProductCardProps {
  product: Product;
  /** Preferred ripeness to show (listing filter, rail). */
  ripeness?: RipenessStage | null;
  /** Unique per list on a page: namespaces layoutId and view-transition names. */
  scope: string;
  index?: number;
  /** Fixed Blinkit desktop size 178 x 302 for rails. */
  fixed?: boolean;
  priority?: boolean;
  /** Box size preferred by a listing filter. */
  preferredSize?: BoxSize | null;
}

export const vtName = (scope: string, id: string) => `p-${scope}-${id}`.replace(/[^a-zA-Z0-9-]/g, "-");

export function ProductCard({ product, ripeness, scope, index = 0, fixed, priority, preferredSize }: ProductCardProps) {
  const stage = defaultStage(product, ripeness);
  const [size, setSize] = useState<BoxSize>(() => preferredSize ?? defaultSize(product, stage));
  const sku = skuFor(product, stage, size) ?? product.skus[0];
  const slot = useNextSlot();
  const open = useOpenProduct();
  const [loaded, setLoaded] = useState(false);

  // Stock is per box and ripeness for the chosen day (GET /v1/catalogue).
  const unavailable = sku.stock <= 0;
  const few = !unavailable && sku.stock <= 5;
  const href = productHref(product.id, scope, stage);
  const name = `${product.name} Mango`;

  return (
    <article
      // Staggered fade-and-rise in CSS so it plays on first paint, before hydration.
      style={{ animationDelay: `${riseDelay(index)}s` }}
      data-testid="product-card"
      data-product={product.id}
      className={cn(
        "animate-rise relative flex flex-col rounded-8 border-[0.5px] border-line bg-surface p-3 shadow-card",
        fixed ? "h-[288px] w-[150px] shrink-0 lg:h-[302px] lg:w-[178px]" : "h-full min-w-0",
      )}
    >
      <Link
        href={href}
        onClick={(e) => open(e, product.id, scope, stage)}
        className="group block rounded-8 focus-visible:outline-offset-4"
        aria-label={`${name}, ${ripenessLabel[stage].toLowerCase()}, ${sku.boxLabel}, ${rupees(sku.price)}`}
      >
        <div className="relative">
          <ViewTransition name={vtName(scope, product.id)} share="morph" default="none">
            <m.div layoutId={`img-${scope}-${product.id}`} className="relative aspect-square overflow-hidden rounded-8 bg-surface">
              {!loaded && <div aria-hidden className="skeleton absolute inset-0" />}
              {/* The image paints over the shimmer as soon as it decodes. */}
              <Image
                src={productImage(product, stage)}
                alt=""
                fill
                sizes="(min-width: 1024px) 160px, (min-width: 640px) 30vw, 42vw"
                preload={priority}
                fetchPriority={priority ? "high" : "auto"}
                loading={priority ? "eager" : "lazy"}
                onLoad={() => setLoaded(true)}
                className={cn("object-cover transition-[opacity,filter] duration-200 group-hover:scale-[1.02]", unavailable && "opacity-50 grayscale-[40%]")}
              />
            </m.div>
          </ViewTransition>
          {few && (
            <span className="absolute top-1 left-1 rounded-4 bg-ribbon px-1.5 py-0.5 text-9 leading-none font-extrabold text-white uppercase">Only {sku.stock} left</span>
          )}
          {unavailable && (
            <span className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-4 bg-disabled-ink px-2 py-1 text-9 leading-none font-bold text-white uppercase">Sold out</span>
          )}
        </div>
      </Link>

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        <span className="inline-flex h-4 w-fit items-center gap-0.5 rounded-4 bg-chip px-1 text-9 leading-none font-bold text-ink uppercase">
          <Clock aria-hidden size={10} strokeWidth={2.5} />
          {cardChip(sku, slot?.short)}
        </span>
        <Link href={href} onClick={(e) => open(e, product.id, scope, stage)} tabIndex={-1} className="mt-1.5">
          <h3 className="line-clamp-2 h-9 text-13 leading-[18px] font-semibold text-ink">{name}</h3>
        </Link>
        <div className="mt-1 flex items-center gap-1.5">
          <RipenessChip stage={stage} />
          <BoxToggle product={product} ripeness={stage} value={size} onChange={setSize} compact />
        </div>
        <div className="mt-auto flex items-end justify-between gap-1 pt-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-12 font-semibold text-ink">{rupees(sku.price)}</span>
            <span className="text-11 text-muted">{sku.boxLabel} box</span>
          </div>
          {unavailable ? (
            <NotifyButton sku={sku.apiSku} stage={stage} label={product.name} />
          ) : (
            <AddButton product={product} sku={sku} scope={scope} />
          )}
        </div>
      </div>
    </article>
  );
}

export function DiscountRibbon({ percent }: { percent: number }) {
  return (
    <span
      className="absolute -top-3 left-0 flex w-7 flex-col items-center bg-ribbon pt-1 pb-2 text-center text-9 leading-[10px] font-extrabold text-white [clip-path:polygon(0_0,100%_0,100%_100%,75%_88%,50%_100%,25%_88%,0_100%)]"
      aria-label={`${percent}% off`}
    >
      <span>{percent}%</span>
      <span>OFF</span>
    </span>
  );
}

export function ProductCardSkeleton({ fixed }: { fixed?: boolean }) {
  return (
    <div aria-hidden className={cn("flex flex-col rounded-8 border-[0.5px] border-line bg-surface p-3 shadow-card", fixed ? "h-[288px] w-[150px] shrink-0 lg:h-[302px] lg:w-[178px]" : "h-full")}>
      <div className="skeleton aspect-square rounded-8" />
      <div className="skeleton mt-2 h-4 w-20 rounded-4" />
      <div className="skeleton mt-1.5 h-4 w-full rounded-4" />
      <div className="skeleton mt-1 h-4 w-2/3 rounded-4" />
      <div className="mt-auto flex items-end justify-between pt-2">
        <div className="skeleton h-8 w-12 rounded-4" />
        <div className="skeleton h-8 w-[66px] rounded-6" />
      </div>
    </div>
  );
}

/** The small uppercase chip under the image: the delivery day and slot, or when it's back. */
export function cardChip(sku: Sku, slotShort?: string) {
  if (sku.stock > 0) return slotShort ?? "NEXT DAY";
  if (sku.nextAvailableDate) return `BACK ${dayName(sku.nextAvailableDate).toUpperCase()}`;
  return "SOLD OUT";
}
