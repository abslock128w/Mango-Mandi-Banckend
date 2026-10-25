// Bulk Deals in the shop: reading a deal's price tiers. The API sends the tiers and
// prices every line again at checkout, so these only decide what the page shows.
import type { BulkDeal, BulkTier, Stage } from './api'

/** The tier a quantity falls in: the last one it reaches. */
export function tierAt(tiers: BulkTier[], qty: number): BulkTier | null {
  let hit: BulkTier | null = null
  for (const t of tiers) if (qty >= t.minQty) hit = t
  return hit
}

/** The next cheaper tier above this quantity, if one can still be ordered. */
export function nextTier(deal: BulkDeal, qty: number): BulkTier | null {
  return deal.tiers.find((t) => t.minQty > qty && t.minQty <= deal.maxQty) ?? null
}

/** The most boxes that can go in one order: the deal's limit, trimmed to its steps and to the stock when known. */
export function maxFor(deal: BulkDeal, available: number | null) {
  const cap = available == null ? deal.maxQty : Math.min(deal.maxQty, available)
  if (cap < deal.minQty) return 0
  return cap - ((cap - deal.minQty) % deal.qtyStep)
}

/** "10 to 24 boxes", "50+ boxes". */
export const tierRange = (t: BulkTier) => (t.maxQty == null ? `${t.minQty}+ boxes` : t.maxQty === t.minQty ? `${t.minQty} boxes` : `${t.minQty} to ${t.maxQty} boxes`)

/** Boxes available for a ripeness on a day, from the deal's availability, or null when not known (no pincode). */
export function availableOn(deal: BulkDeal, date: string | null, stage: Stage | null): number | null {
  if (!deal.availability || !date || !stage) return null
  return deal.availability.find((d) => d.date === date)?.stages.find((s) => s.stage === stage)?.available ?? 0
}
