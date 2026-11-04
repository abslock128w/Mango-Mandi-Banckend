import type { BoxSize, OrderStatus, RipenessStage } from "./types";

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,899 (paise shown only when there are any: ₹999.50). Prices include GST. */
export const rupees = (n: number) => `₹${Number.isInteger(Math.round(n * 100) / 100) ? inr0.format(n) : inr2.format(n)}`;

export const boxLabel = (size: BoxSize) => `${size} kg`;

export const ripenessLabel: Record<RipenessStage, string> = {
  RAW: "Raw",
  SEMI_RIPE: "Semi-ripe",
  RIPE: "Ripe",
};

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Dates are India time; the API sends yyyy-mm-dd for days. */
const IST = "Asia/Kolkata";
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: IST });
const atNoon = (day: string) => new Date(`${day}T12:00:00+05:30`);
const addDays = (day: string, n: number) => {
  const d = atNoon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: IST });
};

/** "Today", "Tomorrow", else "Sat 1 Nov". */
export function dayName(day: string) {
  const t = todayIST();
  if (day === t) return "Today";
  if (day === addDays(t, 1)) return "Tomorrow";
  return atNoon(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST });
}
/** "1 Nov" */
export const shortDate = (day: string) => atNoon(day).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
/** "Sat, 1 Nov" */
export const longDate = (day: string) => atNoon(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST });
/** "1 Nov, 4:05 pm" for timestamps */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: IST });
export const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });

/** "07:00" to "7 am", "16:30" to "4:30 pm" */
export function clock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${String(m).padStart(2, "0")} ${suffix}` : `${hr} ${suffix}`;
}
/** "7 to 11 am", "10 am to 1 pm" */
export function windowLabel(startsAt: string, endsAt: string) {
  const a = clock(startsAt);
  const b = clock(endsAt);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return sameHalf ? `${a.replace(/ (am|pm)$/, "")} to ${b}` : `${a} to ${b}`;
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  PAYMENT_PENDING: { label: "Waiting for payment", tone: "bg-brand-soft text-ink" },
  CONFIRMED: { label: "Confirmed", tone: "bg-tint text-action" },
  PROCESSING: { label: "Preparing", tone: "bg-tint text-action" },
  PACKED: { label: "Packed", tone: "bg-semi-soft text-ink" },
  SHIPPED: { label: "On its way", tone: "bg-semi-soft text-ink" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "bg-brand-soft text-ink" },
  DELIVERED: { label: "Delivered", tone: "bg-tint text-action" },
  DELIVERY_FAILED: { label: "Delivery missed", tone: "bg-danger-soft text-danger" },
  RTO: { label: "Returned", tone: "bg-danger-soft text-danger" },
  CANCELLED: { label: "Cancelled", tone: "bg-chip text-muted" },
};

/** "About 12 mangoes, around 250 g each" */
export function boxContents(fruits: number | null, grams: number | null) {
  if (fruits && grams) return `About ${fruits} mangoes, around ${grams} g each`;
  if (fruits) return `About ${fruits} mangoes`;
  if (grams) return `Mangoes of around ${grams} g each`;
  return null;
}
