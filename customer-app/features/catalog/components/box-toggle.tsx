"use client";
import * as m from "motion/react-m";
import { useId } from "react";
import { uiSpring } from "@/lib/motion";
import { cn } from "@/lib/format";
import type { BoxSize, Product, RipenessStage } from "@/lib/types";

/** 3 kg / 5 kg segmented toggle, replaces Blinkit's unit dropdown on cards. */
export function BoxToggle({
  product,
  ripeness,
  value,
  onChange,
  compact,
}: {
  product: Product;
  ripeness: RipenessStage;
  value: BoxSize;
  onChange: (s: BoxSize) => void;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label="Box size" className={cn("relative inline-flex rounded-4 bg-chip p-0.5", compact ? "h-5" : "h-8")}>
      {product.boxes.map(({ size: s }) => {
        const sku = product.skus.find((k) => k.ripeness === ripeness && k.size === s);
        const selected = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${s} kg box${sku && sku.stock <= 0 ? ", out of stock" : ""}`}
            onClick={() => onChange(s)}
            className={cn(
              "relative z-0 rounded-4 font-medium whitespace-nowrap after:absolute after:inset-x-0",
              // A 44 px touch: 16 px buttons reach out 14 px above and below, 28 px ones 8 px.
              compact ? "px-3 text-11 after:-inset-y-3.5" : "px-3 text-13 after:-inset-y-2",
              selected ? "text-ink" : "text-muted",
              sku && sku.stock <= 0 && "line-through decoration-disabled",
            )}
          >
            {selected && (
              <m.span
                layoutId={`box-${id}`}
                transition={uiSpring}
                className="absolute inset-0 -z-10 rounded-4 border-[0.5px] border-line bg-surface shadow-card"
              />
            )}
            {s} kg
          </button>
        );
      })}
    </div>
  );
}
