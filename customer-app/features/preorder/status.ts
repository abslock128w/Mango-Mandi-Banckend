import type { Preorder } from "@/lib/types";

export const PREORDER_STATUS: Record<Preorder["status"], { label: string; tone: string }> = {
  PAYMENT_PENDING: { label: "Waiting for payment", tone: "bg-brand-soft text-ink" },
  BOOKED: { label: "Booked", tone: "bg-tint text-action" },
  WAITLISTED: { label: "On the waitlist", tone: "bg-semi-soft text-ink" },
  CONVERTED: { label: "Order created", tone: "bg-tint text-action" },
  CANCELLED: { label: "Cancelled", tone: "bg-chip text-muted" },
};

/**
 * Without Razorpay keys the dev API hands out fake payment links
 * (https://rzp.io/i/plink_dev_...). Those are paid with the test buttons
 * (POST /v1/dev/pay-preorder) instead, and only outside production builds.
 */
export const isDevLink = (url: string | null) => Boolean(url?.includes("plink_dev_"));
export const devPayAllowed = (p: Pick<Preorder, "status" | "paymentUrl">) =>
  process.env.NODE_ENV !== "production" && p.status === "PAYMENT_PENDING" && (!p.paymentUrl || isDevLink(p.paymentUrl));
/** A real payment link the customer can be sent to. */
export const realPayUrl = (p: Pick<Preorder, "status" | "paymentUrl">) => (p.status === "PAYMENT_PENDING" && p.paymentUrl && !isDevLink(p.paymentUrl) ? p.paymentUrl : null);

const atNoon = (day: string) => new Date(`${day}T12:00:00+05:30`);
/** "Week of Mon 3 Mar" */
export const weekOf = (monday: string) =>
  `Week of ${atNoon(monday).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
/** "3 to 9 Mar" or "31 Mar to 6 Apr" */
export function weekRange(monday: string) {
  const a = atNoon(monday);
  const b = new Date(a.getTime() + 6 * 86_400_000);
  const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" });
  const mon = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" });
  return mon(a) === mon(b) ? `${day(a)} to ${day(b)} ${mon(b)}` : `${day(a)} ${mon(a)} to ${day(b)} ${mon(b)}`;
}
