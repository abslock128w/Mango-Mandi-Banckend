/** Today in India (the run's date), YYYY-MM-DD. */
export function todayIST(now = Date.now()) {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "Customer";
/** Directions to a warehouse: by its map point when it has one, else its address or name. */
export const warehouseDirections = (w: { name: string; address: string | null; lat: number | null; lng: number | null }) =>
  w.lat !== null && w.lng !== null
    ? `https://www.google.com/maps/dir/?api=1&destination=${w.lat},${w.lng}&travelmode=driving`
    : mapsDirections(w.address ?? w.name);
export const mapsDirections = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export const STAGE: Record<string, string> = { RIPE: "ripe", SEMI_RIPE: "semi-ripe", RAW: "raw" };
export function dateWords(d: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
}
export function duration(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}
