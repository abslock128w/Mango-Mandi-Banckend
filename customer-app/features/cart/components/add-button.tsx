"use client";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Minus, Plus } from "lucide-react";
import { useId } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { morphSpring } from "@/lib/motion";
import { cn, ripenessLabel } from "@/lib/format";
import type { Product, Sku } from "@/lib/types";
import { MAX_QTY, useCart, useQty } from "../store";
import { toast } from "@/features/shell/ui-store";

interface Props {
  product: Product;
  sku: Sku;
  size?: "card" | "lg";
  className?: string;
}

/**
 * Blinkit ADD pill that morphs into a solid minus-count-plus stepper of the
 * same size (shared layoutId, spring 500/30). Collapses back to ADD at 0.
 */
export function AddButton({ product, sku, size = "card", className }: Props) {
  const qty = useQty(sku.id);
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  const reduce = useReducedMotion();
  // One id per button instance: the ADD pill and the stepper share it to morph, but two
  // mounted buttons must never share it, or Motion hides the non-lead one (opacity 0).
  // The product page renders PurchaseBar twice (phone bar + laptop column), and the
  // same SKU can sit in two lists with the same scope.
  const layoutId = `add-${useId()}`;
  const label = `${product.name} ${ripenessLabel[sku.ripeness]} ${sku.size} kg`;
  const limit = Math.min(MAX_QTY, sku.stock);
  const box = size === "lg" ? "h-11 w-[120px]" : "h-8 w-[66px]";
  const dims = size === "lg" ? "text-15 rounded-6" : "text-13 rounded-6";
  const transition = reduce ? { duration: 0 } : morphSpring;

  const inc = () => {
    if (qty >= limit) {
      toast(qty >= MAX_QTY ? { title: `Up to ${MAX_QTY} boxes per order`, action: { label: "Bulk order", href: "/bulk" } } : { title: "No more boxes in stock" });
      return;
    }
    setQty(sku.id, qty + 1);
  };

  return (
    <div className={cn("relative shrink-0", box, className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {qty === 0 ? (
          <m.button
            key="add"
            type="button"
            layoutId={layoutId}
            transition={transition}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            onClick={() => {
              add(product, sku);
            }}
            aria-label={`Add ${label} to cart`}
            className={cn(
              "absolute inset-0 border border-action bg-tint font-semibold text-action uppercase",
              "after:absolute after:-inset-y-1.5 after:inset-x-0 hover:bg-action/5",
              dims,
            )}
          >
            Add
          </m.button>
        ) : (
          <m.div
            key="stepper"
            layoutId={layoutId}
            transition={transition}
            initial={reduce ? false : { opacity: 0.4, scaleX: 0.8 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0 }}
            role="group"
            aria-label={`Quantity of ${label}`}
            className={cn("absolute inset-0 flex items-stretch bg-action font-semibold text-white", dims)}
          >
            <button
              type="button"
              aria-label={`Remove one ${label}`}
              onClick={() => setQty(sku.id, qty - 1)}
              className="press relative grid w-6 shrink-0 place-items-center after:absolute after:-inset-y-1.5 after:inset-x-0"
            >
              <Minus size={size === "lg" ? 18 : 14} strokeWidth={2.5} />
            </button>
            <span className="grid flex-1 place-items-center" aria-live="polite" aria-atomic>
              <RollingNumber value={qty} />
              <span className="sr-only"> in cart</span>
            </span>
            <button
              type="button"
              aria-label={`Add one more ${label}`}
              onClick={inc}
              aria-disabled={qty >= limit}
              className={cn("press relative grid w-6 shrink-0 place-items-center after:absolute after:-inset-y-1.5 after:inset-x-0", qty >= limit && "opacity-60")}
            >
              <Plus size={size === "lg" ? 18 : 14} strokeWidth={2.5} />
            </button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
