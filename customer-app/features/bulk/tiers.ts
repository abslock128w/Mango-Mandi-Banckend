import type { BulkDeal, BulkTier, RipenessStage } from "@/lib/types";

/**
 * Reading a bulk deal's price tiers. The API prices every line again at
 * checkout (and GET /bulk-deals/:id/price gives the live figure), so these
 * only decide what the page shows while that answer is on its way.
 */

/** The tier a quantity falls in: the last one it reaches. */
export function tierAt(tiers: BulkTier[], qty: number): BulkTier | null {
  let hit: BulkTier | null = null;
  for (const t of [...tiers].sort((a, b) => a.minQty - b.minQty)) if (qty >= t.minQty) hit = t;
  return hit;
}

/** The next cheaper tier above this quantity, if it can still be ordered. */
export function nextTier(deal: BulkDeal, qty: number): BulkTier | null {
  return [...deal.tiers].sort((a, b) => a.minQty - b.minQty).find((t) => t.minQty > qty && t.minQty <= deal.maxQty) ?? null;
}

/** The most boxes in one order: the deal's limit, trimmed to its steps and to the stock when known. 0 when the minimum can't be met. */
export function maxFor(deal: BulkDeal, available: number | null) {
  const cap = available == null ? deal.maxQty : Math.min(deal.maxQty, available);
  if (cap < deal.minQty) return 0;
  const step = Math.max(1, deal.qtyStep);
  return cap - ((cap - deal.minQty) % step);
}

/** A quantity snapped to minQty + k * qtyStep and kept within [minQty, max]. */
export function snapQty(deal: BulkDeal, qty: number, max: number) {
  const step = Math.max(1, deal.qtyStep);
  const top = Math.max(deal.minQty, max);
  const n = Math.min(Math.max(qty, deal.minQty), top);
  return n - ((n - deal.minQty) % step);
}

/** "10 to 24 boxes", "50+ boxes", "10 boxes". */
export function tierRange(t: Pick<BulkTier, "minQty" | "maxQty">) {
  if (t.maxQty == null) return `${t.minQty}+ boxes`;
  if (t.maxQty === t.minQty) return `${t.minQty} ${t.minQty === 1 ? "box" : "boxes"}`;
  return `${t.minQty} to ${t.maxQty} boxes`;
}

/** Boxes available for a ripeness on a day, or null when not known (no pincode, no availability sent). */
export function availableOn(deal: BulkDeal, date: string | null, stage: RipenessStage | null): number | null {
  if (!deal.availability || !date || !stage) return null;
  return deal.availability.find((d) => d.date === date)?.stages.find((s) => s.stage === stage)?.available ?? 0;
}

/** The biggest saving a deal offers on one box. */
export const bestSaving = (deal: BulkDeal) => Math.max(0, deal.retailPrice - deal.fromPrice, ...deal.tiers.map((t) => t.savingPerBox ?? 0));

/** "Ends 31 Mar, 6:00 pm" style timestamp in India time. */
export const endsLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
