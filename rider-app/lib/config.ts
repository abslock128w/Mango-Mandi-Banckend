/** Where mango-api lives (the staff API is under /admin/v1). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000").replace(/\/$/, "");
export const ADMIN_API = `${API_URL}/admin/v1`;
/** The ops desk, for "Call ops" (locked code, reschedule, anything the app can't solve). */
export const OPS_PHONE = process.env.NEXT_PUBLIC_OPS_PHONE || "+910000000000";
/** How often the queue retries on its own (also on `online` and when the app comes back to the front). */
export const DRAIN_EVERY_MS = 15_000;
/** Location while a run is active: at most every 20 s, or sooner after moving 50 m. */
export const LOCATION_EVERY_MS = 20_000;
export const LOCATION_MIN_METERS = 50;
export const MAX_CODE_TRIES = 3;
