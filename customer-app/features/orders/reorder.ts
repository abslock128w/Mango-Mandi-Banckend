"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useProducts } from "@/features/catalog/hooks/queries";
import { MAX_QTY, useCart } from "@/features/cart/store";
import { toast, useUi } from "@/features/shell/ui-store";
import { plural } from "@/lib/format";
import type { Order } from "@/lib/types";

/**
 * "Buy again": each box of the order goes back in the cart at today's price,
 * matched by SKU and ripeness against the shop's products for the chosen
 * pincode and day. Boxes not on sale that day are skipped and counted.
 * Bulk-deal lines are left out (a deal's tiers and stock are its own).
 */
export function useReorder() {
  const { data: products } = useProducts();
  const qc = useQueryClient();
  return (order: Order) => {
    let added = 0;
    let skipped = 0;
    for (const item of order.items) {
      if (item.bulk) {
        skipped += item.quantity;
        continue;
      }
      const product = products?.find((p) => p.skus.some((s) => s.apiSku === item.sku));
      const sku = product?.skus.find((s) => s.apiSku === item.sku && s.ripeness === item.stage);
      // Without a pincode the price list shows every box as available: checkout checks it.
      if (!product || !sku || sku.stock <= 0) {
        skipped += item.quantity;
        continue;
      }
      const inCart = useCart.getState().lines.find((l) => l.skuId === sku.id)?.qty ?? 0;
      const qty = Math.max(0, Math.min(item.quantity, MAX_QTY - inCart, sku.stock - inCart));
      if (qty) useCart.getState().add(product, sku, qty);
      added += qty;
      skipped += item.quantity - qty;
    }
    void qc.invalidateQueries({ queryKey: ["checkout-sync"] });
    if (added) {
      toast({ title: `Added ${plural(added, "box", "boxes")} to your cart${skipped ? `. ${skipped} not available` : ""}`, tone: "success" });
      useUi.getState().setCartOpen(true);
    } else toast({ title: "These boxes aren't available right now", tone: "danger" });
  };
}
