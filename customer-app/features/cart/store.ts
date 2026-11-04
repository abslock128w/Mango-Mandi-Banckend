"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { config } from "@/lib/config";
import { productImage } from "@/lib/catalog";
import type { BulkCartLine, CartLine, Product, RipenessStage, Sku } from "@/lib/types";

export const MAX_QTY = config.maxPerLine;

/**
 * The device's cart. The API keeps its own copy (it is what a quote reads), so
 * checkout syncs this one to the server first (features/checkout/sync.ts).
 * Lines are SKU x ripeness: the same box at two stages is two lines.
 */
interface CartState {
  lines: CartLine[];
  bulk: BulkCartLine[];
  slotId: string | null;
  promoCode: string | null;
  add: (product: Product, sku: Sku, qty?: number) => void;
  setQty: (skuId: string, qty: number) => void;
  setBulk: (line: BulkCartLine) => void;
  removeBulk: (listingId: string, stage: RipenessStage) => void;
  clear: () => void;
  replace: (lines: CartLine[]) => void;
  setSlot: (id: string | null) => void;
  setPromo: (code: string | null) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      bulk: [],
      slotId: null,
      promoCode: null,
      add: (product, sku, qty = 1) =>
        set((s) => {
          const existing = s.lines.find((l) => l.skuId === sku.id);
          const limit = Math.min(MAX_QTY, Math.max(sku.stock, 0) || MAX_QTY);
          if (existing) return { lines: s.lines.map((l) => (l.skuId === sku.id ? { ...l, qty: Math.min(limit, l.qty + qty) } : l)) };
          const line: CartLine = {
            skuId: sku.id,
            apiSku: sku.apiSku,
            productId: product.id,
            qty: Math.min(limit, qty),
            name: product.name,
            image: productImage(product, sku.ripeness),
            ripeness: sku.ripeness,
            size: sku.size,
            price: sku.price,
            mrp: sku.mrp,
          };
          return { lines: [...s.lines, line] };
        }),
      setQty: (skuId, qty) =>
        set((s) => ({
          lines: qty <= 0 ? s.lines.filter((l) => l.skuId !== skuId) : s.lines.map((l) => (l.skuId === skuId ? { ...l, qty: Math.min(MAX_QTY, qty) } : l)),
        })),
      setBulk: (line) =>
        set((s) => ({
          bulk: line.qty <= 0 ? s.bulk.filter((b) => !(b.listingId === line.listingId && b.stage === line.stage)) : [...s.bulk.filter((b) => !(b.listingId === line.listingId && b.stage === line.stage)), line],
        })),
      removeBulk: (listingId, stage) => set((s) => ({ bulk: s.bulk.filter((b) => !(b.listingId === listingId && b.stage === stage)) })),
      clear: () => set({ lines: [], bulk: [], promoCode: null }),
      replace: (lines) => set({ lines }),
      setSlot: (slotId) => set({ slotId }),
      setPromo: (promoCode) => set({ promoCode }),
    }),
    { name: "mm.cart", storage: createJSONStorage(() => localStorage), skipHydration: true, version: 2 },
  ),
);

export const cartCount = (lines: CartLine[], bulk: BulkCartLine[] = []) => lines.reduce((n, l) => n + l.qty, 0) + bulk.reduce((n, b) => n + b.qty, 0);
export const cartSubtotal = (lines: CartLine[], bulk: BulkCartLine[] = []) => lines.reduce((s, l) => s + l.price * l.qty, 0) + bulk.reduce((s, b) => s + b.unitPrice * b.qty, 0);
export const useQty = (skuId: string) => useCart((s) => s.lines.find((l) => l.skuId === skuId)?.qty ?? 0);
