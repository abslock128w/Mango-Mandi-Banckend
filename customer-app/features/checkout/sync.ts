import { api, ApiError } from "@/lib/api/client";
import { ripenessLabel } from "@/lib/format";
import type { BulkCartLine, CartLine } from "@/lib/types";

/**
 * Makes the account's cart (what a quote reads) match this device's cart.
 * Server lines no longer on the device are set to 0 first, so held boxes are
 * freed before new ones are asked for. A box we no longer sell comes back as
 * PRODUCT_UNAVAILABLE naming it; an ended bulk deal as BULK_UNAVAILABLE.
 */
export async function syncCart(lines: CartLine[], bulk: BulkCartLine[]) {
  const server = await api.serverCart();
  const want = new Set(lines.map((l) => `${l.apiSku}|${l.ripeness}`));
  for (const l of server.lines) if (!want.has(`${l.sku}|${l.stage}`)) await api.setCartItem(l.sku, l.stage, 0);
  const wantBulk = new Set(bulk.map((b) => `${b.listingId}|${b.stage}`));
  for (const b of server.bulkLines ?? []) if (!wantBulk.has(`${b.listingId}|${b.stage}`)) await api.setBulkItem(b.listingId, b.stage, 0);
  for (const b of bulk) {
    try {
      await api.setBulkItem(b.listingId, b.stage, b.qty);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "BULK_UNAVAILABLE" || err.code === "BULK_STAGE_INVALID" || err.status === 404))
        throw new ApiError(409, "BULK_UNAVAILABLE", `${b.title} (${ripenessLabel[b.stage]}) is no longer on offer. Remove it from your cart to continue.`, { listingId: b.listingId, stage: b.stage });
      throw err;
    }
  }
  for (const l of lines) {
    try {
      await api.setCartItem(l.apiSku, l.ripeness, l.qty);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "INVALID_SKU" || err.status === 404))
        throw new ApiError(409, "PRODUCT_UNAVAILABLE", `${l.name} ${l.size} kg is no longer sold. Remove it from your cart to continue.`, { sku: l.apiSku, stage: l.ripeness });
      throw err;
    }
  }
}

/** A stable key for the cart's contents, so a change syncs and quotes again. */
export const cartKey = (lines: CartLine[], bulk: BulkCartLine[]) =>
  [...lines.map((l) => `${l.apiSku}|${l.ripeness}|${l.qty}`), ...bulk.map((b) => `B${b.listingId}|${b.stage}|${b.qty}`)].sort().join(",");
