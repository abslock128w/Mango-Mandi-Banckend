"use client";
import { BlurImage } from "@/components/ui/blur-image";
import Link from "next/link";
import * as m from "motion/react-m";
import { Clock } from "lucide-react";
import { useState, ViewTransition } from "react";
import { RevealOnce } from "@/components/ui/reveal-once";
import { spring } from "@/lib/motion";
import { AddButton } from "@/features/cart/components/add-button";
import { useQty } from "@/features/cart/store";
import { NotifyButton } from "./notify-button";
import { RipenessChip } from "./ripeness-chip";
import { BoxToggle } from "./box-toggle";
import { productHref, useOpenProduct } from "@/features/product/open";
import { useNextSlot } from "../hooks/queries";
import { cn, dayName, ripenessLabel, rupees } from "@/lib/format";
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
  /** Above the fold on some width (the first row of a listing): load now, without preloading. */
  eager?: boolean;
  /** Box size preferred by a listing filter. */
  preferredSize?: BoxSize | null;
}

export const vtName = (scope: string, id: string) => `p-${scope}-${id}`.replace(/[^a-zA-Z0-9-]/g, "-");

export function ProductCard({ product, ripeness, scope, index = 0, fixed, priority, eager, preferredSize }: ProductCardProps) {
  const stage = defaultStage(product, ripeness);
  const [size, setSize] = useState<BoxSize>(() => preferredSize ?? defaultSize(product, stage));
  const sku = skuFor(product, stage, size) ?? product.skus[0];
  const slot = useNextSlot();
  const open = useOpenProduct();
  const qty = useQty(sku.id);

  // Stock is per box and ripeness for the chosen day (GET /v1/catalogue).
  const unavailable = sku.stock <= 0;
  const few = !unavailable && sku.stock <= 5;
  const href = productHref(product.id, scope, stage);
  const name = product.variety.contents ? product.name : `${product.name} Mango`;

  return (
    <RevealOnce
      as="article"
      // Fades and rises the first time this card appears in this list, never again (30 ms stagger).
      id={`card-${scope}-${product.id}`}
      index={index}
      data-testid="product-card"
      data-product={product.id}
      data-fly-scope
      className={cn(
        "rail-item relative flex flex-col rounded-8 border-[0.5px] border-line bg-surface p-3 shadow-card",
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
            <m.div layoutId={`img-${scope}-${product.id}`} transition={spring.smooth} data-fly-image className="relative aspect-square overflow-hidden rounded-8 bg-surface">
              {/* The photo fades in over its own blurred colours as soon as it decodes. */}
              <BlurImage
                src={productImage(product, stage)}
                alt=""
                fill
                sizes="(min-width: 1024px) 160px, (min-width: 640px) 30vw, 42vw"
                preload={priority}
                fetchPriority={priority ? "high" : "auto"}
                loading={priority || eager ? "eager" : "lazy"}
                className={cn("object-cover transition-[opacity,filter] duration-(--dur-m) ease-standard group-hover:scale-[1.02]", unavailable && "opacity-50 grayscale-[40%]")}
              />
            </m.div>
          </ViewTransition>
          {few && (
            <span className="absolute top-1 left-1 rounded-4 bg-ribbon px-2 py-0.5 text-9 leading-none font-extrabold text-white uppercase">Only {sku.stock} left</span>
          )}
          {unavailable && (
            <span className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-4 bg-disabled-ink px-2 py-1 text-9 leading-none font-bold text-white uppercase">Sold out</span>
          )}
        </div>
      </Link>

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        <span className="inline-flex h-4 w-fit max-w-full items-center gap-0.5 overflow-hidden rounded-4 bg-chip px-1 text-9 leading-none font-bold whitespace-nowrap text-ink uppercase">
          <Clock aria-hidden size={10} strokeWidth={2.5} />
          {cardChip(sku, slot?.short)}
        </span>
        <Link href={href} onClick={(e) => open(e, product.id, scope, stage)} tabIndex={-1} className="tap mt-2 block">
          {/* The name travels into the product sheet (phones) or page (laptops) with the photo. */}
          <ViewTransition name={`${vtName(scope, product.id)}-name`} share="morph" default="none">
            <m.h3 layout="position" layoutId={`title-${scope}-${product.id}`} transition={spring.smooth} className="line-clamp-2 h-9 text-13 leading-[18px] font-semibold text-ink">
              {name}
            </m.h3>
          </ViewTransition>
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <RipenessChip stage={stage} />
          <BoxToggle product={product} ripeness={stage} value={size} onChange={setSize} compact />
        </div>
        <div className="mt-auto flex items-end justify-between gap-1 pt-2">
          <div className="flex min-w-0 flex-col">
            <m.span layout="position" layoutId={`price-${scope}-${product.id}`} transition={spring.smooth} className="text-12 font-semibold text-ink">
              {rupees(sku.price)}
            </m.span>
            {/* One line beside ADD even at 360 px (the price column is about 32 px there); the toggle above says "box". */}
            <span className="text-11 whitespace-nowrap text-muted">{sku.boxLabel}</span>
          </div>
          {/* A box already in the cart keeps its stepper when the day sells out, so it can be removed here. */}
          {unavailable && qty === 0 ? (
            <NotifyButton sku={sku.apiSku} stage={stage} label={product.name} />
          ) : (
            <AddButton product={product} sku={sku} />
          )}
        </div>
      </div>
    </RevealOnce>
  );
}

export function ProductCardSkeleton({ fixed }: { fixed?: boolean }) {
  return (
    <div aria-hidden className={cn("flex flex-col rounded-8 border-[0.5px] border-line bg-surface p-3 shadow-card", fixed ? "h-[288px] w-[150px] shrink-0 lg:h-[302px] lg:w-[178px]" : "h-full")}>
      <div className="skeleton aspect-square rounded-8" />
      <div className="skeleton mt-2 h-4 w-20 rounded-4" />
      <div className="skeleton mt-2 h-4 w-full rounded-4" />
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
