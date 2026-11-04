import { ApiError } from "@/lib/api/client";
import type { BulkCartLine, CartLine } from "@/lib/types";

const PROMO: Record<string, string> = {
  PROMO_INVALID: "That code isn't valid. Check the spelling and try again.",
  PROMO_NOT_STARTED: "That code isn't active yet.",
  PROMO_EXPIRED: "That code has expired.",
  PROMO_USED_UP: "That code has been fully used.",
  PROMO_ALREADY_USED: "You've already used this code.",
  PROMO_FIRST_ORDER: "This code is for your first order only.",
  PROMO_NOT_FOR_BULK: "Promo codes don't apply to bulk deals.",
};

export const isPromoError = (e: unknown): e is ApiError => e instanceof ApiError && e.code.startsWith("PROMO_");

/** A promo refusal in plain words (the API's own message for a minimum order, which names the amount). */
export function promoProblem(e: ApiError) {
  if (e.code === "PROMO_MIN_SUBTOTAL") return e.message ? e.message.replace(/\.?$/, ".") : "Your order is below this code's minimum.";
  return PROMO[e.code] ?? e.message;
}

/** A checkout refusal the customer can act on. */
export function checkoutProblem(err: unknown, lines: CartLine[] = [], bulk: BulkCartLine[] = []): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : "Something went wrong. Please try again.";
  switch (err.code) {
    case "STOCK_INSUFFICIENT": {
      const sku = typeof err.extra.sku === "string" ? err.extra.sku : null;
      const listing = typeof err.extra.listingId === "string" ? err.extra.listingId : null;
      const name = (listing && bulk.find((b) => b.listingId === listing)?.title) || (sku && lines.find((l) => l.apiSku === sku)?.name) || "One of your boxes";
      return `${name} is running short for this day. Lower the quantity or pick another day.`;
    }
    case "SLOT_REQUIRED":
      return "Choose a delivery time.";
    case "SLOT_FULL":
      return "That time just filled up. Choose another.";
    case "CART_EMPTY":
      return "Your cart is empty.";
    case "NOT_SERVICEABLE":
      return "We don't deliver to this pincode yet.";
    case "QUOTE_EXPIRED":
      return "Prices were held for a few minutes and that time ran out. We've checked them again.";
    case "PAYMENTS_UNAVAILABLE":
      return "Online payment isn't switched on yet, so orders can't be paid for here. Nothing was charged.";
    case "PAYMENT_GATEWAY_ERROR":
      return "The payment service didn't answer. Please try again.";
    case "PAYMENT_STARTING":
      return "Your payment is still starting. Try again in a moment.";
    default:
      return err.code.startsWith("PROMO_") ? promoProblem(err) : err.message;
  }
}
