/**
 * Shop configuration. Business rules (prices, stock, cutoffs, holds, fees)
 * live in mango-api and arrive through /v1; nothing here overrides them.
 */
export const config = {
  brand: "MandiMangoes",
  tagline: "Mangoes picked for the day you want to eat them, delivered to your door.",
  /** Help on WhatsApp: country code and number, digits only (NEXT_PUBLIC_SUPPORT_WHATSAPP). */
  supportWhatsapp: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "",
  /** Map default centre: Bengaluru, where the seeded pincodes are. */
  defaultCenter: { lat: 12.9716, lng: 77.5946 },
  /** Most boxes per line (the API refuses more: customer.js cart items qty 0..20). */
  maxPerLine: 20,
} as const;

export const whatsappLink = (text?: string) =>
  config.supportWhatsapp ? `https://wa.me/${config.supportWhatsapp}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;
